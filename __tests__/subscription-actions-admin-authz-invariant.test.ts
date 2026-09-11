/**
 * 構造不変条件: Admin API に届く Server Action は必ず所有者照合を通る。
 *
 * なぜ振る舞いテストと別に必要か: subscription-actions-authz.test.ts は
 * **今ある action** の振る舞いを固定するが、「将来もう 1 つ Admin API 経路が
 * 追加されたとき照合を忘れる」ことは検出できない。実際に 2026-08-12 の調査で
 * 報告された IDOR はまさにこの形 (Admin API を叩く action に所有者照合が無い) で、
 * 修正 (e29fc66) 後も再発を防ぐ仕組みは無かった。
 *
 * Admin API トークンは **ストア全体に効く**。Shopify は呼び出し元顧客にスコープしない
 * ので、ログイン確認だけでは他人の契約を操作できてしまう。一方 Customer Account API
 * (pause / activate / cancel / skip) は顧客トークンで Shopify 側がスコープするため
 * 追加照合は不要 — この非対称性が本ファイルの判定軸。
 *
 * ── 判定方法: TypeScript の AST (正規表現ではない) ────────────────────────
 *
 * 初版はソースを**テキストとして**走査していた。そのため以下がすべてすり抜けた
 * (2026-08-12 の QA がミューテーション注入で実測):
 *
 *   1. `export const name = async () => {}` 形式で書く
 *      → `export async function` しか拾っていなかった
 *   2. 同一ファイル内の非 export ヘルパー経由で Admin API を呼ぶ
 *      → export された関数しか検査していなかった
 *   3. `"@/lib/shopify/subscription-admin"` (alias) から import する
 *      → リテラル `"./subscription-admin"` しか見ていなかった。alias 形式は
 *        app/api/cron/billing/route.ts 等で実際に使われている書き方
 *   4. 別ファイルに新しい `"use server"` を作る
 *      → SOURCE_PATH が 1 ファイル固定だった
 *
 * すり抜けた経路は型検査・lint・全単体テストを通過したまま「クライアント指定の
 * 契約 ID で店舗全体の Admin API に到達し所有者照合が無い」Server Action を成立
 * させた。よって判定を AST ベースに置き換え、次の 4 点で塞ぐ:
 *
 *   - 母集団はファイル固定をやめ、**ソースツリー全体から `"use server"` を発見**する
 *     (ファイル先頭の directive と、関数本体先頭の inline directive の両方)
 *   - 関数の**宣言形式を問わない** (function 宣言 / const + arrow / const + function 式 /
 *     export default)。export 有無も問わない
 *   - import は**モジュールパスを正規化して**照合する (`./x` / `@/lib/shopify/x` /
 *     `../shopify/x` は同一視)。`as` 別名・`import * as ns`・動的 `import()` も追跡
 *   - Admin API モジュールは subscription-admin だけでなく **admin-client
 *     (adminFetch 本体)** も含める。subscription-admin を迂回して自前で
 *     mutation を組む経路も同じ危険度だから
 *
 * ── 不変条件の形: 「admin に触る関数自身が照合する」(局所ルール) ──────────
 *
 * 「action が照合し、実際の admin 呼び出しはヘルパーに任せる」形も安全ではあるが、
 * それを許すと「どのヘルパーがどの呼び出し元から来たか」の追跡が必要になり、
 * 判定が推移閉包の解析に膨らむ。ここでは**局所ルール**を採る:
 *
 *   Admin API に到達する関数は、その関数自身の中で、到達点より前に、
 *   条件分岐に入らない位置で `authorizeContractAccess` を呼ぶこと。
 *
 * 局所ルールは (a) 解析が単純で穴が空きにくい (b) 照合と admin 呼び出しが必ず隣接
 * するので読んだだけで安全性が分かる (c) 「照合はあるが到達しない分岐の中」を
 * 構文的に排除できる、という 3 点で優れる。ヘルパーに admin 呼び出しを切り出す
 * 場合は、そのヘルパー自身も照合を通すこと (二重照合のコストは許容する)。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();

/** 走査するソースルート。`"use server"` はこの配下にしか置かれない。 */
const SOURCE_ROOTS = ["app", "lib", "components"];

/** 走査から外すディレクトリ (テスト・ビルド生成物・E2E)。 */
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "e2e", "coverage"]);

/**
 * ストア全体に効く Admin API へ到達するモジュール (プロジェクト相対・拡張子なし)。
 *
 * `admin-client` を含めるのは、subscription-admin を経由せず `adminFetch` を直接
 * 呼んで mutation を組む経路も同じ危険度だから。`admin-queries` / `admin-mutations`
 * は GraphQL 文字列だけで単体では通信しないため対象外。
 */
const ADMIN_MODULES = new Set([
  "lib/shopify/subscription-admin",
  "lib/shopify/admin-client",
]);

/** 所有者照合を行う唯一の入口 (単一正本。action ごとの自前実装は禁止)。 */
const AUTHORIZE_HELPER = "authorizeContractAccess";

/** 照合の実体 — 共有 verifier。helper がこれを呼ぶことまで確認する。 */
const OWNERSHIP_VERIFIER = "verifySubscriptionContractOwnership";

/**
 * `"use server"` ファイルが Admin API モジュールを **間接的に** 引き込んでよい
 * 中継モジュール (プロジェクト相対・拡張子なし)。
 *
 * 局所ルールは「そのファイルが admin を直接 import しているか」で判定するので、
 * admin を内側に隠した中継モジュールを挟むと検査を迂回できる。下の tripwire
 * テストが新しい中継を検出して落ちるので、追加するときは
 * **クライアント入力を Admin API に渡していないこと**を確認してからここに書く。
 *
 * - lib/subscription-frequencies.server: `getSellingPlanGroups` でストアの
 *   販売プラン一覧 (公開カタログ相当) を読むだけ。契約 ID もクライアント入力も
 *   渡さないので所有者照合の対象外。
 */
const ALLOWED_ADMIN_INDIRECTIONS = new Set(["lib/subscription-frequencies.server"]);

// ─── ソース発見 ────────────────────────────────────────────────────────

function listSourceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|spec|stories)\.tsx?$/.test(entry.name)) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      found.push(full);
    }
  };

  for (const root of SOURCE_ROOTS) {
    const abs = path.join(PROJECT_ROOT, root);
    if (existsSync(abs)) walk(abs);
  }
  return found.sort();
}

function parse(filePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** directive prologue (先頭の文字列文の並び) に `"use server"` があるか。 */
function hasUseServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const stmt of statements) {
    if (!ts.isExpressionStatement(stmt)) break;
    const expr = stmt.expression;
    if (!ts.isStringLiteral(expr) && !ts.isNoSubstitutionTemplateLiteral(expr)) break;
    if (expr.text === "use server") return true;
    // "use client" 等の別 directive は読み飛ばす
  }
  return false;
}

/**
 * 本体を持ちうる関数ノードだけに絞る。
 *
 * `ts.isFunctionLike` は CallSignatureDeclaration など**本体を持たない**宣言も
 * 含むため `.body` が型として存在しない。`ts.isFunctionLikeDeclaration` は公開
 * API ではないので、必要な種類を明示的に列挙する。
 */
function asFunctionWithBody(node: ts.Node): ts.FunctionLikeDeclaration | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node;
  }
  return null;
}

function bodyHasUseServer(node: ts.Node): boolean {
  const fn = asFunctionWithBody(node);
  return (
    !!fn && !!fn.body && ts.isBlock(fn.body) && hasUseServerDirective(fn.body.statements)
  );
}

/** ファイル内のどこかに inline `"use server"` 関数があるか。 */
function hasInlineServerAction(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (bodyHasUseServer(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

// ─── モジュールパス正規化 ───────────────────────────────────────────────

/** `./x` / `../y/x` / `@/lib/x` をプロジェクト相対・拡張子なしに正規化する。 */
function resolveModule(fromFile: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith("@/")) {
    abs = path.join(PROJECT_ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    abs = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare package (next, react, ...)
  }
  return path
    .relative(PROJECT_ROOT, abs)
    .split(path.sep)
    .join("/")
    .replace(/\.(tsx?|jsx?)$/, "");
}

type AdminReach = {
  /** admin モジュールから入ってきたローカル束縛名 (`as` 別名は解決済み)。 */
  names: Set<string>;
  /** `import * as ns from "<admin>"` の ns 名。 */
  namespaces: Set<string>;
};

function collectAdminImports(sf: ts.SourceFile, filePath: string): AdminReach {
  const names = new Set<string>();
  const namespaces = new Set<string>();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const mod = resolveModule(filePath, stmt.moduleSpecifier.text);
    if (!mod || !ADMIN_MODULES.has(mod)) continue;

    const clause = stmt.importClause;
    // `import type { X }` は実行時に消えるので到達しない
    if (!clause || clause.isTypeOnly) continue;

    if (clause.name) names.add(clause.name.text); // default import
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        // `foo as bar` はローカルでは bar で参照される
        names.add(element.name.text);
      }
    }
  }

  return { names, namespaces };
}

/** そのファイルが直接 import しているモジュール (プロジェクト相対)。 */
function importedModules(sf: ts.SourceFile, filePath: string): string[] {
  const mods: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.importClause?.isTypeOnly) continue;
    const mod = resolveModule(filePath, stmt.moduleSpecifier.text);
    if (mod) mods.push(mod);
  }
  return mods;
}

// ─── Admin API 到達点の位置 ─────────────────────────────────────────────

function isDynamicAdminImport(node: ts.Node, filePath: string): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return false;
  const arg = node.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) return false;
  const mod = resolveModule(filePath, arg.text);
  return !!mod && ADMIN_MODULES.has(mod);
}

/**
 * 部分木の中で Admin API に到達する位置をすべて返す。
 *
 * 「呼び出し」だけでなく **名前への参照** を到達点として数える。
 * `const f = updateSubscriptionContract; await f(id)` のような間接化で
 * 逃げられないようにするため。
 */
function adminReachPositions(
  root: ts.Node,
  reach: AdminReach,
  filePath: string
): number[] {
  const positions: number[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return; // import 文そのものは到達点ではない

    if (isDynamicAdminImport(n, filePath)) {
      positions.push(n.getStart());
    }

    if (ts.isIdentifier(n)) {
      // プロパティ名側 (`obj.updateSubscriptionContract`) は別物なので除く
      const parent = n.parent;
      const isPropertyName =
        parent &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === n) ||
          (ts.isPropertyAssignment(parent) && parent.name === n));

      if (!isPropertyName) {
        if (reach.names.has(n.text) || reach.namespaces.has(n.text)) {
          positions.push(n.getStart());
        }
      }
    }

    ts.forEachChild(n, visit);
  };

  visit(root);
  return positions.sort((a, b) => a - b);
}

// ─── 「必ず通る」照合の位置 ─────────────────────────────────────────────

/**
 * 文の中の `authorizeContractAccess(...)` 呼び出し位置。
 * 条件分岐 / 短絡評価 / コールバックの内側には**降りない** —
 * 「必ず実行される」と言えない位置の照合は照合として数えない。
 */
function authorizeCallPosition(node: ts.Node): number | null {
  let found: number | null = null;

  const visit = (n: ts.Node) => {
    if (found !== null) return;

    if (
      ts.isConditionalExpression(n) ||
      ts.isFunctionLike(n) ||
      (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return;
    }

    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === AUTHORIZE_HELPER
    ) {
      found = n.getStart();
      return;
    }

    ts.forEachChild(n, visit);
  };

  visit(node);
  return found;
}

/** 条件分岐に囲まれていない文だけを辿って照合位置を探す。 */
function unconditionalAuthorizePosition(statements: readonly ts.Statement[]): number | null {
  for (const stmt of statements) {
    // try ブロックは必ず入る (catch / finally は条件付き・事後なので見ない)
    if (ts.isTryStatement(stmt)) {
      const inner = unconditionalAuthorizePosition(stmt.tryBlock.statements);
      if (inner !== null) return inner;
      continue;
    }
    if (ts.isBlock(stmt)) {
      const inner = unconditionalAuthorizePosition(stmt.statements);
      if (inner !== null) return inner;
      continue;
    }
    // if / switch / for / while / label 配下は「必ず通る」とは言えない
    if (
      ts.isIfStatement(stmt) ||
      ts.isSwitchStatement(stmt) ||
      ts.isLabeledStatement(stmt) ||
      ts.isIterationStatement(stmt, /* lookInLabeledStatements */ false)
    ) {
      continue;
    }

    const pos = authorizeCallPosition(stmt);
    if (pos !== null) return pos;
  }
  return null;
}

// ─── 解析単位 (宣言形式を問わない関数) ─────────────────────────────────

type Unit = {
  /** 報告用の識別子 (`<相対パス> :: <関数名>`)。 */
  label: string;
  name: string;
  file: string;
  exported: boolean;
  /** `"use server"` ファイルの export、または inline directive を持つ関数。 */
  isServerAction: boolean;
  /** 走査対象の部分木 (関数本体 or 初期化子)。 */
  node: ts.Node;
  /** 順序判定に使える block 本体。取れないときは null (= 判定不能)。 */
  bodyStatements: readonly ts.Statement[] | null;
};

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function blockOf(node: ts.Node): readonly ts.Statement[] | null {
  // block 本体が取れないもの (式本体の arrow / ラップされた初期化子) は null。
  // 呼び出し側は「順序を判定できない」= 不合格として扱う (fail-closed)。
  const fn = asFunctionWithBody(node);
  if (fn && fn.body && ts.isBlock(fn.body)) {
    return fn.body.statements;
  }
  return null;
}

/**
 * トップレベル宣言を解析単位に分解する。
 *
 * 入れ子の関数は外側の単位の部分木に含まれる (= 外側の照合で評価される) ので、
 * ここではトップレベルだけを列挙すれば母集団に穴は空かない。
 */
function collectUnits(sf: ts.SourceFile, filePath: string, fileIsServer: boolean): Unit[] {
  const relative = path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
  const units: Unit[] = [];

  const push = (name: string, node: ts.Node, exported: boolean) => {
    units.push({
      label: `${relative} :: ${name}`,
      name,
      file: relative,
      exported,
      isServerAction: (fileIsServer && exported) || bodyHasUseServer(node),
      node,
      bodyStatements: blockOf(node),
    });
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      push(stmt.name?.text ?? "<default>", stmt, isExported(stmt));
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const exported = isExported(stmt);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        // ラップされていても (`cache(async () => {})` 等) 初期化子の部分木ごと見る
        push(decl.name.text, decl.initializer, exported);
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      push("<export default>", stmt.expression, true);
      continue;
    }
  }

  return units;
}

// ─── 解析の実行 ────────────────────────────────────────────────────────

type ServerFile = {
  path: string;
  relative: string;
  sf: ts.SourceFile;
  text: string;
  reach: AdminReach;
  units: Unit[];
};

const SERVER_FILES: ServerFile[] = [];

for (const filePath of listSourceFiles()) {
  const text = readFileSync(filePath, "utf8");
  // 安価な事前フィルタ: directive が無いファイルは構文解析すらしない
  if (!text.includes("use server")) continue;

  const sf = parse(filePath, text);
  const fileIsServer = hasUseServerDirective(sf.statements);
  if (!fileIsServer && !hasInlineServerAction(sf)) continue;

  SERVER_FILES.push({
    path: filePath,
    relative: path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/"),
    sf,
    text,
    reach: collectAdminImports(sf, filePath),
    units: collectUnits(sf, filePath, fileIsServer),
  });
}

/** Admin API に到達する解析単位 (ファイル横断)。 */
const ADMIN_BACKED: { unit: Unit; file: ServerFile; adminAt: number }[] = [];

for (const file of SERVER_FILES) {
  for (const unit of file.units) {
    const positions = adminReachPositions(unit.node, file.reach, file.path);
    if (positions.length > 0) {
      ADMIN_BACKED.push({ unit, file, adminAt: positions[0] });
    }
  }
}

const SUBSCRIPTION_ACTIONS = "lib/shopify/subscription-actions.ts";

describe("Admin API を叩く Server Action は所有者照合を必ず通る (構造不変条件)", () => {
  it("解析が成立している (Server Action ファイルと import を実際に拾えている)", () => {
    // 解析が空振りしていると以下の検査が全部 vacuously true になるので先に固定する
    const relatives = SERVER_FILES.map((f) => f.relative);

    expect(relatives).toContain(SUBSCRIPTION_ACTIONS);
    expect(relatives).toContain("lib/shopify/cart-actions.ts");

    const actions = SERVER_FILES.find((f) => f.relative === SUBSCRIPTION_ACTIONS)!;
    expect(actions.reach.names.size).toBeGreaterThan(0);
    expect(actions.units.map((u) => u.name)).toContain("changeDeliveryFrequencyAction");
    expect(actions.units.map((u) => u.name)).toContain(AUTHORIZE_HELPER);
  });

  it("Admin API 経路が少なくとも 1 つある (検査が空回りしていない)", () => {
    expect(ADMIN_BACKED.map((entry) => entry.unit.label).sort()).toEqual([
      `${SUBSCRIPTION_ACTIONS} :: changeDeliveryFrequencyAction`,
    ]);
  });

  it.each(ADMIN_BACKED.map((entry) => [entry.unit.label, entry] as const))(
    `%s は Admin API に触る前に ${AUTHORIZE_HELPER} を必ず通る位置で呼ぶ`,
    (_label, entry) => {
      const { unit, adminAt } = entry;

      expect(
        unit.bodyStatements,
        `${unit.label}: block 本体が取れず順序を判定できない。` +
          `Admin API を呼ぶ関数は通常の block 本体で書くこと。`
      ).not.toBeNull();

      const authorizeAt = unconditionalAuthorizePosition(unit.bodyStatements!);

      expect(
        authorizeAt,
        `${unit.label}: ${AUTHORIZE_HELPER}() が「必ず通る位置」に無い。` +
          `if / switch / ループ / 短絡評価 / コールバックの内側は、到達しない可能性が` +
          `あるので照合として数えない。`
      ).not.toBeNull();

      // 照合が Admin API 到達より前にあること (後から照合しても手遅れ)
      expect(
        authorizeAt!,
        `${unit.label}: ${AUTHORIZE_HELPER}() が Admin API 到達より後にある。`
      ).toBeLessThan(adminAt);
    }
  );

  it("照合 helper は共有 verifier を使い、自前実装しない", () => {
    const file = SERVER_FILES.find((f) => f.relative === SUBSCRIPTION_ACTIONS)!;
    const helper = file.units.find((unit) => unit.name === AUTHORIZE_HELPER);

    expect(helper, `${AUTHORIZE_HELPER} が見つからない`).toBeDefined();

    const body = helper!.node.getText();
    expect(body).toContain(`${OWNERSHIP_VERIFIER}(`);
    // fail-closed: 照合が真でなければ throw して呼び出し元に進ませない
    expect(body).toMatch(/throw\s+new\s+Error/);
  });

  it("照合 helper はどの Server Action ファイルからも露出していない", () => {
    // `"use server"` ファイルの export はすべて公開 HTTP エンドポイントになる。
    // helper が export されると、照合そのものを外から呼べる面が増える。
    const exposed = SERVER_FILES.flatMap((file) =>
      file.units
        .filter((unit) => unit.name === AUTHORIZE_HELPER && unit.exported)
        .map((unit) => unit.label)
    );
    expect(exposed).toEqual([]);
  });

  /**
   * 局所ルールの残る抜け道を塞ぐ tripwire。
   *
   * 判定は「その `"use server"` ファイルが admin モジュールを直接 import して
   * いるか」で行うので、admin を内側に隠した中継モジュールを挟むと検査を迂回
   * できる。中継が新しく増えたらここで落ちるので、レビューを経て
   * ALLOWED_ADMIN_INDIRECTIONS に載せる (または照合を通す形に直す)。
   */
  it("Server Action ファイルが Admin API を間接的に引き込む経路は棚卸し済みだけ", () => {
    const unreviewed: string[] = [];

    for (const file of SERVER_FILES) {
      for (const mod of importedModules(file.sf, file.path)) {
        if (ADMIN_MODULES.has(mod)) continue; // 直接 import は局所ルールで判定済み
        if (ALLOWED_ADMIN_INDIRECTIONS.has(mod)) continue;

        const candidate = [".ts", ".tsx"]
          .map((ext) => path.join(PROJECT_ROOT, `${mod}${ext}`))
          .find((full) => existsSync(full));
        if (!candidate) continue;

        const nested = importedModules(
          parse(candidate, readFileSync(candidate, "utf8")),
          candidate
        );
        if (nested.some((inner) => ADMIN_MODULES.has(inner))) {
          unreviewed.push(`${file.relative} -> ${mod}`);
        }
      }
    }

    expect(
      unreviewed,
      "Admin API を隠した中継モジュールが Server Action から使われている。" +
        "クライアント入力を Admin API に渡していないことを確認し、" +
        "ALLOWED_ADMIN_INDIRECTIONS に追記すること。"
    ).toEqual([]);
  });
});

/**
 * 「画面に固定される面が、正本の名前付きレイヤーを使わずに独自の重なり順を
 * 持っていないか」を **要素単位** で判定するスキャナ (2026-08-18)。
 *
 * `z-layer-single-source.test.ts` から使う。テストと分けてあるのは、同じ判定を
 * 別のツリー (過去 commit) へ当てて検出能力を実測できるようにするため。判定
 * ロジックの正本はこのファイルだけで、テスト側は結果を突き合わせるだけ。
 *
 * ## なぜ行単位ではなく AST なのか
 *
 * 前身は「1 行の中に `fixed`/`sticky` と `z-40` が同時に出るか」を見ていた。
 * これは書き方を変えるだけで素通りする:
 *
 *   (a) className を複数行に分けると `fixed` と `z-40` が別の行に来る
 *   (b) 任意値 `z-[9999]` は `z-\d+` にマッチしない
 *   (c) `style={{ zIndex: 40 }}` は Tailwind クラスを通らない
 *
 * 行は「同じ要素に載るか」と何の関係もない単位なので、行を単位にした時点で
 * この 3 つは原理的に塞げない。判定単位を **1 つの DOM 要素に載るクラスの束**
 * に変えると 3 つとも同じ 1 つの規則で落ちる。要素の境界は構文で決まるので、
 * 構文解析器 (TypeScript の parser) をそのまま使うのが最も素直で、マーカー
 * 文字列に依存しないぶん対象が増えても取りこぼさない。型情報は要らないので
 * `createSourceFile` (parse のみ) で足り、`tsc` の program を起こす必要はない。
 *
 * ## 判定 (positional AND raw-z)
 *
 * 1 単位が **両方**を満たしたときだけ挙げる:
 *
 *   positional … `fixed` / `sticky` (variant 付き `md:fixed` も含む)、
 *                または `style={{ position: "fixed" }}`
 *   raw-z      … `z-50` / `z-[9999]` / `-z-10` / `md:z-50` のような
 *                名前付きレイヤー経由でない z、または `--z-*` を参照しない
 *                `style={{ zIndex: ... }}`
 *
 * この AND が騒音対策の本体である。`relative z-10` や
 * `focus-visible:z-10`、`components/viz/**` のツールチップの `absolute z-10`
 * は positional を持たないので、そもそも候補に入らない。「z を全部禁止して
 * 例外を並べる」向きに倒すと 12 件の無関係な指摘が出て番人が死ぬので、
 * 対象を広げるのではなく判定の精度を上げる方向で解いている。
 */
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import ts from "typescript";

export type ZOffender = {
  /**
   * 行番号を含まない安定キー (`<相対パス> | <クラス>`)。行がずれても同じ違反を
   * 同じキーで指せるので、免除リストの照合に使える。
   */
  key: string;
  file: string;
  line: number;
  /** その単位が固定面だと判る根拠 (`fixed` / `sticky` / `style.position`)。 */
  positional: string;
  /** 名前付きレイヤーを経由していない z の指定。 */
  offending: string;
};

/** 固定面でも生スケールを使ってよい場所 (理由は各ファイルのコメントにある)。 */
export const FIXED_Z_ALLOWLIST = [
  // shadcn 上流のまま。ブリッジで名前付きレイヤーへ繋ぐので編集しない。
  "components/ui/",
  // 本文より前・ヘッダーより後ろ。常設 UI の段 (1020 以上) には載せない面。
  "components/journal/reading-progress.tsx",
  // 実装確認用のプレビュー面。本番の重なりに関与しない。
  "app/dev/",
  // Storybook の story は部品単体を並べる面で、下端固定 UI が居ない。
  ".stories.tsx",
];

/**
 * 免除。**「直った瞬間に赤くなる」** 形で運用する: ここに書いた違反が実際には
 * 見つからなくなったら、テストが「免除が古い」と言って落ちる。だから直した人
 * は必ずこの行を消すことになり、免除が惰性で残らない。
 */
export const PINNED_EXEMPTIONS: ReadonlyArray<{
  key: string;
  reason: string;
}> = [
  {
    key: "components/viz/wash/reading-wash.tsx | -z-10",
    reason:
      "本文の背後へ沈める全画面の背景。負の段なので正の名前付きレイヤー (1020 以上) と競合しない。" +
      "負の段の正本 (--z-behind 等) を作るまでは生スケールのまま置く。",
  },
];

export const SCAN_DIRS = ["app", "components", "stories"];

export function isAllowlisted(relPath: string): boolean {
  return FIXED_Z_ALLOWLIST.some((allowed) => relPath.includes(allowed));
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * `md:z-50` や `supports-[display:grid]:fixed` から「ユーティリティ本体」だけを
 * 取り出す。variant の区切りは `:` だが、`[...]` / `(...)` の内側の `:` は区切り
 * ではないので、括弧内を潰してから最後の `:` で切る。
 */
export function utilityPart(token: string): string {
  let depth = 0;
  let masked = "";
  for (const ch of token) {
    if (ch === "[" || ch === "(") depth += 1;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    masked += depth > 0 && ch === ":" ? "_" : ch;
  }
  const lastColon = masked.lastIndexOf(":");
  return lastColon === -1 ? token : token.slice(lastColon + 1);
}

/** 名前付きレイヤー経由の z (`z-(--z-modal)` / `z-[var(--z-modal)]`)。 */
const NAMED_LAYER_Z =
  /^-?z-(?:\(--z-[a-z0-9-]+\)|\[var\(--z-[a-z0-9-]+\)\])$/;

export function isPositionalToken(token: string): boolean {
  const util = utilityPart(token);
  return util === "fixed" || util === "sticky";
}

/** 生スケール / 任意値の z なら返す。名前付きレイヤー経由なら null。 */
export function rawZToken(token: string): string | null {
  const util = utilityPart(token);
  if (!/^-?z-/.test(util)) return null;
  if (util === "z-auto" || util === "-z-auto") return null;
  if (NAMED_LAYER_Z.test(util)) return null;
  return token;
}

type Unit = {
  line: number;
  /** クラス文字列から取れたトークン。 */
  tokens: string[];
  /** `style={{ position: ... }}` が固定面を作っているか。 */
  stylePosition: string | null;
  /** `style={{ zIndex: ... }}` の式のソース文字列。 */
  styleZIndex: string | null;
};

function collectStringLiterals(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteralLike(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      out.push(span.literal.text);
      collectStringLiterals(span.expression, out);
    }
    return;
  }
  ts.forEachChild(node, (child) => collectStringLiterals(child, out));
}

function tokenize(strings: string[]): string[] {
  return strings.flatMap((value) => value.split(/\s+/)).filter(Boolean);
}

function scriptKindFor(relPath: string): ts.ScriptKind {
  return extname(relPath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * 1 ファイルを「同じ要素に載るクラスの束」に切り分ける。
 *
 * - Pass A: JSX 要素 1 個 = 1 単位。`className` 配下の文字列を全部 (何行に
 *   分かれていても・`cn()` の何段目でも) 集め、`style` の位置と z も同じ単位に
 *   入れる。これが (a) と (c) を塞ぐ。
 * - Pass B: JSX に載っていない文字列 (`cva()` の base と variants、定数に
 *   切り出したクラス列) は、囲っている呼び出し / 宣言ごとに 1 単位にする。
 *   cva の base と variants は最終的に同じ要素へマージされるので、束ねるのが
 *   意味的にも正しい。行単位検査が拾えていた「JSX の外のクラス文字列」を
 *   落とさないための経路でもある。
 */
export function extractUnits(relPath: string, source: string): Unit[] {
  const sf = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relPath),
  );
  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const units: Unit[] = [];
  const consumed = new Set<ts.Node>();

  const markConsumed = (node: ts.Node) => {
    consumed.add(node);
    ts.forEachChild(node, markConsumed);
  };

  const visitJsx = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const classStrings: string[] = [];
      let stylePosition: string | null = null;
      let styleZIndex: string | null = null;
      let hasAttr = false;

      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
        const name = attr.name.getText(sf);
        if (name === "className" || name === "class") {
          hasAttr = true;
          collectStringLiterals(attr.initializer, classStrings);
          markConsumed(attr.initializer);
        } else if (name === "style") {
          hasAttr = true;
          markConsumed(attr.initializer);
          for (const prop of findStyleProperties(attr.initializer)) {
            if (prop.name === "position") stylePosition = prop.text;
            if (prop.name === "zIndex") styleZIndex = prop.text;
          }
        }
      }

      if (hasAttr) {
        units.push({
          line: lineOf(node),
          tokens: tokenize(classStrings),
          stylePosition,
          styleZIndex,
        });
      }
    }
    ts.forEachChild(node, visitJsx);
  };
  visitJsx(sf);

  // Pass B: JSX の className/style に載っていない文字列。
  const groups = new Map<ts.Node, { line: number; strings: string[] }>();
  const visitRest = (node: ts.Node) => {
    if (
      !consumed.has(node) &&
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
    ) {
      const container = groupContainerOf(node);
      const existing = groups.get(container);
      const strings: string[] = [];
      collectStringLiterals(node, strings);
      if (existing) existing.strings.push(...strings);
      else groups.set(container, { line: lineOf(node), strings });
      // TemplateExpression の中の文字列は上で回収済み。
      if (ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visitRest);
  };
  visitRest(sf);

  for (const group of groups.values()) {
    units.push({
      line: group.line,
      tokens: tokenize(group.strings),
      stylePosition: null,
      styleZIndex: null,
    });
  }

  return units;
}

/**
 * Pass B の単位の境界。近い順に「囲っている呼び出し」→「宣言 / プロパティ」→
 * 文字列そのもの。`cn(...)` / `cva(...)` を名前で判定しない (マーカー文字列に
 * 依存すると別名の helper で素通りする) ので、呼び出しなら何でも 1 単位にする。
 */
function groupContainerOf(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  let fallback: ts.Node | null = null;
  while (current) {
    if (ts.isCallExpression(current)) return current;
    if (
      !fallback &&
      (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current))
    ) {
      fallback = current;
    }
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return fallback ?? node;
}

function findStyleProperties(
  initializer: ts.Node,
): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteralLike(node.name)
          ? node.name.text
          : null;
      if (name) out.push({ name, text: node.initializer.getText() });
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return out;
}

function evaluateUnit(relPath: string, unit: Unit): ZOffender[] {
  const positionalToken = unit.tokens.find(isPositionalToken);
  const stylePositional =
    unit.stylePosition && /^["'`]?(fixed|sticky)["'`]?$/.test(unit.stylePosition)
      ? `style.position=${unit.stylePosition}`
      : null;
  const positional = positionalToken ?? stylePositional;
  if (!positional) return [];

  const offenders: ZOffender[] = [];
  const seen = new Set<string>();
  for (const token of unit.tokens) {
    const raw = rawZToken(token);
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    offenders.push({
      key: `${relPath} | ${raw}`,
      file: relPath,
      line: unit.line,
      positional,
      offending: raw,
    });
  }
  // `style={{ zIndex: ... }}` は `--z-*` を参照していなければ独自の段。
  if (unit.styleZIndex && !unit.styleZIndex.includes("--z-")) {
    const label = `style.zIndex=${unit.styleZIndex}`;
    offenders.push({
      key: `${relPath} | ${label}`,
      file: relPath,
      line: unit.line,
      positional,
      offending: label,
    });
  }
  return offenders;
}

/**
 * CSS 側の同じ規則。単位は「1 つの宣言ブロック」で、`position: fixed` (または
 * `@apply fixed`) と生の `z-index` / `@apply z-50` が同じブロックに同居したら
 * 挙げる。`.z-50 { z-index: var(--z-modal) }` のようなブリッジは position を
 * 持たないので候補に入らない。
 */
export function scanCss(relPath: string, source: string): ZOffender[] {
  const offenders: ZOffender[] = [];
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;

  // ブロックの中身だけを、入れ子を除いて取り出す。
  const stack: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "{") stack.push(i);
    else if (source[i] === "}") {
      const open = stack.pop();
      if (open === undefined) continue;
      const body = source
        .slice(open + 1, i)
        // 入れ子のブロックは自分の番で見るので、ここでは中身を落とす。
        .replace(/\{[^{}]*\}/g, " ");
      const positionalDecl = body.match(/position\s*:\s*(fixed|sticky)\b/);
      const applyTokens = [...body.matchAll(/@apply\s+([^;}]+)/g)].flatMap((m) =>
        m[1].split(/\s+/).filter(Boolean),
      );
      const positionalApply = applyTokens.find(isPositionalToken);
      const positional = positionalDecl
        ? `position: ${positionalDecl[1]}`
        : positionalApply
          ? `@apply ${positionalApply}`
          : null;
      if (!positional) continue;

      const rawDecl = body.match(/z-index\s*:\s*(-?\d+)/);
      const rawApply = applyTokens.map(rawZToken).find(Boolean);
      const offending = rawDecl
        ? `z-index: ${rawDecl[1]}`
        : rawApply
          ? `@apply ${rawApply}`
          : null;
      if (!offending) continue;

      offenders.push({
        key: `${relPath} | ${offending}`,
        file: relPath,
        line: lineAt(open),
        positional,
        offending,
      });
    }
  }
  return offenders;
}

/** 1 ファイル分のソースを直接判定する (合成ソースでの回帰テスト用の入口)。 */
export function scanSource(relPath: string, source: string): ZOffender[] {
  if (extname(relPath) === ".css") return scanCss(relPath, source);
  return extractUnits(relPath, source).flatMap((unit) =>
    evaluateUnit(relPath, unit),
  );
}

/**
 * ツリー全体を走査する。`applyAllowlist` を false にすると許可リストも通さない
 * 生の結果が返る (過去 commit に対する検出能力の実測に使う)。
 */
export function scanTree(
  root: string,
  options: { applyAllowlist?: boolean } = {},
): ZOffender[] {
  const applyAllowlist = options.applyAllowlist !== false;
  const offenders: ZOffender[] = [];
  for (const dir of SCAN_DIRS) {
    let files: string[];
    try {
      files = listFiles(join(root, dir));
    } catch {
      continue; // 過去 commit に無いディレクトリ。
    }
    for (const file of files) {
      const relPath = relative(root, file);
      if (applyAllowlist && isAllowlisted(relPath)) continue;
      const source = readFileSync(file, "utf8");
      if (extname(file) === ".css") {
        offenders.push(...scanCss(relPath, source));
        continue;
      }
      for (const unit of extractUnits(relPath, source)) {
        offenders.push(...evaluateUnit(relPath, unit));
      }
    }
  }
  return offenders;
}

export function formatOffender(offender: ZOffender): string {
  return `${offender.file}:${offender.line} \`${offender.offending}\` (${offender.positional}) — z-(--z-*) を使うこと`;
}

/**
 * eslint-plugin-elxea-tokens / no-silent-catch-at-boundary
 *
 * 「外の世界と話す場所で失敗を握り潰さない」を**機械的に**強制するルール。
 *
 * 一次入力 (仕様の正本):
 *   `lib/shopify/load-result.ts` — 「引けなかった」を調査できる形で残す出口 (憲章 R1)
 *   `lib/log/index.ts`           — サーバ側の記録の単一経路 (憲章 Wave 3)
 *
 * ■ なにを止めるのか
 *
 * 憲章 R1 は Wave 0 で `lib/shopify` のセッション読み出しにだけ入った。そこでは
 * 実害が確定している — Shopify 側の障害がそのまま「ログアウト」「契約 0 件」として
 * 顧客に描画され、サーバには `console.error` が 1 行残るだけで**アラートは鳴らな
 * かった**。`console.error` は Vercel のログに落ちるだけで、集計もアラートも付いて
 * いない (経緯は `lib/shopify/load-result.ts` 冒頭)。
 *
 * 直したのは 1 区画だけで、**同じ書き方が残り全域にそのまま残っていた**。着手時点の
 * 実測で `captureException` は `app/api` に 12 件・`lib/shopify` に 3 件しかなく、
 * `lib/firebase` `lib/line` は 0 件、`components/**` も 0 件だった。装置を足しただけ
 * では再流入が止まらない、というのが憲章 R8 の指す失敗型そのものなので、Wave 0 と
 * 同じ処方を**網の側**に移す。
 *
 * ■ なにが違反か
 *
 * 下の対象区画 (eslint.config.mjs 参照) にある `catch` 節が、
 *   - 例外を投げ直しもせず (`throw`)
 *   - 調査できる形にも残さない (`Sentry.captureException` / `report*` / `logger.error`)
 * まま終わっている場合。
 *
 * 「握り潰し」は無言とは限らない。`catch { console.error(e); return null }` は
 * 一見ログを残しているが、**誰にも届かない**ので握り潰しと同じである。よって
 * `console.*` は満たしたことにしない。これがこのルールの要点。
 *
 * ■ なぜ標準ルールで書かないのか
 *
 * 標準の `no-empty` は「中身が空の catch」しか見ない。実際の事故は中身が空では
 * なく `console.error` が 1 行入っていた形だったので、`no-empty` では 1 件も
 * 捕まらない。`no-restricted-syntax` のセレクタでも「throw も捕捉呼び出しも
 * **無い**」という否定条件は書けない (:not() は兄弟の非存在を表現できない)。
 * 憲章 Wave 1 では同じ検討の結果セレクタ 1 本で足りたので自作していない。ここは
 * 足りないので自作する。
 *
 * ■ 「報告した」を名前だけで信じない (敵対検証 2026-08-27 の指摘)
 *
 * 呼び出しの**名前**だけで判定すると、その場で作った同名の入れ物でルールを
 * 黙らせられる — `const logger = console` と書けば `logger.error(e)` が通る。
 * 通るのに届かないので、このルールが止めたい状態そのものになる。よって
 * `logger` / `Sentry` / `captureException` は **`@/lib/log` か `@sentry/nextjs`
 * から import された名前**でなければ数えない。`report*` ヘルパは、import された
 * ものに加えて「本物の報告先を import しているファイルの中で定義されたもの」
 * まで認める (`lib/line/linkage-status.ts` のように、同じファイルに報告を
 * まとめる書き方は実在する正しい形なので)。
 *
 * ■ まだ見ていないもの (次の wave の的・**先に書いておく**)
 *
 * 網は `catch` 節だけを見る。同じ握り潰しは他の形でも書けるので、この網を
 * 「全部見た」と読まないこと。
 *
 *   - `promise.catch(() => null)` — catch 節ではないので当たらない
 *   - `if (!res.ok) { console.error(...); return null; }` — そもそも例外が
 *     起きていない。失敗を握り潰す形としては同じだが、判定には別の網が要る
 *   - `components/**` — 画面側は lint ではなく機構側 (`lib/interaction` の
 *     共通 hook と error boundary) で受けている。誤検出で例外表を膨らませない
 *     ため、意図的に網の外に置いている
 *
 * 対象を狭く始めるのは、例外表が肥大すると表そのものが読まれなくなるため。
 * 広げるときは移行と同じ変更で広げる (装置だけ先に足さない = 憲章 R8)。
 *
 * ■ 逃げ道 (意図的に狭くしてある)
 *
 * 1. **例外表** (`GRANDFATHERED`) — 着手時点の既存違反だけを、**ファイルごとの
 *    件数付きで**列挙してある。件数付きなのは、ファイル単位の許可だと同じ
 *    ファイルに新しい握り潰しを足し放題になるため。実測件数より 1 件でも増えれば
 *    落ちる。**減ったときも落ちる** (表の数字を下げろと言う) ので、表は縮小方向に
 *    しか動かない。各行に移行先の分類を併記してあり、ここが「残りの移行計画」でも
 *    ある。
 *
 * 2. **その場の明示** — 失敗そのものが答えである場所 (利用者入力の JSON パース等)
 *    は catch 節の中に `expected-failure: <理由>` コメントを書く。理由の記述が
 *    必須で、差分に必ず現れる。
 *
 * kill switch: eslint.config.mjs の該当行を "off" にする。
 */

import { readFileSync } from "node:fs";
import nodePath from "node:path";

/**
 * 着手時点で存在した握り潰し。**縮小方向にのみ更新する**。
 *
 * 値は「そのファイルに残っている握り潰しの件数」。併記した分類が移行先:
 *   report  … `Sentry.captureException` か `lib/log` の `logger.error` に載せる
 *   rethrow … 呼び出し側が判断すべきなので投げ直す
 *   expected … 失敗が答えである。`expected-failure:` コメントを書いて表から消す
 *
 * ここに載っていないファイルの新しい違反は 1 件目から落ちる。
 */
const GRANDFATHERED = new Map([
  // **空である**。着手時点の違反 75 件 / 44 ファイルは全件処置した
  //   (64 件を `logger.error` へ / 11 件を `expected-failure` として明示)。
  // 例外表を用意していたが使わずに済んだ。憲章 R8 の「全件移行 + 再流入止めで
  // 1 セット」を残件ゼロで満たしている。ここに 1 行足すと
  // `__tests__/failure-visibility.test.ts` が落ちる。
]);

/** 調査できる形に残したとみなす呼び出し。 */
const REPORTING_MEMBERS = new Set(["captureException", "captureMessage"]);

/** `lib/log` のレベル。`warn` / `info` は「残した」に数えない (届かないため)。 */
const LOGGER_REPORTING_LEVELS = new Set(["error", "fatal"]);

/**
 * 「本物の報告先」とみなす import 元。
 *
 * 名前だけで判定すると、その場で作った同名の入れ物で**ルールを黙らせられる**。
 *
 *   const logger = console;              // ← これで logger.error(e) が通ってしまう
 *   const logger = { error() {} };       // ← 何もしない入れ物でも通ってしまう
 *
 * どちらも「届かない記録」なので、このルールが止めたい状態そのものである。
 * よって**その名前が import 由来かどうか**まで見る (敵対検証の指摘 2026-08-27)。
 */
const REPORTING_MODULES = new Set(["@/lib/log", "@sentry/nextjs"]);

/** Wave 0 から使っている報告ヘルパの命名 (`reportLoadFailure` など)。 */
const REPORT_HELPER = /^report[A-Z]/;

/** 失敗が答えである場所の明示。理由の記述を必須にする。 */
const EXPECTED_FAILURE = /expected-failure:\s*\S/;

/**
 * `report*` を import している相手が**本当に報告しているか**を 1 ホップだけ確かめる。
 *
 * ## 塞いでいる穴 (Wave 3 QA 指摘 / 2026-08-27)
 *
 * 以前はここが「名前が `report` で始まれば、どこから import しても報告先」だった。
 * 同じファイル内で定義された `reportX` については「そのファイルが本物の報告先を
 * import しているか」を条件にしていたのに、**別ファイルから import した `reportX`
 * には同じ条件が掛かっていなかった**。つまり
 *
 *   // noop.ts
 *   export function reportNothing() {}
 *   // 使う側
 *   import { reportNothing } from "./noop";
 *   catch (e) { reportNothing(e); }   // ← これでルールが黙る
 *
 * が通った。ルールが止めたい状態そのもの (届かない記録) を、ルール自身が
 * 用意していたことになる。
 *
 * ## どこまで塞げて、どこが残るか (正直に書く)
 *
 * import 元のファイルを読み、**そのファイルが `@/lib/log` か `@sentry/nextjs` を
 * import しているか**だけを見る。これで上の noop は落ちる。
 *
 * 残る限界は 2 つ。どちらも「重いので今はやらない」ではなく、
 * **費用に見合わない**と判断した結果である:
 *
 *  1. **多段の連鎖**: A が B から `reportX` を import し、B は何もしないが
 *     `@sentry/nextjs` を import だけしている、という形は通る。追うには
 *     モジュールグラフ全体の解決が要り、lint 1 ファイルあたりの費用が跳ねる。
 *  2. **import はしているが呼んでいない**: 報告先を import しつつ `reportX` の
 *     中身が空、という形も通る。中身の到達可能性まで見るのは型情報が要る。
 *
 * どちらも「そう書けば黙らせられる」と知っている人が意図的に書く必要がある形で、
 * うっかり書ける形ではなくなった。うっかり書ける形を塞ぐのがこのルールの目的なので、
 * ここで止める。解決できないファイル (第三者パッケージ・解決失敗) は
 * **報告先として数えない** — 「分からないから通す」は検査ではないため。
 */
const REPORT_HELPER_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];

/** 一度読んだファイルの判定を憶えておく (同じヘルパは何度も import される)。 */
const reportingModuleCache = new Map();

function resolveImportPath(source, fromFile) {
  if (source.startsWith("@/")) {
    return nodePath.join(process.cwd(), source.slice(2));
  }
  if (source.startsWith("./") || source.startsWith("../")) {
    return nodePath.resolve(nodePath.dirname(fromFile), source);
  }
  // 第三者パッケージ。解決しない = 報告先として数えない。
  return null;
}

/** そのモジュールが本物の報告先を import しているか。1 ホップだけ見る。 */
function moduleReachesReporter(source, fromFile) {
  const base = resolveImportPath(source, fromFile);
  if (!base) return false;

  if (reportingModuleCache.has(base)) return reportingModuleCache.get(base);

  let reaches = false;
  for (const ext of REPORT_HELPER_EXTENSIONS) {
    let text;
    try {
      text = readFileSync(base + ext, "utf8");
    } catch {
      continue;
    }
    reaches = [...REPORTING_MODULES].some((mod) =>
      new RegExp(`from\\s+["']${mod.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}["']`).test(text),
    );
    break;
  }

  reportingModuleCache.set(base, reaches);
  return reaches;
}

function toPosix(filename) {
  return filename.replace(/\\/g, "/");
}

function relativeToRoot(filename) {
  const posix = toPosix(filename);
  const cwd = toPosix(process.cwd());
  return posix.startsWith(cwd + "/") ? posix.slice(cwd.length + 1) : posix;
}

/** 関数の入れ子。`throw` はここを跨ぐと呼び出し元に伝わらないので数えない。 */
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * この呼び出しは「調査できる形に残した」と数えてよいか。
 *
 * @param node       CallExpression
 * @param reporters  import 由来と確認できた報告先の名前
 */
function isReportingCall(node, reporters) {
  const callee = node.callee;

  if (callee.type === "Identifier") {
    // `captureException(...)` / `reportLoadFailure(...)` — import されたものだけ。
    return reporters.has(callee.name);
  }

  if (callee.type !== "MemberExpression" || callee.computed) return false;
  const property = callee.property;
  if (property.type !== "Identifier") return false;

  const object = callee.object;
  if (object.type !== "Identifier" || !reporters.has(object.name)) return false;

  // `Sentry.captureException(...)`
  if (REPORTING_MEMBERS.has(property.name)) return true;

  // `logger.error(...)` — lib/log の出口。`console.error` も `logger.warn` も含めない。
  return LOGGER_REPORTING_LEVELS.has(property.name);
}

/**
 * 例外を呼び出し元へ返す書き方。`throw` と同じ意味を持つので通す。
 *
 * `async` 関数の中では `return Promise.reject(err)` と `throw err` は同じで、
 * 素直に書く人がいる。拒否すると「正しいのに直させられる」ことになるので
 * 認める (敵対検証の指摘 2026-08-27)。
 */
function isRejection(node) {
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Promise" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "reject"
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "外部境界 (Shopify / Firebase / LINE / API ルート) の catch は、投げ直すか調査できる形に残す (console だけで済ませない)",
    },
    schema: [],
    messages: {
      silent:
        "この catch が失敗を握り潰しています。投げ直す (throw) か、Sentry.captureException / lib/log の logger.error で調査できる形に残してください。console だけでは誰にも届きません (Vercel のログに落ちるだけで、集計もアラートも付いていない)。失敗そのものが答えである場所なら catch の中に `expected-failure: <理由>` と書いてください。",
      staleAllowlist:
        "例外表 ({{file}}) の件数が実際より多くなっています。実測 {{actual}} 件なので eslint-rules/no-silent-catch-at-boundary.mjs の GRANDFATHERED を {{actual}} に下げてください (0 なら行ごと消す)。表は縮小方向にしか動かしません。",
    },
  },

  create(context) {
    const filename = relativeToRoot(context.filename ?? context.getFilename());

    /* 型定義・テストは対象外 (外部境界ではない)。 */
    if (/\.(d\.ts|test\.tsx?|test\.ts)$/.test(filename)) return {};

    const source = context.sourceCode ?? context.getSourceCode();
    const allowed = GRANDFATHERED.get(filename) ?? 0;

    /**
     * import 由来と確認できた報告先の名前。
     *
     * `import` は本文より先に書かれるのが普通だが、順序に依存する作りにすると
     * 「たまたま下に書いた」だけで判定が変わる。**ファイルを読み終わってから**
     * まとめて判定する。
     */
    const reporters = new Set();

    /** このファイルが本物の報告先を import しているか。 */
    let hasReportingImport = false;

    /** 判定待ちの catch 節。 */
    const pending = [];

    /** 握り潰していると判定した catch 節。 */
    const silent = [];

    function isSilent(node) {
      let handled = false;

      /* catch 節の中を歩く。関数の入れ子に入ったら `throw` は数えない
         (呼び出し元へ伝わらないため) が、報告の呼び出しは数える。 */
      const walk = (current, insideNestedFunction) => {
        if (handled || current === null || typeof current !== "object") return;

        if (Array.isArray(current)) {
          for (const child of current) walk(child, insideNestedFunction);
          return;
        }

        if (typeof current.type !== "string") return;

        if (!insideNestedFunction && current.type === "ThrowStatement") {
          handled = true;
          return;
        }

        if (
          current.type === "CallExpression" &&
          (isReportingCall(current, reporters) ||
            (!insideNestedFunction && isRejection(current)))
        ) {
          handled = true;
          return;
        }

        // 内側の catch は自分で判定されるので、ここでは中身を見ない。
        if (current.type === "CatchClause" && current !== node) return;

        const nested = insideNestedFunction || FUNCTION_TYPES.has(current.type);
        for (const key of Object.keys(current)) {
          if (key === "parent") continue;
          walk(current[key], nested);
        }
      };

      walk(node.body, false);
      return !handled;
    }

    return {
      ImportDeclaration(node) {
        const from = node.source.value;
        if (typeof from !== "string") return;

        if (REPORTING_MODULES.has(from)) hasReportingImport = true;

        for (const specifier of node.specifiers) {
          const local = specifier.local?.name;
          if (!local) continue;

          /* `@/lib/log` / `@sentry/nextjs` から来た名前は本物の報告先。 */
          if (REPORTING_MODULES.has(from)) {
            reporters.add(local);
            continue;
          }

          /* `reportLoadFailure` 系は Wave 0 のヘルパ。ただし **import 元が本当に
             報告しているか**を 1 ホップ確かめる (`moduleReachesReporter` 冒頭に
             塞いだ穴と残る限界を書いてある)。以前はここが名前だけの判定で、
             `export function reportNothing() {}` を import すればルールを黙らせ
             られた。 */
          if (REPORT_HELPER.test(local) && moduleReachesReporter(from, filename)) {
            reporters.add(local);
          }
        }
      },

      CatchClause(node) {
        // `expected-failure:` の明示があれば、その場で終わり (理由が差分に残る)。
        const comments = source.getCommentsInside(node.body);
        if (comments.some((comment) => EXPECTED_FAILURE.test(comment.value))) return;

        pending.push(node);
      },

      "Program:exit"(programNode) {
        /* 同じファイルの中で報告をまとめている形 (`reportLinkageReadFailure` /
           `reportFailure` など) は実在する正しい書き方なので通す。ただし
           **そのファイルが本物の報告先を import している**ことを条件にする。
           何も import していないファイルの `reportX` は、名前だけそれらしい
           空の関数でありうるため。 */
        if (hasReportingImport) {
          for (const statement of programNode.body) {
            if (statement.type === "FunctionDeclaration" && statement.id) {
              if (REPORT_HELPER.test(statement.id.name)) reporters.add(statement.id.name);
              continue;
            }
            if (statement.type !== "VariableDeclaration") continue;
            for (const declarator of statement.declarations) {
              if (
                declarator.id.type === "Identifier" &&
                REPORT_HELPER.test(declarator.id.name)
              ) {
                reporters.add(declarator.id.name);
              }
            }
          }
        }

        for (const node of pending) {
          if (isSilent(node)) silent.push(node);
        }

        if (silent.length > allowed) {
          /* 例外表の枠を超えた分だけを報告する。どれを直しても数は合うので、
             「新しく足した 1 件」を特定させる必要はない。 */
          for (const node of silent.slice(allowed)) {
            context.report({ node, messageId: "silent" });
          }
          return;
        }

        if (allowed > 0 && silent.length < allowed) {
          context.report({
            node: programNode,
            messageId: "staleAllowlist",
            data: { file: filename, actual: String(silent.length) },
          });
        }
      },
    };
  },
};

export default rule;

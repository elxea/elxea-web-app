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
const LOGGER_OBJECTS = new Set(["logger", "log"]);
const LOGGER_REPORTING_LEVELS = new Set(["error", "fatal"]);

/** 失敗が答えである場所の明示。理由の記述を必須にする。 */
const EXPECTED_FAILURE = /expected-failure:\s*\S/;

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

function isReportingCall(node) {
  const callee = node.callee;

  if (callee.type === "Identifier") {
    // `captureException(...)` (named import) と `reportLoadFailure(...)` 系。
    return REPORTING_MEMBERS.has(callee.name) || /^report[A-Z]/.test(callee.name);
  }

  if (callee.type !== "MemberExpression" || callee.computed) return false;
  const property = callee.property;
  if (property.type !== "Identifier") return false;

  // `Sentry.captureException(...)` — 受け側の名前は問わない (import 別名を許す)。
  if (REPORTING_MEMBERS.has(property.name)) return true;

  // `logger.error(...)` — lib/log の出口。`console.error` は**含めない**。
  const object = callee.object;
  return (
    object.type === "Identifier" &&
    LOGGER_OBJECTS.has(object.name) &&
    LOGGER_REPORTING_LEVELS.has(property.name)
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

    /** 握り潰していると判定した catch 節。ファイルを読み終わってから件数で捌く。 */
    const silent = [];

    return {
      CatchClause(node) {
        const body = node.body;

        // `expected-failure:` の明示があれば、その場で終わり (理由が差分に残る)。
        const comments = source.getCommentsInside(body);
        if (comments.some((comment) => EXPECTED_FAILURE.test(comment.value))) return;

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

          if (current.type === "CallExpression" && isReportingCall(current)) {
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

        walk(body, false);

        if (!handled) silent.push(node);
      },

      "Program:exit"(programNode) {
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

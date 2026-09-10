/**
 * eslint-plugin-elxea-tokens / mutation-through-shared-primitive
 *
 * 「画面からサーバへ書き込むときは、必ず共通の通り道 (`lib/interaction`) を通す」
 * を**機械的に**強制するルール。
 *
 * 一次入力 (仕様の正本):
 *   `lib/interaction/mutation-classes.ts` — 操作の 3 分類と、分類ごとの約束
 *
 * ■ なにを止めるのか
 *
 * 「押した瞬間に効く」を画面ごとに手書きしていたので、直しが片方にしか入らない
 * 状態が常態化していた。実際、カートの数量は押した瞬間に数字が動いていた
 * (本番実測 16〜30ms) のに、ボタンが本番実測 1,905〜2,062ms のあいだ `disabled`
 * で、250ms 間隔の 2 回目は黙って捨てられていた (実測 6 → 7 / Setaka 実機指摘
 * 2026-08-26)。**速さではなく受付を閉じていた**という同じ間違いが、複数の画面に
 * 別々の形で書かれていた。
 *
 * 規約を文にするだけでは守られない (担当が変われば失効する) ので、通り道の側に
 * 埋めたうえで、**通らない書き方を lint で落とす**。
 *
 * ■ なにが違反か
 *
 * **ブラウザで走るモジュール**が、`lib/interaction` の共通の通り道を import せずに
 *   - Server Action とみなせる import (`@/lib/**\/*-actions`) を呼ぶ
 *   - `fetch(...)` を書き込みメソッド (POST / PUT / PATCH / DELETE) で呼ぶ
 * 場合。
 *
 * 呼び出し位置は見ない。`onClick={() => act()}` と `async function handle() { act() }`
 * は同じことなので、**書き方の違いで逃げられないように**ファイル単位で判定する。
 *
 * ■ 「ブラウザで走る」をどう決めるか (2026-08-27 / 憲章 R9)
 *
 * 当初はファイル冒頭の `"use client"` の 1 行だけを見ていた。これには 2 段の穴が
 * あり、**どちらも実際に踏まれていた**:
 *
 *   1. `eslint.config.mjs` の `files` が `components/**\/*.tsx` と `app/**\/*.tsx`
 *      だけを対象にしていたので、`lib/**` と `.ts` 全域がそもそもルールの視界に
 *      入っていなかった。`lib/favorites/client-store.ts` は `"use client"` + POST +
 *      例外表未登載という三拍子で、それでも `npx eslint` は 0 件だった。
 *   2. glob を広げても、**指令を持つのは境界のファイルだけ**なので `.ts` に 1 段
 *      切り出すだけで指令が消え、また見えなくなる。実際 `lib/firebase/behavior-tracker.ts`
 *      と `components/chat/elxea-chat-transport.ts` がこの形だった。
 *
 * よって判定を **import の道筋によるブラウザ到達可能性**に変える
 * (`eslint-rules/lib/browser-reachable.mjs`)。`"use client"` から値 import を辿り、
 * `"use server"` (= 呼び出しがネットワーク越しになる境界) で打ち切る。
 * ファイルを分割しても、拡張子を変えても、到達可能性は変わらない。
 *
 * ■ どう直すのか
 *
 *   - やり直しの利く操作 → `useOptimisticMutation`
 *   - 金銭・契約・フォーム → `usePessimisticMutation`
 *
 * どちらを使うかは `lib/interaction/mutation-classes.ts` の表で決める。
 *
 * ■ 逃げ道 (意図的に狭くしてある)
 *
 * 移行が済んでいない画面は下の `ALLOWLIST` に列挙してある。**増やす方向の変更は
 * 認めない** (減らすときだけ触る)。allowlist の変更は差分に必ず現れるので、
 * レビューで必ず目に入る = 人の記憶に頼らない。
 */

import { isBrowserReachable } from "./lib/browser-reachable.mjs";

/**
 * まだ共通の通り道に載せていない画面。**縮小方向にのみ更新する**。
 *
 * 併記した分類は `mutation-classes.ts` の表に従う移行先。棚卸しの結果を
 * そのまま持っているので、ここが「残りの移行計画」でもある。
 */
const ALLOWLIST = new Set([
  // --- 「押した瞬間の応答」ではない書き込み。
  //     `elxea-chat-transport.ts` は Vercel AI SDK の ChatTransport 実装で、
  //     往復の生存期間 (streaming・中断・再送) を SDK 側が持つ。共通 hook は
  //     応答を返さない (`enqueue` は成否しか返さない) ので、ここを通すと
  //     SSE の本体が受け取れない = 機構として噛み合わない。同じ流れの画面側
  //     (chat-bar / chat-panel / chat-message) は既にこの表に載っており、
  //     この行はその実装本体を同じ扱いに揃えるもの。**新しい例外ではない**
  //     (2026-08-27 / 憲章 R9 でルールの視界を広げた際に顕在化した)。
  "components/chat/elxea-chat-transport.ts",

  // --- pessimistic-commit — 金銭・契約。悲観のままが正しい。
  //     「関係ない操作まで止めない」の是正 (パネルの開閉・引き返す側) は済み。
  "components/account/subscription-actions.tsx",

  // --- pessimistic-form — フォーム送信。悲観のままが正しい。
  //     進行表示の即時化を確認したうえで通り道へ寄せる。
  "app/password/page.tsx",
  "app/[locale]/contact/contact-form.tsx",
  "app/[locale]/(reading)/tasting-note/feedback/tasting-note-form.tsx",
  "components/account/line-linkage-cta.tsx",
  "components/account/line-unlink-control.tsx",

  // --- 認証・連携の入口。押すと画面ごと遷移するので楽観更新の対象ではない。
  "app/[locale]/login/line-login-button.tsx",
  "app/[locale]/liff/link/liff-link-client.tsx",

  // --- 未移行 — 棚卸しで見つかった残り。移行時にこの行を消す。
  "components/chat/chat-bar.tsx",
  "components/chat/chat-message.tsx",
  "components/community/comment-section.tsx",
  "components/events/event-register-button.tsx",
  "components/account/events-section.tsx",
  "components/chat/chat-panel.tsx",
]);

/** Server Action が入っている場所とみなす import 元。 */
const ACTION_MODULE = /^@\/lib\/.*(-actions|\/actions)$/;

/** 書き込みとみなす HTTP メソッド。 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 共通の通り道。 */
const SHARED_PRIMITIVE = /^@\/lib\/interaction\//;

function toPosix(filename) {
  return filename.replace(/\\/g, "/");
}

function relativeToRoot(filename) {
  const posix = toPosix(filename);
  const cwd = toPosix(process.cwd());
  return posix.startsWith(cwd + "/") ? posix.slice(cwd.length + 1) : posix;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "画面からの書き込みは lib/interaction の共通 hook を通す (押した瞬間の反応・巻き戻し・言い直し・連打整理を機構側で保証する)",
    },
    schema: [],
    messages: {
      bypass:
        "この書き込みが共通の通り道を通っていません。`useOptimisticMutation` (やり直しの利く操作) か `usePessimisticMutation` (金銭・契約・フォーム) を使ってください。分類は lib/interaction/mutation-classes.ts の表で決めます。直に呼ぶと、押した瞬間の反応・失敗時の巻き戻し・言い直し・連打の整理がどれも付いてきません。",
    },
  },

  create(context) {
    const filename = relativeToRoot(context.filename ?? context.getFilename());
    if (ALLOWLIST.has(filename)) return {};

    /* 型定義・テスト・Storybook は対象外 (画面ではない)。 */
    if (/\.(d\.ts|test\.tsx?|stories\.tsx?)$/.test(filename)) return {};

    const source = context.sourceCode ?? context.getSourceCode();
    const text = source.getText();

    /* ブラウザで走らないファイルは対象外。指令を持つファイルは即座に対象
       (走査が空振りする環境 — RuleTester の仮想ファイル等 — でも従来どおり
       効かせるため、指令の判定を先に置く)。 */
    const declaresClient = /^\s*["']use client["']/m.test(text);
    if (!declaresClient && !isBrowserReachable(process.cwd(), filename)) return {};

    /** import された Server Action の名前。 */
    const actionNames = new Set();
    let usesSharedPrimitive = false;

    /**
     * import は本文より先に読み終わるとは限らない (ESLint は 1 パスで回る) ので、
     * 疑わしい呼び出しを溜めておき、**ファイルを読み終わってから**判定する。
     */
    const suspects = [];

    function isWriteFetch(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "fetch") return false;
      const init = node.arguments[1];
      if (!init || init.type !== "ObjectExpression") return false;
      return init.properties.some(
        (property) =>
          property.type === "Property" &&
          !property.computed &&
          (property.key.name === "method" || property.key.value === "method") &&
          property.value.type === "Literal" &&
          typeof property.value.value === "string" &&
          WRITE_METHODS.has(property.value.value.toUpperCase()),
      );
    }

    return {
      ImportDeclaration(node) {
        const from = node.source.value;
        if (typeof from !== "string") return;
        if (SHARED_PRIMITIVE.test(from)) usesSharedPrimitive = true;
        if (!ACTION_MODULE.test(from)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") actionNames.add(specifier.local.name);
        }
      },

      CallExpression(node) {
        if (node.callee.type === "Identifier" && actionNames.has(node.callee.name)) {
          suspects.push(node);
          return;
        }
        if (isWriteFetch(node)) suspects.push(node);
      },

      "Program:exit"() {
        if (usesSharedPrimitive) return;
        for (const node of suspects) {
          context.report({ node, messageId: "bypass" });
        }
      },
    };
  },
};

export default rule;

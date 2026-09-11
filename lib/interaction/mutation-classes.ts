/**
 * 操作の 4 分類。**サイト全体でここが正本**。
 *
 * 「押したのに何も起きない時間」をゼロにするのが目的だが、**何でも楽観更新に
 * すればよいわけではない**。取り消しの利かない操作を先に見せると、外れたときに
 * 「一度成立したように見えたものが無かったことになる」という、遅さより重い
 * 裏切りが起きる。そこで操作を 3 つに分け、**分類ごとに守るべき約束を変える**。
 *
 * ## 分類と約束
 *
 * | 分類 | 何が該当するか | 押した瞬間 | 受付 | 使う hook |
 * |---|---|---|---|---|
 * | `optimistic` | やり直しの利くトグル・数量 (お気に入り / カート増減 / 表示切替) | **結果を先に見せる** | **閉じない** | `useOptimisticMutation` |
 * | `pessimistic-commit` | 金銭・契約 (決済確定 / 定期便の停止・解約・頻度変更 / スキップ) | **進行を 0.3 秒以内に見せる** | 閉じる (二重送信を防ぐ) | `usePessimisticMutation` |
 * | `pessimistic-form` | フォーム送信 (問い合わせ / 記録の投稿 / 連携解除) | **進行を 0.3 秒以内に見せる** | 送信ボタンだけ閉じる | `usePessimisticMutation` |
 * | `request-response` | 応答の本体が要る往復 (音声の入場券 / 会話のストリーム開始) | **進行を 0.3 秒以内に見せる** | **閉じない** (最中の再入は相乗り) | `createRequestCoalescer` |
 *
 * ## 4 本目はなぜ要ったのか (2026-09-12 / 音声の配線)
 *
 * 上 3 つの一次操作は**成否しか返さない** (`WriteOutcome`)。押した結果が画面の値で
 * 完結する操作はそれで足りるが、**サーバが渡してくるものを持ち帰らないと次が
 * 始まらない**操作がある。音声の入場券 (`access_token` / `session_handle`) と、
 * 会話のストリーム (SSE の本体) の 2 つで、どちらも「押した瞬間に効く」の対象
 * **である**のに、機構として噛み合わないという理由だけで通り道の外に置かれていた
 * (`components/chat/elxea-chat-transport.ts` が例外表に入っているのがそれ)。
 *
 * だから例外表を 1 行増やすのではなく、**通り道の側に応答を返せる形を足した**。
 * 約束 (下の「共通の約束」) は 3 分類とまったく同じものを負う。
 *
 * ## 共通の約束 (4 分類すべて)
 *
 *   1. **0.3 秒以内に必ず画面が変わる** — 結果 (`optimistic`) か進行 (`pessimistic-*`)。
 *      「押したがまだ何も変わらない」状態を作らない。
 *   2. **黙って戻さない** — 失敗して巻き戻すときは必ず言い直す。
 *   3. **進行を理由に関係ない操作まで止めない** — 閉じるのは、その操作自身の
 *      入口だけ。パネルを閉じる・引き返すような**サーバに触らない操作は常に開けておく**。
 *
 * ## 迷ったときの決め方
 *
 * 「外れて元に戻ったとき、お客さまは**損をするか**」で決める。
 *
 *   - 保存済みが未保存に戻る → 押し直せばよい → `optimistic`
 *   - 解約できたと思ったのに続いていた → 損をする → `pessimistic-commit`
 *
 * 金銭・契約を `optimistic` にしないこと。速さのために、成立したかどうかの
 * 曖昧さを客に押しつけることになる。
 *
 * ## 迂回の禁止
 *
 * 分類がどれであっても、書き込みは `lib/interaction` の hook を通す。直に
 * Server Action や `fetch` を `onClick` から呼ぶと、上の約束が 1 つも付いてこない
 * (実際、そうやって書かれた画面が「押しても 2 秒動かない」の発生源だった)。
 * `eslint-rules/mutation-through-shared-primitive.mjs` が機械的に見張る。
 */

export const MUTATION_CLASSES = [
  "optimistic",
  "pessimistic-commit",
  "pessimistic-form",
  "request-response",
] as const;

export type MutationClass = (typeof MUTATION_CLASSES)[number];

/**
 * 押した瞬間に画面へ出すもの。**どの分類でも「何も出ない」は無い**。
 *
 * - `result`   … 結果そのもの (楽観更新)
 * - `progress` … 進行の印 (回転する印・「送信しています」など)
 */
export function immediateFeedbackFor(mutationClass: MutationClass): "result" | "progress" {
  return mutationClass === "optimistic" ? "result" : "progress";
}

/**
 * その操作自身の入口を、往復のあいだ閉じるか。
 *
 * 閉じるのは**悲観の 2 つだけ**。**ここが「2 秒動かない」の正体**だったので、
 * 既定を開けておく側に倒してある。
 *
 * `request-response` が `false` なのは、二重送信の実害が無い一方で「押したのに
 * 何も起きない」の実害はそのまま在るから。最中の再入は弾かずに
 * **いま飛んでいる往復へ相乗りさせる** (`createRequestCoalescer`)。
 */
export function locksWhilePendingFor(mutationClass: MutationClass): boolean {
  return mutationClass === "pessimistic-commit" || mutationClass === "pessimistic-form";
}

/**
 * 押した瞬間から、画面が変わるまでに許される時間 (ms)。
 *
 * Setaka の要件「タップ→視覚反映 0.3 秒以内」をそのまま数値にしたもの。
 */
export const IMMEDIATE_FEEDBACK_BUDGET_MS = 300;

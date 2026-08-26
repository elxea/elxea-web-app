/**
 * 端末の前に居る人が入れ替わったときに、タブに残っているものを断ち切る判断。
 *
 * ## なぜ関数として切り出すのか (QA 指摘 2026-08-25)
 *
 * この「全消し」は `ChatProvider` の `useEffect` の中に直接書かれていた。
 * つまり **どの分岐も何のテストにも掛かっていなかった** — 4 つの後始末のうち
 * 1 つを消しても、条件を `!==` から `===` に変えても、テストは全部緑のまま通る。
 * 共用端末で前の人の会話が出るかどうかを決めている層としては、あってはならない
 * 状態だった。判断と後始末をここへ移し、`ChatProvider` は配線だけを持つ。
 *
 * ## 断ち切る条件
 *
 * **入口の署名** (`authSignatureFromCookie`: `""` / `"s"` / `"l"` / `"sl"`) が
 * 前回と変わったとき。真偽値 1 つ (Shopify にログイン中か) で見ていたのが
 * 元の穴で、LINE だけで入っている人はログイン・ログアウトのどちらでも
 * 値が動かず、入れ替わりが**一度も観測されなかった**。
 *
 * 初回 (`prev === null`) は断ち切らない。比べる相手が無いだけで、入れ替わりが
 * 起きた証拠は何も無いため — ここで消すと、普通に読み込み直しただけの人の
 * 会話が毎回巻き戻る。
 */

export type AuthTransitionEffects = {
  /** タブに残っている作り置きを全部捨てる。 */
  clearCache: () => void;
  /** 会話 ID を振り直す (cx-agent 側の会話も引き継がせない)。 */
  rotateSession: () => void;
  /** 解決済みの本人 ID を忘れる。 */
  forgetIdentity: () => void;
  /** 画面に出ている発言を捨てる。 */
  resetMessages: () => void;
};

/**
 * @param previous 直前の署名。初回は null。
 * @param next いまの署名。
 * @returns 断ち切ったら true (呼び出し側はこの後の処理を打ち切る)
 */
export function applyAuthTransition(
  previous: string | null,
  next: string,
  effects: AuthTransitionEffects,
): boolean {
  if (previous === null) return false;
  if (previous === next) return false;

  /* 4 つとも要る。1 つでも欠けると前の人の痕跡が残る:
       作り置き … 鍵が一致すれば TTL の残りだけ読めてしまう
       会話 ID  … サーバ側の会話がそのまま続く
       本人 ID  … 次の鍵が前の人の指紋で組まれる
       発言     … いま画面に出ているものは通信と無関係に残る */
  effects.clearCache();
  effects.rotateSession();
  effects.forgetIdentity();
  effects.resetMessages();
  return true;
}

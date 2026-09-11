/**
 * `?error=<code>` → i18n メッセージキーの対応表。
 *
 * ## なぜ component から切り出してあるか
 *
 * この表は「認証 route が付けたエラーが、ユーザーに文言として届くか」を決める
 * 唯一の場所で、そこが切れていても画面は正常に見える (無言のログイン画面が出るだけ)。
 * 目視では気づけない種類の欠陥なので、テストから直接読めるように "use client" の
 * component から分離してある (component 側を import すると next-intl /
 * next/navigation まで引き込むことになり、node のユニットテストから触りにくい)。
 *
 * ## 追加するときに必ず両方やること
 *
 * 1. route の redirect 先を `/{locale}/login?error=<キー>` にする
 *    (`/account?error=...` は middleware がクエリを落とすため**届かない**)
 * 2. ここにキーを登録し、`messages/ja.json` `messages/en.json` の `login` に文言を足す
 *
 * 片方だけだと「エラーなのに無言」に戻る。`__tests__/auth-error-keys.test.ts` が
 * この 2 つの整合を機械的に見ている。
 */
export const ERROR_KEY_MAP: Record<string, string> = {
  LineAuthFailed: "errorLineAuthFailed",
  StateMismatch: "errorStateMismatch",
  TokenFailed: "errorTokenFailed",
  /* token 交換が `invalid_client` で落ちたとき = **こちらのチャネル設定が壊れている**。
   *
   * `TokenFailed` から分けてあるのは文言の問題ではなく、**案内が嘘になる**から。
   * `invalid_client` は client_id / client_secret の組が拒否された状態で、
   * 誰が何度やり直しても必ず同じところで落ちる。そこに「もう一度お試しください」を
   * 出すのは、直らないものを直るかのように見せて無限の再試行に誘導する行為で、
   * 2026-08-22 / 2026-08-25 の本番障害の間、実際にそれが起きていた。
   * 復旧を待ってもらうしかない以上、待ってもらえる文言を出す。 */
  MisconfiguredChannel: "errorMisconfiguredChannel",
  ProfileFailed: "errorProfileFailed",
  NotConfigured: "errorNotConfigured",
  MissingParams: "errorMissingParams",
  Unexpected: "errorUnexpected",
  /* id_token の検証で拒否したとき (Shopify / LINE 共通)。署名・nonce・iss・aud・exp の
   * どれで落ちたかは **出さない** — 内訳を見せると検証器を外から探る手がかりになる。
   * ユーザーにとってはどれも「もう一度ログインしてください」で行動が同じなので、
   * 1 つの文言に畳んでいる。 */
  InvalidIdToken: "errorInvalidIdToken",
  /* 検証そのものが行えなかったとき (Shopify の公開鍵を取得できない等)。ユーザーの
   * やり直しでは直らない可能性があるので、文言を分けて「時間をおいて」と伝える。 */
  VerificationUnavailable: "errorVerificationUnavailable",
};

/** 未知のコードが来たときに使う既定キー。 */
export const FALLBACK_ERROR_MESSAGE_KEY = "errorUnexpected";

/** `?error=` に載る「チャネル設定が壊れている」の値。route と画面で共有する。 */
export const MISCONFIGURED_CHANNEL_CODE = "MisconfiguredChannel";

/**
 * 「今この画面は、直らない失敗から戻ってきたのか」を URL のクエリから判定する。
 *
 * ## なぜ文言だけでは足りないのか
 *
 * バナーに「復旧作業中です」と出しても、その真下に押せる LINE ログインボタンが
 * あれば人は押す。押せば必ず同じところで落ちて、また同じ画面に戻ってくる。
 * **再試行を止めるとは、再試行の入口を閉じること**であって、注意書きを足すことでは
 * ない。`line-login-button.tsx` がこれを見て、ボタンを「現在ご利用いただけません」の
 * 無効状態にする。
 *
 * 判定を `?error=` に依存させているので、`/login` を直接開き直せば通常状態に戻る —
 * 復旧後に画面が固まったままにならない（この状態はサーバー側に保存しない）。
 */
export function channelMisconfiguredInSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get("error") === MISCONFIGURED_CHANNEL_CODE;
  } catch {
    return false;
  }
}

/** `?error=` の値を i18n キーに解決する。未知の値は既定キーに倒す。 */
export function resolveAuthErrorMessageKey(errorCode: string): string {
  return ERROR_KEY_MAP[errorCode] ?? FALLBACK_ERROR_MESSAGE_KEY;
}

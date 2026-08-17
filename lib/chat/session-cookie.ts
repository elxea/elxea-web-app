/**
 * `chat_session_id` クッキー (ブラウザ側 `document.cookie` 書き込み) の文字列を組む。
 *
 * ## なぜ `Secure` を条件付きにするのか (これを無条件に戻してはいけない)
 *
 * 非 secure origin — たとえば社内 LAN やテスト環境の `http://192.168.x.x` — では、
 * ブラウザは `Secure` 付きクッキーを **例外も警告も出さずに破棄する**。
 * `document.cookie` への代入は失敗しても throw しないため、書けたのか捨てられたのかを
 * 呼び出し側から区別できない。その結果、
 * 「LINE ログイン後の identity linking が非 secure origin で無言で成立しない」
 * という、コードの見た目が正しいままの故障になる。
 *
 * 判定に `window.isSecureContext` を使う理由:
 *   - `localhost` は http でも secure context 扱いなので、**localhost の挙動は不変**
 *     (従来どおり `Secure` が付く)
 *   - 本番 (https://elxea.com) も当然 secure context なので、**本番の挙動も不変**
 *   - 変わるのは「非 secure origin では `Secure` を落として書き込みを成立させる」点だけ
 *
 * この方針はサーバ側の cookie 書き込みが一貫して
 * `secure: process.env.NODE_ENV === "production"` と条件付きにしているのと同じ思想で、
 * ブラウザ側の 1 箇所だけが規約から外れていたのを揃えたもの。
 *
 * 純関数として切り出してあるのは、jsdom を持ち込まずに
 * `__tests__/chat-session-cookie.test.ts` で退行を検知できるようにするため。
 */

export const CHAT_SESSION_COOKIE = "chat_session_id";

/** identity linking の往復に足りる最短の寿命 (秒)。長く残す価値がない。 */
export const CHAT_SESSION_COOKIE_MAX_AGE = 300;

/**
 * @param sessionId localStorage `elxea-chat-session-id` の値
 * @param isSecureContext `window.isSecureContext` (secure context か)
 */
export function buildChatSessionCookie(
  sessionId: string,
  isSecureContext: boolean,
): string {
  const attrs = `path=/;max-age=${CHAT_SESSION_COOKIE_MAX_AGE};SameSite=Lax`;
  const base = `${CHAT_SESSION_COOKIE}=${sessionId};${attrs}`;
  // 非 secure origin では `Secure` を付けない (付けるとブラウザが黙って捨てる)。
  return isSecureContext ? `${base};Secure` : base;
}

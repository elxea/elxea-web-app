/**
 * LINE 純正 Account Link（アカウント連携）の web 側ヘルパー。
 *
 * 一次情報: https://developers.line.biz/ja/docs/messaging-api/linking-accounts/
 *
 * 役割:
 *   Bot（cx-agent）が発行した linkToken を受け取り、ログイン済みのお客さまを確定してから
 *   cx-agent に nonce を発行させ、LINE の連携ダイアログへ 302 で送り出す。
 *   本ファイルは「値の形式ゲート」と「連携入口で使うクッキー名」だけを持つ純粋な部品で、
 *   認証・連携の判断は route（app/[locale]/link/route.ts）が行う。
 *
 * 秘密の扱い（重要）:
 *   linkToken は **URL クエリで渡ってくる**。漏れると他人がその人の連携を横取りできるため、
 *   route 側で (1) ログ出力しない (2) 画面に描画しない (3) Referrer-Policy: no-referrer を付ける
 *   （リファラ経由で外部に漏らさない）を徹底する。
 */

import { COOKIE_NAME } from "@/lib/auth/cookie-names";

/**
 * 未ログインでログインへ迂回する間、linkToken を退避する httpOnly クッキー名。
 * URL に linkToken を持ち回らせない（戻り先 URL に載せない）ためのもの。
 */
export const ACCOUNT_LINK_TOKEN_COOKIE = COOKIE_NAME.accountLinkToken;

/** 退避クッキーの寿命（秒）。linkToken 自体が 10 分で失効するため、それ以上持たせない。 */
export const ACCOUNT_LINK_TOKEN_COOKIE_MAX_AGE = 10 * 60;

/**
 * linkToken の形式ゲート（防御的なだけで、認証ではない）。
 * 実測の linkToken は 32 文字の英数字。LINE は長さを仕様として固定していないため幅を持たせ、
 * URL に載せる前のゴミ・過大長・記号混入だけを弾く。
 */
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{8,512}$/;

/** linkToken として受け付けてよい形式か（純粋）。 */
export function isValidLinkTokenFormat(value: unknown): value is string {
  return typeof value === "string" && LINK_TOKEN_RE.test(value);
}

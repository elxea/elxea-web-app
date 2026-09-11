import { cookies } from "next/headers";

import { COOKIE_NAME } from "@/lib/auth/cookies";
import { decryptToken } from "@/lib/shopify/customer";

/**
 * LINE セッションの本人（サーバ確定の LINE userId）を読む — ここが唯一の読み口。
 *
 * ## なぜ関数にするか
 *
 * 「LINE でログインしている本人は誰か」の判定は、cookie 2 本の組み合わせで決まる。
 *   - `line_session` … httpOnly。**認証の正本**（middleware の /account ガードも
 *     これを見る）。JS からは読めず消せない
 *   - `line_uid`     … 暗号化済みの LINE userId。復号できて初めて本人が確定する
 *
 * これを呼び出し側それぞれで書くと、片方だけ見る実装（＝暗号化 cookie を復号せずに
 * 「LINE ログイン中」と決める / 復号に失敗しても通す）が混ざり、**ブラウザ自己申告の
 * 値で他人を名乗れる**穴になる。復号を通った値だけを返す口を 1 つにしておく。
 *
 * ⚠ 戻り値は **サーバ検証済み**として扱ってよい唯一の LINE userId。逆に、リクエスト
 * ボディやクエリから受け取った LINE userId を連携台帳の読み書きに渡してはならない
 * （`lib/line/linkage-status.ts` / `lib/line/unlink.ts` の前提もこれ）。
 *
 * @returns 復号済みの LINE userId。LINE セッションが無い / 復号できないときは null。
 */
export async function readVerifiedLineUserId(): Promise<string | null> {
  return readVerifiedLineUserIdFrom(await cookies());
}

/** cookie store を既に持っている呼び出し側（`resolveIdentity` 等）向けの同期版。 */
export function readVerifiedLineUserIdFrom(store: CookieReader): string | null {
  if (!store.has(COOKIE_NAME.lineSession)) return null;

  const encrypted = store.get(COOKIE_NAME.lineUid)?.value;
  if (!encrypted) return null;

  return decryptToken(encrypted) || null;
}

/** `cookies()` の戻り値のうち、本モジュールが使う分だけ。 */
type CookieReader = {
  get(name: string): { value: string } | undefined;
  has(name: string): boolean;
};

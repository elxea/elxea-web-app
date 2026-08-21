/**
 * 認証エラーが「文言として届くか」を機械的に見るテスト。
 *
 * ## なぜ要るか
 *
 * この経路は**壊れていても画面が正常に見える**。route が `?error=` を付けても、
 * (a) 飛ばす先がバナーの無いページだったり (b) キーが対応表に無かったり
 * (c) 対応表の値に対応する文言が messages に無かったりすると、ユーザーには
 * 「無言のログイン画面」が出るだけで、操作をミスしたのと区別が付かない。
 *
 * 実際 2026-08-21 のレビューで、Shopify の拒否が `/{locale}/account?error=invalid_nonce`
 * へ飛ばしていたことが見つかった。account には `error` の読み手が無く、しかも拒否時は
 * セッション cookie を消した直後なので middleware が `/login` へ **クエリを落として**
 * 飛ばす。パラメータは誰にも読まれる前に消えていた。
 *
 * ここでは 3 つの鎖 (route が出すコード → 対応表 → messages の文言) が全部つながって
 * いることを見る。1 本でも切れたら落ちる。
 */
import { describe, expect, it } from "vitest";

import enMessages from "@/messages/en.json";
import jaMessages from "@/messages/ja.json";
import {
  ERROR_KEY_MAP,
  FALLBACK_ERROR_MESSAGE_KEY,
  resolveAuthErrorMessageKey,
} from "@/app/[locale]/login/auth-error-keys";

const LOCALES = {
  ja: jaMessages.login as Record<string, string>,
  en: enMessages.login as Record<string, string>,
};

/**
 * 認証 route が実際に付ける `?error=` の値。
 *
 * ハードコードしてあるのは意図的で、route 側を書き換えて対応表に無いコードを
 * 出し始めたときに、このリストとの差でレビューの目に留まるようにするため。
 */
const CODES_EMITTED_BY_ROUTES = [
  // /api/auth/callback (Shopify)
  "InvalidIdToken",
  "VerificationUnavailable",
  // /api/line-callback (LINE Login)
  "LineAuthFailed",
  "StateMismatch",
  "TokenFailed",
  "ProfileFailed",
  "NotConfigured",
  "MissingParams",
  "Unexpected",
] as const;

describe("認証エラーコードは必ず文言まで解決できる", () => {
  it.each(CODES_EMITTED_BY_ROUTES)("%s が対応表にある", (code) => {
    expect(ERROR_KEY_MAP[code]).toBeDefined();
  });

  /* `Unexpected` だけは除く。これは route 側が意図して「予期しないエラー」を
   * 名乗っているコードで、汎用文言に解決されるのが正しい。 */
  const CODES_WITH_SPECIFIC_COPY = CODES_EMITTED_BY_ROUTES.filter((c) => c !== "Unexpected");

  it.each(CODES_WITH_SPECIFIC_COPY)("%s は汎用エラーに落ちない", (code) => {
    /* 対応表に無いコードは `errorUnexpected` に倒れる。倒れること自体は正しい
     * 挙動だが、route が出すと分かっているコードがそこに落ちているなら
     * それは登録漏れであって、設計どおりのフォールバックではない。 */
    expect(resolveAuthErrorMessageKey(code)).not.toBe(FALLBACK_ERROR_MESSAGE_KEY);
  });

  it.each(Object.entries(LOCALES))("%s に全キーの文言がある", (_locale, messages) => {
    for (const messageKey of Object.values(ERROR_KEY_MAP)) {
      expect(messages[messageKey], `missing translation: login.${messageKey}`).toBeTruthy();
    }
  });

  it("フォールバックキー自体も文言を持つ", () => {
    for (const messages of Object.values(LOCALES)) {
      expect(messages[FALLBACK_ERROR_MESSAGE_KEY]).toBeTruthy();
    }
  });

  it("未知のコードは汎用エラーに倒す (例外を投げない)", () => {
    expect(resolveAuthErrorMessageKey("SomethingNobodyDefined")).toBe(
      FALLBACK_ERROR_MESSAGE_KEY,
    );
  });

  it("id_token 拒否の文言は原因の内訳を明かさない", () => {
    /* 署名・nonce・iss・aud・exp のどれで落ちたかを文言に出すと、外から検証器を
     * 探る手がかりになる。ユーザー向けには 1 つの文言に畳んである。 */
    const forbidden = ["nonce", "signature", "署名", "jwks", "aud", "iss", "exp"];
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const copy = messages[ERROR_KEY_MAP.InvalidIdToken].toLowerCase();
      for (const term of forbidden) {
        expect(copy, `${locale} copy leaks "${term}"`).not.toContain(term);
      }
    }
  });
});

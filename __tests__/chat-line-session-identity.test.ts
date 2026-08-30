/**
 * チャットが「LINE ログインで入っている人」をログイン済みとして扱うことの検査。
 *
 * ## 直している症状（2026-08-30 の本番）
 *
 * LINE ログインでサイトに入っている本人が、サイトのチャットで好みを話した。しかし
 *
 *   1. チャットの下に「ログインすると、LINE でもこの会話を続けられます」が出た
 *      （＝画面はこの人を未ログインだと思っていた）
 *   2. 2 分後に LINE 公式で「私のお茶の好みを教えて」と聞くと、
 *      「まだ記録されていない」と返った（＝サイトの発言が本人に紐付いていない）
 *
 * 原因はどちらも同じで、**チャットの経路だけが Shopify セッションしか見ていなかった**。
 *
 *   - `buildProxyAuth()` は `getCustomerFromSession()`（Shopify cookie）のみ。
 *     LINE ログインの人は必ず `verifiedCustomerId = null` になり、cx-agent へ
 *     identity が 1 つも渡らず匿名 web セッションとして保存される。
 *   - `ChatProvider` の `isAuthenticated` は `lineUserId`（**常に null を返す**
 *     関数の戻り）を見ていたので、LINE で入っている人が未ログイン扱いになる。
 *
 * マイページ・お気に入り・行動ログは既に `resolveIdentity()` を使っており、
 * そこでは LINE セッションを連携台帳経由で顧客の棚に解決している。ここで固定するのは
 * **チャットも同じ解決を使う**という契約。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- module mocks（被テスト module の import より前に置く） -----------------

const getCustomerFromSessionMock = vi.fn();
vi.mock("@/lib/shopify/auth", () => ({
  getCustomerFromSession: () => getCustomerFromSessionMock(),
}));

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  resolveIdentity: () => resolveIdentityMock(),
}));

vi.mock("@/lib/config", () => ({
  env: (name: string) =>
    name === "SYNC_API_SECRET"
      ? "test-shared-secret"
      : name === "NEXT_PUBLIC_CHAT_API_URL"
        ? "https://cx-agent.example.test/api/chat"
        : undefined,
  isProduction: () => false,
}));

import { buildProxyAuth } from "@/lib/chat/proxy";

/** サーバ確定値としての LINE userId（暗号化 cookie の復号結果に相当）。 */
const LINE_USER_ID = "U" + "a".repeat(32);
const CUSTOMER_NUMERIC = "5898634526878";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("チャットの identity 解決（buildProxyAuth）", () => {
  it("LINE ログインだけで入っている人でも、LINE userId が信頼済み identity として出る", async () => {
    // Shopify セッションは無い（LINE ログインの人はこうなる）。
    getCustomerFromSessionMock.mockResolvedValue({ ok: true, data: null });
    resolveIdentityMock.mockResolvedValue({
      authenticated: true,
      userKey: `line:${LINE_USER_ID}`,
      provider: "line",
      displayName: "LINE User",
      shopifyCustomerId: null,
      lineUserId: LINE_USER_ID,
    });

    const auth = await buildProxyAuth();

    expect(auth.trusted, "共有鍵があるのに信頼経路になっていない").toBe(true);
    expect(
      auth.verifiedLineUserId,
      "LINE ログインの人の identity が 1 つも取れていない（＝匿名会話に落ちる）",
    ).toBe(LINE_USER_ID);
  });

  it("LINE で入っていて連携済みの人は、顧客 ID を cx-agent が受け取れる形（GID）で返す", async () => {
    getCustomerFromSessionMock.mockResolvedValue({ ok: true, data: null });
    // 連携台帳の逆引きが済んでいる人。`resolveIdentity` は数値の顧客 ID を返す。
    resolveIdentityMock.mockResolvedValue({
      authenticated: true,
      userKey: CUSTOMER_NUMERIC,
      provider: "shopify",
      displayName: "LINE User",
      shopifyCustomerId: CUSTOMER_NUMERIC,
      lineUserId: LINE_USER_ID,
    });

    const auth = await buildProxyAuth();

    /* 形が違うだけで cx-agent の validateShopifyCustomerId が 400 を返し、
       ログイン済みの人が黙って匿名に落ちる。そこを固定する。 */
    expect(auth.verifiedCustomerId, "顧客 ID が GID 形に正規化されていない").toBe(
      `gid://shopify/Customer/${CUSTOMER_NUMERIC}`,
    );
    expect(auth.verifiedLineUserId).toBe(LINE_USER_ID);
  });

  it("Shopify セッションで入っている人の挙動は変えない（GID をそのまま返す）", async () => {
    getCustomerFromSessionMock.mockResolvedValue({
      ok: true,
      data: { id: `gid://shopify/Customer/${CUSTOMER_NUMERIC}` },
    });

    const auth = await buildProxyAuth();

    expect(auth.verifiedCustomerId).toBe(`gid://shopify/Customer/${CUSTOMER_NUMERIC}`);
    expect(auth.verifiedLineUserId).toBeNull();
    expect(
      resolveIdentityMock,
      "Shopify セッションで確定しているのに追加の本人解決を走らせている",
    ).not.toHaveBeenCalled();
  });

  it("誰でもない人は identity を 1 つも返さない（匿名のまま・fail-closed）", async () => {
    getCustomerFromSessionMock.mockResolvedValue({ ok: true, data: null });
    resolveIdentityMock.mockResolvedValue({
      authenticated: false,
      error: "Not authenticated",
      status: 401,
    });

    const auth = await buildProxyAuth();

    expect(auth.verifiedCustomerId).toBeNull();
    expect(auth.verifiedLineUserId).toBeNull();
  });

  it("セッションが判定できなかったとき（503）も、勝手に誰かにしない", async () => {
    getCustomerFromSessionMock.mockResolvedValue({ ok: false, reason: "upstream-unavailable" });
    resolveIdentityMock.mockResolvedValue({
      authenticated: false,
      error: "Authentication failed",
      status: 401,
    });

    const auth = await buildProxyAuth();

    expect(auth.verifiedCustomerId).toBeNull();
    expect(auth.verifiedLineUserId).toBeNull();
  });
});

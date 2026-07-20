/**
 * Tests for POST /api/user/line-link-liff（案A: LINE×Shopify 連携のサーバプロキシ）.
 *
 * この route が Phase 1 SEC-1 の要（Shopify-login-gated / email 等値では連携させない）を
 * web 境界で守っていることを、実ネットワーク・実 Supabase なしで検証する。
 *
 * 契約（route.ts のコメントに対応）:
 *   1. Shopify 未ログイン（requireAuth.authenticated=false）→ 401 needsShopifyLogin。
 *      かつ cx-agent へは一切 fetch しない（未認証で連携を成立させない）。
 *   2. Shopify ログイン済み → cx-agent link-liff を X-API-Key 付きで 1 回呼ぶ。
 *      連携キーの shopify_customer_id は **サーバ確定の auth.customerId**。
 *   3. email-only では連携できない: body が攻撃者由来の shopify_customer_id / shopify_email を
 *      積んでも無視され、outbound は常にサーバ確定 customerId。未認証なら body に email/id が
 *      あっても 401（email 等値経路は存在しない）。
 *
 * verifyLiffIdToken / requireAuth / rate limit / cx-agent base URL は mock。fetch はスタブして
 * outbound を観測する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- module mocks（route が import するもの） -------------------------------
const requireAuthMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: () => requireAuthMock(),
}));

const verifyLiffIdTokenMock = vi.fn();
vi.mock("@/lib/line/verify-liff-token", () => ({
  verifyLiffIdToken: (...args: unknown[]) => verifyLiffIdTokenMock(...args),
}));

vi.mock("@/lib/ratelimit", () => ({
  // 常に「制限なし」（null）を返す。limiters は参照されるだけ。
  enforceRateLimit: vi.fn(async () => null),
  limiters: { authedUser: {} },
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

import { POST } from "@/app/api/user/line-link-liff/route";

const VALID_SUB = "U0123456789abcdef0123456789abcdef";
const VALID_ID_TOKEN = "a".repeat(40);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/line-link-liff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SYNC_API_SECRET = "test-sync-secret";
  process.env.LINE_LIFF_CHANNEL_ID = "2000000001";
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ has_purchase_activity: true }),
    text: async () => "{}",
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/user/line-link-liff", () => {
  it("Shopify 未ログイン → 401 needsShopifyLogin・cx-agent を呼ばない（login-gated）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: false });

    const res = await POST(makeRequest({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { needsShopifyLogin?: boolean };
    expect(json.needsShopifyLogin).toBe(true);
    // 未認証では絶対に連携 upsert を呼ばせない
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Shopify ログイン済み → cx-agent へ server 確定 customerId で 1 回 upsert（X-API-Key 付き）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: "555" });
    verifyLiffIdTokenMock.mockResolvedValue({
      ok: true,
      messagingUserId: VALID_SUB,
      email: "buyer@example.test",
    });

    const res = await POST(makeRequest({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success?: boolean; hasPurchaseActivity?: boolean };
    expect(json.success).toBe(true);
    expect(json.hasPurchaseActivity).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cx-agent.example.test/api/identity/link-liff");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-sync-secret");
    const sent = JSON.parse(init.body as string) as {
      line_messaging_user_id: string;
      shopify_customer_id: string;
    };
    // なりすまし不能性: 連携キーはサーバ確定 customerId（555）と id_token の sub。
    expect(sent.shopify_customer_id).toBe("555");
    expect(sent.line_messaging_user_id).toBe(VALID_SUB);
  });

  it("email-only では連携できない: body の攻撃者 shopify_customer_id / email は無視される", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: "555" });
    verifyLiffIdTokenMock.mockResolvedValue({
      ok: true,
      messagingUserId: VALID_SUB,
      email: "buyer@example.test",
    });

    // 攻撃者が別人の customer_id / email を body に積む
    const res = await POST(
      makeRequest({
        idToken: VALID_ID_TOKEN,
        shopify_customer_id: "999999", // victim id（無視されるべき）
        shopify_email: "victim@example.test", // 等値連携は存在しない
      }),
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { shopify_customer_id: string };
    // body の victim id ではなく、サーバ確定の 555 で連携される
    expect(sent.shopify_customer_id).toBe("555");
    expect(sent.shopify_customer_id).not.toBe("999999");
  });

  it("email-only では連携できない: 未ログインなら body に email/id があっても 401", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: false });

    const res = await POST(
      makeRequest({
        idToken: VALID_ID_TOKEN,
        shopify_customer_id: "999999",
        shopify_email: "victim@example.test",
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("id_token 検証失敗 → 401 line_verification_failed・cx-agent を呼ばない", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: "555" });
    verifyLiffIdTokenMock.mockResolvedValue({ ok: false, reason: "aud_mismatch" });

    const res = await POST(makeRequest({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("line_verification_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

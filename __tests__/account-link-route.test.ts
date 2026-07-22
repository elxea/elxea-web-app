/**
 * Tests for GET /{locale}/link（LINE 純正 Account Link の web 入口）と returnTo のサニタイズ。
 *
 * この route が守るべき契約:
 *   1. 未ログイン（requireAuth.authenticated=false）→ cx-agent を **一切呼ばない**。
 *      linkToken は httpOnly クッキーへ退避し、戻り先 URL には載せない（履歴・リファラに残さない）。
 *   2. ログイン済み → cx-agent の nonce 発行を X-API-Key 付きで 1 回だけ呼ぶ。
 *      送る shopify_customer_id は **サーバ確定の auth.customerId**（ブラウザ自己申告は使わない）。
 *   3. linkToken が無い / 形式不正 → cx-agent を呼ばずに静かに戻す。
 *   4. 応答は常に Referrer-Policy: no-referrer（linkToken をリファラで漏らさない）。
 *   5. cx-agent の redirect_url が access.line.me でなければ従わない（オープンリダイレクト防止）。
 *   6. SYNC_API_SECRET 未設定は fail-closed（連携を進めない）。
 *
 * requireAuth / rate limit / cx-agent base URL は mock。fetch はスタブして outbound を観測する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const requireAuthMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: () => requireAuthMock(),
}));

vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  limiters: { authedUser: {} },
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

import { GET } from "@/app/[locale]/link/route";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import {
  ACCOUNT_LINK_TOKEN_COOKIE,
  isValidLinkTokenFormat,
} from "@/lib/line/account-link";

const VALID_LINK_TOKEN = "a".repeat(32);
const CUSTOMER_ID = "900800400001";
const DIALOG_URL = `https://access.line.me/dialog/bot/accountLink?linkToken=${VALID_LINK_TOKEN}&nonce=abcdefghij`;

function makeRequest(url: string, cookies?: Record<string, string>): NextRequest {
  const req = new NextRequest(url, { method: "GET" });
  for (const [k, v] of Object.entries(cookies ?? {})) {
    req.cookies.set(k, v);
  }
  return req;
}

const params = Promise.resolve({ locale: "ja" });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SYNC_API_SECRET = "test-sync-secret";
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, nonce: "abcdefghij", redirect_url: DIALOG_URL }),
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("sanitizeReturnTo（open redirect の防止）", () => {
  it("自サイト内の相対パスだけ通す", () => {
    expect(sanitizeReturnTo("/ja/link")).toBe("/ja/link");
    expect(sanitizeReturnTo("/ja/account?x=1")).toBe("/ja/account?x=1");
  });

  it("外部 URL・プロトコル相対・バックスラッシュは拒否する", () => {
    expect(sanitizeReturnTo("https://evil.example/x")).toBeNull();
    expect(sanitizeReturnTo("//evil.example/x")).toBeNull();
    expect(sanitizeReturnTo("/\\evil.example")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("空・非文字列・過大長・制御文字は拒否する", () => {
    expect(sanitizeReturnTo("")).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo("/" + "a".repeat(600))).toBeNull();
    expect(sanitizeReturnTo("/ja/link\nSet-Cookie: x=1")).toBeNull();
  });
});

describe("isValidLinkTokenFormat", () => {
  it("実測 32 文字は通し、空・記号・過大長は弾く", () => {
    expect(isValidLinkTokenFormat(VALID_LINK_TOKEN)).toBe(true);
    expect(isValidLinkTokenFormat("")).toBe(false);
    expect(isValidLinkTokenFormat("has space")).toBe(false);
    expect(isValidLinkTokenFormat("a".repeat(513))).toBe(false);
  });
});

describe("GET /{locale}/link -- 未ログイン", () => {
  it("cx-agent を呼ばず、ログインへ送る（linkToken は URL に載せない）", async () => {
    requireAuthMock.mockResolvedValue({
      authenticated: false,
      error: "Not authenticated",
      status: 401,
    });

    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/api/auth/login");
    expect(location).toContain("returnTo=%2Fja%2Flink");
    // 戻り先 URL に linkToken を持ち回らせない。
    expect(location).not.toContain(VALID_LINK_TOKEN);

    // 退避は httpOnly クッキー。
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ACCOUNT_LINK_TOKEN_COOKIE}=${VALID_LINK_TOKEN}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("ログイン往復から戻ったらクッキーの linkToken で続行できる", async () => {
    requireAuthMock.mockResolvedValue({
      authenticated: true,
      customerId: CUSTOMER_ID,
      customerName: "Customer",
    });

    const res = await GET(
      makeRequest("http://localhost/ja/link", {
        [ACCOUNT_LINK_TOKEN_COOKIE]: VALID_LINK_TOKEN,
      }),
      { params },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe(DIALOG_URL);
  });
});

describe("GET /{locale}/link -- ログイン済み", () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue({
      authenticated: true,
      customerId: CUSTOMER_ID,
      customerName: "Customer",
    });
  });

  it("cx-agent へサーバ確定 customerId と linkToken を X-API-Key 付きで 1 回だけ送る", async () => {
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cx-agent.example.test/api/identity/account-link-nonce");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-sync-secret");

    const body = JSON.parse(String(init.body));
    expect(body.shopify_customer_id).toBe(CUSTOMER_ID);
    expect(body.link_token).toBe(VALID_LINK_TOKEN);

    expect(res.headers.get("location")).toBe(DIALOG_URL);
    // 退避クッキーは役目を終えたら落とす。
    expect(res.headers.get("set-cookie") ?? "").toContain(`${ACCOUNT_LINK_TOKEN_COOKIE}=;`);
  });

  it("ブラウザが customer_id を詐称しても outbound はサーバ確定 ID のまま", async () => {
    await GET(
      makeRequest(
        `http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}&shopify_customer_id=999999`,
      ),
      { params },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.shopify_customer_id).toBe(CUSTOMER_ID);
    expect(String(init.body)).not.toContain("999999");
  });

  it("応答に Referrer-Policy: no-referrer と no-store を付ける", async () => {
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("linkToken 欠落 → cx-agent を呼ばず account へ戻す", async () => {
    const res = await GET(makeRequest("http://localhost/ja/link"), { params });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/ja/account?error=account_link_invalid");
  });

  it("linkToken 形式不正 → cx-agent を呼ばない", async () => {
    const res = await GET(
      makeRequest("http://localhost/ja/link?linkToken=bad%20token"),
      { params },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("error=account_link_invalid");
  });

  it("SYNC_API_SECRET 未設定 → fail-closed（cx-agent を呼ばない）", async () => {
    delete process.env.SYNC_API_SECRET;
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("error=account_link_unavailable");
  });

  it("cx-agent が 5xx → 連携ダイアログへ送らない", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "err",
    });
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );
    expect(res.headers.get("location")).toContain("error=account_link_unavailable");
  });

  it("redirect_url が access.line.me 以外 → 従わない（オープンリダイレクト防止）", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ redirect_url: "https://evil.example/steal" }),
      text: async () => "",
    });
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );
    expect(res.headers.get("location")).not.toContain("evil.example");
    expect(res.headers.get("location")).toContain("error=account_link_unavailable");
  });

  it("cx-agent 到達不能 → 静かに戻す（例外を投げない）", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await GET(
      makeRequest(`http://localhost/ja/link?linkToken=${VALID_LINK_TOKEN}`),
      { params },
    );
    expect(res.headers.get("location")).toContain("error=account_link_unavailable");
  });
});

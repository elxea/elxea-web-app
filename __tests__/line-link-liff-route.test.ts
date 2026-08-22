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
 * verifyLineIdToken / requireAuth / rate limit / cx-agent base URL は mock。fetch はスタブして
 * outbound を観測する。
 *
 * ---
 *
 * P2（Web マイページ発の連携を同一ブラウザで完結させる）のテストも **同じファイルに置く**。
 * 二つの入口（LINE 発 = LIFF / Web 発 = 認可リダイレクト）は同じ cx-agent link-liff に
 * 収束し、守るべき不変条件（連携キーの顧客側は必ずサーバ確定 customerId・未認証では
 * 一切 upsert しない）も同一だから、片方だけ緩む変更が起きたときに同じ画面で見えたほうがよい。
 * mock 一式も共通で足りる。
 *
 * P2 で追加した契約:
 *   4. 連携用の認可は **LINE_LIFF_CHANNEL_ID**（LIFF と同じ Login チャネル＝本番 OA と
 *      同一プロバイダー）で組む。AUTH_LINE_ID（Web ログイン用・別プロバイダー）は使わない。
 *   5. state に「連携意図 + 復帰先 + 開始時の顧客」を封じ、callback で顧客一致まで見る
 *      （login-CSRF: 攻撃者の LINE を被害者のアカウントへ連携させる経路を塞ぐ）。
 *   6. 既連携なら認可へ行かせない（連携完了画面の再表示をしない）。
 *   7. 復帰先は自サイト内の相対パスのみ（オープンリダイレクタを作らない）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- module mocks（route が import するもの） -------------------------------
const requireAuthMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: () => requireAuthMock(),
}));

const verifyLineIdTokenMock = vi.fn();
vi.mock("@/lib/line/verify-liff-token", () => ({
  verifyLineIdToken: (...args: unknown[]) => verifyLineIdTokenMock(...args),
}));

vi.mock("@/lib/ratelimit", () => ({
  // 常に「制限なし」（null）を返す。limiters は参照されるだけ。
  enforceRateLimit: vi.fn(async () => null),
  limiters: { authedUser: {} },
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

/* --- P2 の route が追加で触るもの ------------------------------------------- */

const cookieJar = new Map<string, string>();
const cookieStore = {
  get: (name: string) =>
    cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
  set: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  delete: (arg: string | { name: string }) => {
    cookieJar.delete(typeof arg === "string" ? arg : arg.name);
  },
  has: (name: string) => cookieJar.has(name),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const linkageStatusMock = vi.fn();
vi.mock("@/lib/line/linkage-status", () => ({
  fetchLineLinkageStatus: (...args: unknown[]) => linkageStatusMock(...args),
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
    verifyLineIdTokenMock.mockResolvedValue({
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
    verifyLineIdTokenMock.mockResolvedValue({
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
    verifyLineIdTokenMock.mockResolvedValue({ ok: false, reason: "aud_mismatch" });

    const res = await POST(makeRequest({ idToken: VALID_ID_TOKEN }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("line_verification_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * P2 — Web マイページ発の連携（同一ブラウザで完結し、マイページへ自動復帰する）
 * ========================================================================= */

import {
  LINE_LINK_STATE_COOKIE,
  LINK_RESULT_PARAM,
  openLinkState,
  returnUrlWithResult,
  sanitizeReturnTo,
  sealLinkState,
  STATE_TTL_MS,
} from "@/lib/line/link-flow";

const OWNER = "555";
const ATTACKER = "999999";

/** LINE の token 応答 → cx-agent 応答、の順に返す fetch スタブ。 */
function stubLineThenCxAgent(options: { idToken?: string; cxOk?: boolean } = {}) {
  const { idToken = "id.token.value", cxOk = true } = options;
  let call = 0;
  const mock = vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id_token: idToken }),
        text: async () => "{}",
      };
    }
    return {
      ok: cxOk,
      status: cxOk ? 200 : 500,
      json: async () => ({}),
      text: async () => "",
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function initRequest(url = "https://www.elxea.com/api/user/line-link/init") {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "www.elxea.com" },
  });
}

function callbackRequest(params: Record<string, string>) {
  const url = new URL("https://www.elxea.com/api/user/line-link/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { host: "www.elxea.com" } });
}

beforeEach(() => {
  cookieJar.clear();
  process.env.LINE_LIFF_CHANNEL_SECRET = "test-channel-secret";
  /* フォールバック先は既定で未設定にしておく（他テストからの漏れを断つ）。
   * フォールバックを検証するケースだけが明示的に設定する。 */
  delete process.env.LINE_LOGIN_CHANNEL_SECRET;
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  process.env.AUTH_LINE_ID = "login-channel-DO-NOT-USE-FOR-LINKING";
  linkageStatusMock.mockResolvedValue({ linked: false, linkedAt: null });
});

describe("P2 state 束縛（lib/line/link-flow）", () => {
  it("封じた state は、同じ顧客・同じ nonce でだけ開く", () => {
    const { state, cookieValue } = sealLinkState({
      customerId: OWNER,
      returnTo: "/ja/account",
    });

    const opened = openLinkState(cookieValue, state, OWNER);
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.returnTo).toBe("/ja/account");
  });

  it("login-CSRF: 別顧客のセッションで戻ってきた state は開かない", () => {
    // 攻撃者が自分のブラウザで始めた（= 攻撃者の顧客 ID が封じられた）state を、
    // 被害者のセッションに持ち込んでも通らない。
    const { state, cookieValue } = sealLinkState({
      customerId: ATTACKER,
      returnTo: "/ja/account",
    });

    const opened = openLinkState(cookieValue, state, OWNER);
    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toBe("customer_mismatch");
  });

  it("nonce が違えば開かない（cookie を知らない第三者は state を作れない）", () => {
    const { cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    const opened = openLinkState(cookieValue, "a".repeat(64), OWNER);
    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toBe("state_mismatch");
  });

  it("cookie が無ければ開かない（fail-closed）", () => {
    const opened = openLinkState(undefined, "whatever", OWNER);
    expect(opened.ok).toBe(false);
  });

  it("改竄・別鍵の cookie は開かない", () => {
    const opened = openLinkState("not.a.ciphertext", "whatever", OWNER);
    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toBe("state_undecryptable");
  });

  it("TTL 超過は開かない", () => {
    const issued = 1_000_000_000_000;
    const { state, cookieValue } = sealLinkState(
      { customerId: OWNER, returnTo: "/ja/account" },
      issued,
    );
    const opened = openLinkState(cookieValue, state, OWNER, issued + STATE_TTL_MS + 1);
    expect(opened.ok).toBe(false);
    expect(opened.ok === false && opened.reason).toBe("state_expired");
  });

  it("復帰先は自サイト内の相対パスだけ（オープンリダイレクタを作らない）", () => {
    const fallback = "/ja/account";
    for (const evil of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "evil",
      "",
      "/ok\\x",
    ]) {
      expect(sanitizeReturnTo(evil, fallback)).toBe(fallback);
    }
    expect(sanitizeReturnTo("/ja/account?tab=orders", fallback)).toBe("/ja/account?tab=orders");
  });

  it("結果クエリは既存クエリを壊さずに足される", () => {
    expect(returnUrlWithResult("/ja/account", "success")).toBe(
      `/ja/account?${LINK_RESULT_PARAM}=success`,
    );
    expect(returnUrlWithResult("/ja/account?tab=orders", "error")).toBe(
      `/ja/account?tab=orders&${LINK_RESULT_PARAM}=error`,
    );
  });
});

describe("POST /api/user/line-link/init", () => {
  it("未ログイン → 401・state cookie を発行しない", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: false });
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(401);
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("連携用の認可は LIFF と同じ Login チャネルで組む（AUTH_LINE_ID は使わない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(200);
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.host).toBe("access.line.me");
    // 本番 OA と同一プロバイダーのチャネル。ここが AUTH_LINE_ID になると
    // 取得する userId がトークの相手を指さず、連携が無意味になる。
    expect(url.searchParams.get("client_id")).toBe("2000000001");
    expect(url.searchParams.get("client_id")).not.toBe(process.env.AUTH_LINE_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://www.elxea.com/api/user/line-link/callback",
    );
    // 自動ログイン（= 電話で LINE アプリが開く唯一の経路）を殺す 2 つを送らない。
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.has("disable_auto_login")).toBe(false);
    // state は cookie に封じた側と対になっている。
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(true);
    const opened = openLinkState(
      cookieJar.get(LINE_LINK_STATE_COOKIE),
      url.searchParams.get("state"),
      OWNER,
    );
    expect(opened.ok).toBe(true);
  });

  it("既に連携済み → 認可へ行かせない（連携完了画面を再表示しない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    linkageStatusMock.mockResolvedValue({ linked: true, linkedAt: "2026-08-20T00:00:00Z" });
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { alreadyLinked?: boolean; authUrl?: string };
    expect(json.alreadyLinked).toBe(true);
    expect(json.authUrl).toBeUndefined();
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("連携状態が読めない（null）ときは通す — 読めないことで未連携の人を詰ませない", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    linkageStatusMock.mockResolvedValue({ linked: null, linkedAt: null });
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    const json = (await res.json()) as { authUrl?: string };
    expect(json.authUrl).toBeTruthy();
  });

  it("チャネル secret 未設定 → 503（押せるのに必ず失敗するボタンを出さない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(503);
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("自ホスト以外からは発行しない（preview から本番へ落とさない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(
      new NextRequest("https://evil.example/api/user/line-link/init", {
        method: "POST",
        headers: { host: "evil.example" },
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe("GET /api/user/line-link/callback", () => {
  it("成功 → cx-agent へサーバ確定 customerId で upsert し、マイページへ 302 復帰", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({
      ok: true,
      messagingUserId: VALID_SUB,
      email: null,
    });
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({
      customerId: OWNER,
      returnTo: "/ja/account",
    });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "auth-code", state }));

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    // 「同じブラウザのマイページへ自動で戻る」— 完了画面もトーク誘導も挟まない。
    expect(new URL(location).pathname).toBe("/ja/account");
    expect(new URL(location).searchParams.get(LINK_RESULT_PARAM)).toBe("success");

    // 1 回目 = LINE token 交換 / 2 回目 = cx-agent upsert
    expect(outbound).toHaveBeenCalledTimes(2);
    const [cxUrl, cxInit] = outbound.mock.calls[1] as unknown as [string, RequestInit];
    expect(cxUrl).toBe("https://cx-agent.example.test/api/identity/link-liff");
    expect((cxInit.headers as Record<string, string>)["X-API-Key"]).toBe("test-sync-secret");
    const sent = JSON.parse(cxInit.body as string) as {
      shopify_customer_id: string;
      line_messaging_user_id: string;
    };
    expect(sent.shopify_customer_id).toBe(OWNER);
    expect(sent.line_messaging_user_id).toBe(VALID_SUB);

    // 使い捨て: state cookie は残さない
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("login-CSRF: 別顧客が始めた state では連携しない（cx-agent を呼ばない）", async () => {
    // 被害者のセッションで、攻撃者が始めた state / code を踏まされる状況。
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({
      ok: true,
      messagingUserId: VALID_SUB,
      email: null,
    });
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({
      customerId: ATTACKER,
      returnTo: "/ja/account",
    });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "attacker-code", state }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.get(LINK_RESULT_PARAM)).toBe(
      "error",
    );
    // token 交換すら始めない = 攻撃者の LINE が被害者に結び付く余地がない
    expect(outbound).not.toHaveBeenCalled();
  });

  it("state cookie が無い → 連携しない（cx-agent を呼ばない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    const outbound = stubLineThenCxAgent();

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "c", state: "s" }));

    expect(res.status).toBe(307);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("id_token 検証に失敗したら連携しない（cx-agent を呼ばない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({ ok: false, reason: "aud_mismatch" });
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "c", state }));

    expect(new URL(res.headers.get("location")!).searchParams.get(LINK_RESULT_PARAM)).toBe(
      "error",
    );
    // LINE token 交換の 1 回だけ。cx-agent（2 回目）には到達しない。
    expect(outbound).toHaveBeenCalledTimes(1);
  });

  it("ユーザーが LINE 側でキャンセル → 黙って行き止まりにせず、マイページへ戻す", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ error: "access_denied", state }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ja/account");
    expect(outbound).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * P2 — client_secret の env フォールバック（LINE_LIFF → LINE_LOGIN_CHANNEL_SECRET）
 *
 * LINE_LIFF_CHANNEL_ID と LINE_LOGIN_CHANNEL_ID は同一 Login チャネル (2009473839) を指すため、
 * その Channel Secret は LINE_LOGIN_CHANNEL_SECRET と同値。本番 Vercel は後者だけ設定済みで
 * 前者は未設定なので、フォールバックが無いと init は 503・callback は fail-closed で連携が回らない。
 * ここでは (a) LIFF のみ (b) LOGIN のみ (c) 両方未設定 の 3 状態を固定する。
 * ========================================================================= */
describe("P2 client_secret env フォールバック", () => {
  it("(a) LIFF secret のみ設定 → 連携導線を開く（init 200 authUrl）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    process.env.LINE_LIFF_CHANNEL_SECRET = "liff-secret";
    delete process.env.LINE_LOGIN_CHANNEL_SECRET;
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(200);
    const { authUrl } = (await res.json()) as { authUrl?: string };
    expect(authUrl).toBeTruthy();
  });

  it("(b) LOGIN secret のみ設定（LIFF 未設定）→ フォールバックで連携導線を開く（init 200 authUrl）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    process.env.LINE_LOGIN_CHANNEL_SECRET = "login-secret";
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(200);
    const { authUrl } = (await res.json()) as { authUrl?: string };
    expect(authUrl).toBeTruthy();
  });

  it("(b) callback は LIFF 未設定でも LINE_LOGIN_CHANNEL_SECRET で code→token 交換する", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({ ok: true, messagingUserId: VALID_SUB, email: null });
    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    process.env.LINE_LOGIN_CHANNEL_SECRET = "login-secret";
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "auth-code", state }));

    expect(res.status).toBe(307);
    // 1 回目 = LINE token 交換。client_secret がフォールバック値・client_id は LIFF チャネルであること。
    const [tokenUrl, tokenInit] = outbound.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.line.me/oauth2/v2.1/token");
    const body = new URLSearchParams(String(tokenInit.body));
    expect(body.get("client_secret")).toBe("login-secret");
    expect(body.get("client_id")).toBe(process.env.LINE_LIFF_CHANNEL_ID);
  });

  it("(c) 両方未設定 → init 503（押せるのに必ず失敗するボタンを出さない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    delete process.env.LINE_LOGIN_CHANNEL_SECRET;
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(503);
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("resolveLinkChannelSecret: LIFF を優先し、無ければ LOGIN、両方無ければ undefined", async () => {
    const { resolveLinkChannelSecret } = await import("@/lib/line/link-flow");

    process.env.LINE_LIFF_CHANNEL_SECRET = "liff";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "login";
    expect(resolveLinkChannelSecret()).toBe("liff");

    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    expect(resolveLinkChannelSecret()).toBe("login");

    delete process.env.LINE_LOGIN_CHANNEL_SECRET;
    expect(resolveLinkChannelSecret()).toBeUndefined();
  });
});

/* =========================================================================
 * P2 — env の末尾改行で連携が全滅した本番障害（2026-08-22）の回帰テスト
 *
 * 症状: マイページ →「LINEと連携する」→ LINE の認可は通り、マイページに戻ってきて
 *       「連携を完了できませんでした」。Vercel runtime log は毎回
 *         [line-link/callback] token exchange failed: 400
 *           error=invalid_client error_description=invalid client_secret
 *
 * 原因: 本番の LINE_LOGIN_CHANNEL_SECRET が「正しい 32 文字 + 改行」で保存されていた
 *       (`vercel env add ... < file` のように stdin から入れると末尾の改行まで値になる)。
 *       同じチャネル (2009473839) でもメールログインが読む AUTH_LINE_SECRET は改行なしで
 *       保存されていたため、ログインだけは通り続け、連携の不具合に見えていた。
 *
 * 直し方の方針: 本番の値を掃除するだけでは同じ入れ方でまた再発する。**コードを不感にする**
 *       (`readSecretEnvTrimmed` を通す) ことを、ここで契約として固定する。
 *
 * したがって以下のテストは「trim しているか」ではなく「汚れた env でも LINE に送る値が
 * 正しいか」を見る。実装の内部関数ではなく、外に出ていく HTTP の中身を検査する。
 * ========================================================================= */
describe("P2 env に紛れ込んだ末尾改行（本番障害 2026-08-22 の回帰）", () => {
  /** 本番に実在した形。32 文字の正しい秘密の後ろに改行が 1 文字だけ付いている。 */
  const POLLUTED_SECRET = `${"0".repeat(32)}\n`;
  const CLEAN_SECRET = "0".repeat(32);

  it("callback: 末尾改行つきの LOGIN secret でも、LINE には改行なしの client_secret を送る", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({ ok: true, messagingUserId: VALID_SUB, email: null });
    delete process.env.LINE_LIFF_CHANNEL_SECRET;
    process.env.LINE_LOGIN_CHANNEL_SECRET = POLLUTED_SECRET;
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    const res = await callback(callbackRequest({ code: "auth-code", state }));

    const [tokenUrl, tokenInit] = outbound.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.line.me/oauth2/v2.1/token");
    const body = new URLSearchParams(String(tokenInit.body));
    // これが本番で LINE に弾かれていた値。改行が 1 文字でも残ると invalid_client になる。
    expect(body.get("client_secret")).toBe(CLEAN_SECRET);
    expect(body.get("client_secret")).not.toContain("\n");
    // 交換が通るので、行き先は成功（= マイページに ?line_link=success で戻る）。
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(`${LINK_RESULT_PARAM}=success`);
  });

  it("callback: 末尾改行つきの LIFF_CHANNEL_ID でも、client_id は改行なしで送る", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    verifyLineIdTokenMock.mockResolvedValue({ ok: true, messagingUserId: VALID_SUB, email: null });
    process.env.LINE_LIFF_CHANNEL_ID = "2000000001\n";
    process.env.LINE_LIFF_CHANNEL_SECRET = CLEAN_SECRET;
    const outbound = stubLineThenCxAgent();

    const { state, cookieValue } = sealLinkState({ customerId: OWNER, returnTo: "/ja/account" });
    cookieJar.set(LINE_LINK_STATE_COOKIE, cookieValue);

    const { GET: callback } = await import("@/app/api/user/line-link/callback/route");
    await callback(callbackRequest({ code: "auth-code", state }));

    const [, tokenInit] = outbound.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URLSearchParams(String(tokenInit.body)).get("client_id")).toBe("2000000001");
    /* id_token 検証にも同じ綺麗な値が渡ること。ここは LINE が返す `aud` と等値比較されるので、
     * 改行が残ると「署名は通ったのに aud 不一致」という辿りにくい失敗になる。 */
    expect(verifyLineIdTokenMock.mock.calls[0][1]).toBe("2000000001");
  });

  it("init: 末尾改行つきの CHANNEL_ID でも、認可 URL の client_id は改行なし", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    process.env.LINE_LIFF_CHANNEL_ID = "2000000001\n";
    process.env.LINE_LIFF_CHANNEL_SECRET = POLLUTED_SECRET;
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(200);
    const { authUrl } = (await res.json()) as { authUrl: string };
    expect(new URL(authUrl).searchParams.get("client_id")).toBe("2000000001");
  });

  it("空白だけの secret は「設定済み」と数えない（init 503 / 押せて必ず失敗するボタンを出さない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: OWNER });
    process.env.LINE_LIFF_CHANNEL_SECRET = "   \n";
    process.env.LINE_LOGIN_CHANNEL_SECRET = "\t\r\n";
    const { POST: init } = await import("@/app/api/user/line-link/init/route");

    const res = await init(initRequest());
    expect(res.status).toBe(503);
    expect(cookieJar.has(LINE_LINK_STATE_COOKIE)).toBe(false);
  });

  it("空白だけの LIFF secret は LOGIN secret へフォールバックする（空値で上書きしない）", async () => {
    const { resolveLinkChannelSecret } = await import("@/lib/line/link-flow");

    process.env.LINE_LIFF_CHANNEL_SECRET = "  \n";
    process.env.LINE_LOGIN_CHANNEL_SECRET = POLLUTED_SECRET;
    expect(resolveLinkChannelSecret()).toBe(CLEAN_SECRET);
  });

  it("resolveLinkChannelId: 改行を落とし、空なら undefined", async () => {
    const { resolveLinkChannelId } = await import("@/lib/line/link-flow");

    process.env.LINE_LIFF_CHANNEL_ID = " 2009473839\r\n";
    expect(resolveLinkChannelId()).toBe("2009473839");

    process.env.LINE_LIFF_CHANNEL_ID = "   ";
    expect(resolveLinkChannelId()).toBeUndefined();

    delete process.env.LINE_LIFF_CHANNEL_ID;
    expect(resolveLinkChannelId()).toBeUndefined();
  });
});

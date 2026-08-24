/**
 * M-1 / J-4 — 恒久的な衝突を、一時エラーとして提示しない。
 *
 * ## 何が壊れていたか
 *
 * 「このメールアドレスには既に別の LINE が連携済み」(cx-agent が 409) は、時間を
 * おいても直らない**恒久的な衝突**である。ところが web-app 側は 409 も 500 も
 * 同じ「失敗」に潰しており、画面には
 *
 *   > 連携できませんでした。時間をおいてもう一度お試しください。
 *
 * と出ていた。つまり **永久に成功しない再試行を、成功しうるかのように案内して
 * いた**。お客さまは同じ操作を何度も繰り返し、何度も同じ画面に戻る。
 *
 * J-4 で「世帯共有は認めない（1 LINE = 1 顧客）」と決めた以上、この衝突は
 * 仕様どおりの結果であって障害ではない。仕様どおりの結果は、そう見えなければ
 * ならない。
 *
 * ## このテストが守るもの
 *
 * 409 が **どこで潰されてもいけない**ので、経路の各段で別々に固定する。
 * 1 段でも潰れると画面まで届かない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/* ── LIFF 経路（/api/user/line-link-liff）─────────────────────────── */

const requireAuthMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: () => requireAuthMock(),
}));

const verifyLineIdTokenMock = vi.fn();
vi.mock("@/lib/line/verify-liff-token", () => ({
  verifyLineIdToken: (...args: unknown[]) => verifyLineIdTokenMock(...args),
}));

vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  limiters: { authedUser: {} },
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

/* 合体の入口は M-2 で `applyLinkageEstablished` に替わる。どちらの名前でも
   route が解決できるよう両方生やす（この PR の関心事は 409 の扱いだけ）。 */
const mergeStub = vi.fn<(args: unknown) => Promise<{ outcome: string; merge: null }>>(
  async () => ({ outcome: "merged", merge: null }),
);
vi.mock("@/lib/auth/identity-link", () => ({
  completeLineLinkage: (args: unknown) => mergeStub(args),
  applyLinkageEstablished: (args: unknown) => mergeStub(args),
}));

const SAVED = {
  SYNC_API_SECRET: process.env.SYNC_API_SECRET,
  LINE_LIFF_CHANNEL_ID: process.env.LINE_LIFF_CHANNEL_ID,
  LINE_LIFF_CHANNEL_SECRET: process.env.LINE_LIFF_CHANNEL_SECRET,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SYNC_API_SECRET = "sync-secret";
  process.env.LINE_LIFF_CHANNEL_ID = "2011239425";
  process.env.LINE_LIFF_CHANNEL_SECRET = "liff-secret";
  requireAuthMock.mockResolvedValue({
    authenticated: true,
    customerId: "7654321",
    customerName: "Customer",
  });
  verifyLineIdTokenMock.mockResolvedValue({
    ok: true,
    messagingUserId: "U0123456789abcdef0123456789abcdef",
    email: null,
    payload: {},
  });
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

function liffRequest(): NextRequest {
  return new NextRequest("http://localhost/api/user/line-link-liff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "a".repeat(40) }),
  });
}

describe("LIFF 経路: cx-agent の 409 を潰さない", () => {
  it("409 は 409 のまま返す（502 に丸めない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        text: async () => '{"error":"shopify_customer_already_linked"}',
        json: async () => ({ error: "shopify_customer_already_linked" }),
      })) as unknown as typeof fetch,
    );

    const { POST } = await import("@/app/api/user/line-link-liff/route");
    const res = await POST(liffRequest());

    /* 502 に潰すと、画面は「時間をおいてもう一度」に倒れる。恒久か一時かは
       呼び出し側が知る必要がある。 */
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_linked" });
  });

  it("409 以外の失敗は従来どおり 502（区別を保つ）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "boom",
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );

    const { POST } = await import("@/app/api/user/line-link-liff/route");
    const res = await POST(liffRequest());
    expect(res.status).toBe(502);
  });
});

/* ── 表示層（?line_link=conflict → マイページの文言）───────────────── */

describe("LinkResult は conflict を error と分けて運ぶ", () => {
  it("returnUrlWithResult が conflict を URL に載せられる", async () => {
    const { returnUrlWithResult, LINK_RESULT_PARAM } = await import(
      "@/lib/line/link-flow"
    );
    const url = returnUrlWithResult("/ja/account", "conflict");
    expect(url).toContain(`${LINK_RESULT_PARAM}=conflict`);
  });
});

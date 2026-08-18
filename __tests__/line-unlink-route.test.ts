/**
 * Tests for DELETE /api/user/line-link（LINE 連携の解除）.
 *
 * この route が守るべき契約（route.ts の doc コメントに対応）:
 *   1. 未ログイン（requireAuth.authenticated=false）→ 401。かつ Firestore を
 *      **一切触らない**（未認証で他人の連携を外させない）。
 *   2. ログイン済み → 解除対象は **サーバ確定の auth.customerId** のみ。
 *      body の customerId / lineUserId は読まない・使わない
 *      （他人を指定して外す経路が存在しない）。
 *   3. 冪等: 連携が無ければ 200 + action="not_linked"（二重解除をエラーにしない）。
 *   4. rate limit に当たったら limiter の応答をそのまま返し、解除は実行しない。
 *   5. 解除 → 再連携が同じ route で成立する（DELETE の後に POST が
 *      action="linked" を返せる = 消し残りに引っぱられない）。
 *
 * requireAuth / rate limit / server-actions は mock。Firestore 実体は使わない。
 * `unlinkLineUser` 自体の Firestore セマンティクス（FieldValue.delete で
 * フィールドごと消す＝再連携が新規連携経路を通る）は
 * `__tests__/line-unlink-action.test.ts` で検証する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- module mocks（route が import するもの） -------------------------------
const requireAuthMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: () => requireAuthMock(),
}));

const linkLineUserMock = vi.fn();
const unlinkLineUserMock = vi.fn();
vi.mock("@/lib/firebase/server-actions", () => ({
  linkLineUser: (...args: unknown[]) => linkLineUserMock(...args),
  unlinkLineUser: (...args: unknown[]) => unlinkLineUserMock(...args),
}));

const enforceRateLimitMock = vi.fn();
vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimitMock(...args),
  limiters: { authedUser: {} },
}));

import { DELETE, POST } from "@/app/api/user/line-link/route";

const CUSTOMER_ID = "900800400001";
const OTHER_CUSTOMER_ID = "999999999999";
const VALID_LINE_USER_ID = "U0123456789abcdef0123456789abcdef";

function makeDeleteRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/line-link", {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/line-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 既定は「制限なし」。rate limit のテストだけ上書きする。
  enforceRateLimitMock.mockResolvedValue(null);
  unlinkLineUserMock.mockResolvedValue({ success: true, action: "unlinked" });
  linkLineUserMock.mockResolvedValue({ success: true, action: "linked" });
});

describe("DELETE /api/user/line-link", () => {
  it("未ログイン → 401・Firestore を触らない", async () => {
    requireAuthMock.mockResolvedValue({
      authenticated: false,
      error: "Not authenticated",
      status: 401,
    });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("Not authenticated");
    // 未認証では絶対に解除させない
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("ログイン済み → サーバ確定 customerId で 1 回だけ解除し 200 を返す", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success?: boolean; action?: string };
    expect(json.success).toBe(true);
    expect(json.action).toBe("unlinked");

    expect(unlinkLineUserMock).toHaveBeenCalledTimes(1);
    expect(unlinkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("body で他人の customerId / lineUserId を指定しても無視する（他人の連携は外せない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });

    const res = await DELETE(
      makeDeleteRequest({
        customerId: OTHER_CUSTOMER_ID,
        lineUserId: VALID_LINE_USER_ID,
      }),
    );
    expect(res.status).toBe(200);

    // 引数はサーバ確定 ID のみ。body の victim id は一切渡らない。
    expect(unlinkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(unlinkLineUserMock).not.toHaveBeenCalledWith(OTHER_CUSTOMER_ID);
    expect(unlinkLineUserMock.mock.calls[0]).toHaveLength(1);
  });

  it("連携が無い状態で呼んでも 200 + not_linked（冪等・二重解除でも落ちない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
    unlinkLineUserMock.mockResolvedValue({ success: true, action: "not_linked" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success?: boolean; action?: string };
    expect(json.success).toBe(true);
    expect(json.action).toBe("not_linked");
  });

  it("rate limit に当たったら limiter 応答を返し、解除は実行しない", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
    enforceRateLimitMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
    );

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(429);
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("Firestore 側が失敗しても 500 で閉じる（内部詳細は返さない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
    unlinkLineUserMock.mockRejectedValue(new Error("firestore unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("Internal server error");
    expect(json.error).not.toContain("firestore unavailable");

    errorSpy.mockRestore();
  });

  it("解除 → 再連携が同じ route で成立する（DELETE の後の POST が linked を返す）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });

    const delRes = await DELETE(makeDeleteRequest());
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as { action?: string }).action).toBe("unlinked");

    const postRes = await POST(makePostRequest({ lineUserId: VALID_LINE_USER_ID }));
    expect(postRes.status).toBe(200);
    const postJson = (await postRes.json()) as { action?: string };
    expect(postJson.action).toBe("linked");
    expect(linkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID, VALID_LINE_USER_ID);
  });
});

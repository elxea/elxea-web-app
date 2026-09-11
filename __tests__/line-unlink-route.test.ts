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
 *   6. **連携の正本（cx-agent）を先に外し、成功したときだけ Firestore を消す**。
 *      cx-agent が失敗したら Firestore に触れず非 2xx（502 / 503）。
 *      以前はここが Firestore しか消さずに 200 を返していたため、解除したはずの人に
 *      LINE の配信が届き続けていた（＝成功偽装）。その再発防止をここで固定する。
 *   7. **LINE セッションでも解除できる**（2026-08-22 / A 案）。解除対象は
 *      「検証済み LINE userId が台帳で結び付いている Shopify 顧客」だけで、
 *      推測しない・ブラウザからは受け取らない。台帳が読めなければ 502
 *      （「解除しました」と言って何も外さないのは契約 6 と同じ嘘）。
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

const unlinkLineUserMock = vi.fn();
vi.mock("@/lib/firebase/server-actions", () => ({
  unlinkLineUser: (...args: unknown[]) => unlinkLineUserMock(...args),
}));

const enforceRateLimitMock = vi.fn();
vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimitMock(...args),
  limiters: { authedUser: {} },
}));

const requestCxUnlinkMock = vi.fn();
vi.mock("@/lib/line/unlink", () => ({
  requestCxUnlink: (...args: unknown[]) => requestCxUnlinkMock(...args),
}));

/** LINE セッションの本人（暗号化 cookie の復号結果）。既定は「LINE セッション無し」。 */
const readVerifiedLineUserIdMock = vi.fn();
vi.mock("@/lib/line/session", () => ({
  readVerifiedLineUserId: () => readVerifiedLineUserIdMock(),
}));

/** 逆引き（LINE userId → 連携先の Shopify 顧客）。3 値（string / false / null）。 */
const fetchShopifyCustomerIdForLineUserMock = vi.fn();
const invalidateReverseLinkageMock = vi.fn();
const invalidateReverseLinkageForCustomerMock = vi.fn();
vi.mock("@/lib/line/linkage-status", () => ({
  fetchShopifyCustomerIdForLineUser: (...args: unknown[]) =>
    fetchShopifyCustomerIdForLineUserMock(...args),
  invalidateReverseLinkage: (...args: unknown[]) =>
    invalidateReverseLinkageMock(...args),
  invalidateReverseLinkageForCustomer: (...args: unknown[]) =>
    invalidateReverseLinkageForCustomerMock(...args),
}));

import * as route from "@/app/api/user/line-link/route";

const { DELETE } = route;

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

beforeEach(() => {
  vi.clearAllMocks();
  // 既定は「制限なし」。rate limit のテストだけ上書きする。
  enforceRateLimitMock.mockResolvedValue(null);
  unlinkLineUserMock.mockResolvedValue({ success: true, action: "unlinked" });
  // 既定は「cx-agent 側の解除に成功」。失敗系のテストだけ上書きする。
  requestCxUnlinkMock.mockResolvedValue({ ok: true, clearedCount: 1 });
  // 既定は「LINE セッション無し」。LINE 経路のテストだけ上書きする。
  readVerifiedLineUserIdMock.mockResolvedValue(null);
  fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(false);
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
    expect(unlinkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID, undefined);
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
    expect(unlinkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID, undefined);
    expect(unlinkLineUserMock.mock.calls[0][0]).toBe(CUSTOMER_ID);
    expect(unlinkLineUserMock.mock.calls[0][1]).toBeUndefined();
    expect(requestCxUnlinkMock.mock.calls[0][0]).toBe(CUSTOMER_ID);
  });

  it("連携が無い状態で呼んでも 200 + not_linked（冪等・二重解除でも落ちない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
    requestCxUnlinkMock.mockResolvedValue({ ok: true, clearedCount: 0 });
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

  it("POST は存在しない（ブラウザ申告だけで連携できる入口を残さない・P10）", () => {
    /* かつてここには「ブラウザが送ってきた lineUserId をそのまま顧客に結び付ける」
       POST があった。LINE に何も検証させていないので、任意の LINE を名乗れた。
       ハンドラが export されていない = Next.js は 405 を返す。 */
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------
 * 解除が「本当に効く」ことの契約（契約 6）
 *
 * ここが本 PR の主旨。以前の DELETE は Firestore の写ししか消さず、LINE Bot が
 * 実際に読む cx-agent の連携台帳には触れないまま 200 を返していた。つまり
 * 「解除しました」と言いながら解除できていなかった。
 * ----------------------------------------------------------------------- */
describe("DELETE /api/user/line-link / cx-agent との順序と失敗の扱い", () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
  });

  it("連携の正本（cx-agent）をサーバ確定 customerId で呼ぶ", async () => {
    await DELETE(makeDeleteRequest());
    expect(requestCxUnlinkMock).toHaveBeenCalledTimes(1);
    /* マイページには LINE を選ぶ UI が無く「このアカウントの連携を解除する」だけなので、
       ここでは対象を名指ししない（= その顧客の連携をすべて外す）。 */
    expect(requestCxUnlinkMock).toHaveBeenCalledWith(CUSTOMER_ID, undefined);
  });

  it("解除できたかは台帳（cx の cleared_count）が決める（写しの有無で判定しない・P9）", async () => {
    /* Web / LIFF から連携した人は Firestore の写しを持たない期間がある。写しを見て
       判定すると「台帳からは外れたのに not_linked」という嘘になる。 */
    requestCxUnlinkMock.mockResolvedValue({ ok: true, clearedCount: 1 });
    unlinkLineUserMock.mockResolvedValue({ success: true, action: "not_linked" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { action?: string }).action).toBe("unlinked");
  });

  it("メールセッションからの解除でも逆引きキャッシュを捨てる（P6/E1）", async () => {
    /* 外した LINE userId は分からないが、キャッシュは連携先の顧客 ID を値に
       持っているので、値の側から引いて消せる。cx-agent に生 ID を返させない。 */
    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(invalidateReverseLinkageForCustomerMock).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("cx-agent が失敗したらキャッシュも触らない（外れていないのに未連携に見せない）", async () => {
    requestCxUnlinkMock.mockResolvedValue({ ok: false, reason: "upstream_error" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(502);
    expect(invalidateReverseLinkageForCustomerMock).not.toHaveBeenCalled();
  });

  it("cx-agent を先に呼び、そのあとで Firestore を消す（順序が結果を決める）", async () => {
    const order: string[] = [];
    requestCxUnlinkMock.mockImplementation(async () => {
      order.push("cx");
      return { ok: true, clearedCount: 1 };
    });
    unlinkLineUserMock.mockImplementation(async () => {
      order.push("firestore");
      return { success: true, action: "unlinked" };
    });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(order).toEqual(["cx", "firestore"]);
  });

  it("cx-agent 不達 → 502・Firestore は触らない（成功偽装をしない）", async () => {
    requestCxUnlinkMock.mockResolvedValue({ ok: false, reason: "upstream_error" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(502);
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("このデプロイに連携の設定が無い → 503・Firestore は触らない", async () => {
    requestCxUnlinkMock.mockResolvedValue({ ok: false, reason: "not_configured" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(503);
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("失敗応答に内部の理由コードを載せない（検証の内訳を外に出さない）", async () => {
    requestCxUnlinkMock.mockResolvedValue({ ok: false, reason: "upstream_error" });

    const res = await DELETE(makeDeleteRequest());
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("upstream_error");
    expect(body).not.toContain("not_configured");
  });

  it("cx 側に外す連携が無くても（0 件）解除は成功として通る（冪等）", async () => {
    requestCxUnlinkMock.mockResolvedValue({ ok: true, clearedCount: 0 });
    unlinkLineUserMock.mockResolvedValue({ success: true, action: "not_linked" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { action?: string }).action).toBe("not_linked");
  });
});

/* -------------------------------------------------------------------------
 * LINE セッションからの解除（契約 7 / A 案・2026-08-22）
 *
 * `requireAuth()` は Shopify セッション専用なので、LINE で入っている人はここに来ても
 * 401 だった。マイページ側も解除ボタンを Shopify セッションのときしか出していなかった
 * ため、**LINE で入った人は自分の連携を自分で外せなかった**。
 *
 * 受け付けても信頼境界は動かない。解除対象は「検証済み LINE userId が台帳の上で
 * 結び付いている Shopify 顧客」だけで、ブラウザからは何も受け取らない。
 * ----------------------------------------------------------------------- */
describe("DELETE /api/user/line-link / LINE セッション", () => {
  beforeEach(() => {
    // Shopify セッションは無い（＝従来は 401 になっていた状況）。
    requireAuthMock.mockResolvedValue({
      authenticated: false,
      error: "Not authenticated",
      status: 401,
    });
    readVerifiedLineUserIdMock.mockResolvedValue(VALID_LINE_USER_ID);
  });

  it("連携済み → 台帳で引いた顧客の連携を外して 200（LINE でも解除に到達できる）", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(CUSTOMER_ID);

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { action?: string }).action).toBe("unlinked");

    // 逆引きに渡すのはサーバ確定の LINE userId のみ。
    expect(fetchShopifyCustomerIdForLineUserMock).toHaveBeenCalledWith(
      VALID_LINE_USER_ID,
    );
    /* 外すのは台帳が返した連携先の、**この LINE の連携だけ**（推測しない・
       世帯共有で家族の連携を巻き添えにしない・P8）。 */
    expect(requestCxUnlinkMock).toHaveBeenCalledWith(CUSTOMER_ID, VALID_LINE_USER_ID);
    expect(unlinkLineUserMock).toHaveBeenCalledWith(CUSTOMER_ID, VALID_LINE_USER_ID);
  });

  it("body で他人の customerId / lineUserId を指定しても無視する（本人の連携しか外れない）", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(CUSTOMER_ID);

    const res = await DELETE(
      makeDeleteRequest({
        customerId: OTHER_CUSTOMER_ID,
        lineUserId: "U99999999999999999999999999999999",
      }),
    );
    expect(res.status).toBe(200);

    expect(fetchShopifyCustomerIdForLineUserMock).toHaveBeenCalledWith(
      VALID_LINE_USER_ID,
    );
    expect(requestCxUnlinkMock).toHaveBeenCalledWith(CUSTOMER_ID, VALID_LINE_USER_ID);
    expect(requestCxUnlinkMock.mock.calls[0][0]).toBe(CUSTOMER_ID);
    expect(requestCxUnlinkMock.mock.calls[0][1]).toBe(VALID_LINE_USER_ID);
    expect(unlinkLineUserMock.mock.calls[0][0]).toBe(CUSTOMER_ID);
  });

  it("未連携 → 200 + not_linked・cx も Firestore も触らない（冪等）", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(false);

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success?: boolean; action?: string };
    expect(json.success).toBe(true);
    expect(json.action).toBe("not_linked");

    expect(requestCxUnlinkMock).not.toHaveBeenCalled();
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("台帳が読めない → 502。200 を返して「解除しました」と嘘をつかない", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(502);
    expect(requestCxUnlinkMock).not.toHaveBeenCalled();
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("どちらのセッションも無い → 従来どおり 401・台帳も引かない", async () => {
    readVerifiedLineUserIdMock.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("Not authenticated");

    expect(fetchShopifyCustomerIdForLineUserMock).not.toHaveBeenCalled();
    expect(requestCxUnlinkMock).not.toHaveBeenCalled();
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("rate limit は台帳を引く前に効き、識別子は LINE の名前空間で数値顧客 ID と衝突しない", async () => {
    enforceRateLimitMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
    );

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(429);

    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      `line:${VALID_LINE_USER_ID}`,
    );
    expect(fetchShopifyCustomerIdForLineUserMock).not.toHaveBeenCalled();
    expect(unlinkLineUserMock).not.toHaveBeenCalled();
  });

  it("解除できたら逆引きキャッシュを捨てる（引き直したマイページに「連携済み」が残らない）", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(CUSTOMER_ID);

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(invalidateReverseLinkageMock).toHaveBeenCalledWith(VALID_LINE_USER_ID);
  });

  it("解除に失敗したらキャッシュは捨てない（外れていないのに未連携に見せない）", async () => {
    fetchShopifyCustomerIdForLineUserMock.mockResolvedValue(CUSTOMER_ID);
    requestCxUnlinkMock.mockResolvedValue({ ok: false, reason: "upstream_error" });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(502);
    expect(invalidateReverseLinkageMock).not.toHaveBeenCalled();
  });

  it("Shopify セッションがあるときは LINE 経路に入らない（従来経路を変えない）", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });

    const res = await DELETE(makeDeleteRequest());
    expect(res.status).toBe(200);
    expect(readVerifiedLineUserIdMock).not.toHaveBeenCalled();
    expect(fetchShopifyCustomerIdForLineUserMock).not.toHaveBeenCalled();
    expect(requestCxUnlinkMock).toHaveBeenCalledWith(CUSTOMER_ID, undefined);
  });
});

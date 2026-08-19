/**
 * Tests for GET /api/user/line-link-status（P1: マイページに LINE 連携状態を表示）
 * および読み取りヘルパ fetchLineLinkageStatus。
 *
 * この経路が守るべき契約:
 *   1. 未ログイン → 401。cx-agent を **一切呼ばない**（連携の有無を未認証者に漏らさない）。
 *   2. 送る shopify_customer_id は **サーバ確定の auth.customerId** のみ。
 *      クエリで顧客 ID を渡しても無視する（他人の連携状態を覗く穴を塞ぐ）。
 *   3. 応答に **LINE の生 ID を載せない**（cx-agent が余計な値を返しても web で落とす）。
 *   4. cx-agent 不達・エラー・壊れた応答は `linked: null`（不明）で fail-soft。
 *      **未連携（false）に丸めない**。マイページ描画は落とさない。
 *   5. SYNC_API_SECRET 未設定でも 5xx にせず「不明」を返す（無駄打ちもしない）。
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

import { GET } from "@/app/api/user/line-link-status/route";
import {
  fetchLineLinkageStatus,
  formatLinkedDate,
  isLinkedForDisplay,
  UNKNOWN_LINE_LINKAGE,
} from "@/lib/line/linkage-status";

const CUSTOMER_ID = "900800400001";
const OTHER_CUSTOMER_ID = "111222333444";
const LINKED_AT = "2026-08-19T21:13:00.000Z";
/** 応答に混ざっていないことを確認する番兵。 */
const SENTINEL_LINE_ID = "U0123456789abcdef0123456789abcdef";

const ROUTE_URL = "https://elxea.example.test/api/user/line-link-status";

function makeRequest(url = ROUTE_URL): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubUpstream(body: unknown, ok = true, status = 200) {
  fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SYNC_API_SECRET = "test-sync-secret";
  requireAuthMock.mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID });
  stubUpstream({ linked: true, linkedAt: LINKED_AT, count: 1 });
});

describe("GET /api/user/line-link-status / 認証", () => {
  it("未ログイン → 401 で、cx-agent を呼ばない", async () => {
    requireAuthMock.mockResolvedValue({ authenticated: false, error: "Not authenticated" });

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ログイン済み → 200 で連携状態を返す", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ linked: true, linkedAt: LINKED_AT });
  });
});

describe("GET /api/user/line-link-status / 顧客 ID の出どころ", () => {
  it("問い合わせる顧客 ID はサーバセッション由来", async () => {
    await GET(makeRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`shopify_customer_id=${CUSTOMER_ID}`);
  });

  it("クエリで他人の顧客 ID を渡しても無視する（覗き見の遮断）", async () => {
    await GET(makeRequest(`${ROUTE_URL}?shopify_customer_id=${OTHER_CUSTOMER_ID}`));

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`shopify_customer_id=${CUSTOMER_ID}`);
    expect(url).not.toContain(OTHER_CUSTOMER_ID);
  });

  it("秘密はサーバ側のヘッダーで送る（ブラウザに出さない）", async () => {
    await GET(makeRequest());

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["X-API-Key"]).toBe("test-sync-secret");
  });
});

describe("GET /api/user/line-link-status / 最小開示", () => {
  it("cx-agent が LINE の生 ID を返しても応答に載せない", async () => {
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      count: 1,
      line_user_id: SENTINEL_LINE_ID,
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(SENTINEL_LINE_ID);
    expect(Object.keys(body).sort()).toEqual(["linked", "linkedAt"]);
  });
});

describe("GET /api/user/line-link-status / fail-soft", () => {
  it("cx-agent 不達 → linked:null（不明）で 200。ページを壊さない", async () => {
    fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ linked: null, linkedAt: null });
  });

  it("cx-agent が 500 → linked:null（未連携 false に丸めない）", async () => {
    stubUpstream({ error: "boom" }, false, 500);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.linked).toBeNull();
    expect(body.linked).not.toBe(false);
  });

  it("SYNC_API_SECRET 未設定 → 不明を返し、cx-agent を呼ばない", async () => {
    delete process.env.SYNC_API_SECRET;

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ linked: null, linkedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchLineLinkageStatus", () => {
  it("未連携をそのまま返す（不明に化けさせない）", async () => {
    stubUpstream({ linked: false, linkedAt: null, count: 0 });

    await expect(fetchLineLinkageStatus(CUSTOMER_ID)).resolves.toEqual({
      linked: false,
      linkedAt: null,
    });
  });

  it("GID を渡してもそのまま問い合わせる（cx-agent 側で正規化）", async () => {
    await fetchLineLinkageStatus(`gid://shopify/Customer/${CUSTOMER_ID}`);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(encodeURIComponent(`gid://shopify/Customer/${CUSTOMER_ID}`));
  });

  it("顧客 ID が空 → 問い合わせずに不明", async () => {
    await expect(fetchLineLinkageStatus("")).resolves.toEqual(UNKNOWN_LINE_LINKAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("linked が boolean でない壊れた応答 → 不明", async () => {
    stubUpstream({ linked: "yes", linkedAt: LINKED_AT });

    await expect(fetchLineLinkageStatus(CUSTOMER_ID)).resolves.toEqual(
      UNKNOWN_LINE_LINKAGE,
    );
  });

  it("linkedAt が文字列でない → linked は保ちつつ日付だけ落とす", async () => {
    stubUpstream({ linked: true, linkedAt: 12345 });

    await expect(fetchLineLinkageStatus(CUSTOMER_ID)).resolves.toEqual({
      linked: true,
      linkedAt: null,
    });
  });

  it("連携状態はキャッシュしない（連携直後に古い未連携を見せない）", async () => {
    await fetchLineLinkageStatus(CUSTOMER_ID);

    const init = fetchMock.mock.calls[0][1] as { cache?: string };
    expect(init.cache).toBe("no-store");
  });
});

describe("isLinkedForDisplay（マイページの出し分け）", () => {
  it("連携済みのときだけ「連携済み」表示にする", () => {
    expect(isLinkedForDisplay({ linked: true, linkedAt: LINKED_AT })).toBe(true);
  });

  it("未連携 → 連携ボタン側（false）", () => {
    expect(isLinkedForDisplay({ linked: false, linkedAt: null })).toBe(false);
  });

  it("不明 → 連携ボタン側。連携済みと言い切らない", () => {
    expect(isLinkedForDisplay(UNKNOWN_LINE_LINKAGE)).toBe(false);
  });

  it("status 未指定 → 連携ボタン側", () => {
    expect(isLinkedForDisplay(undefined)).toBe(false);
  });
});

describe("formatLinkedDate（連携日の表示）", () => {
  it("日本時間で日付にする", () => {
    expect(formatLinkedDate("2026-08-19T21:13:00.000Z", "ja")).toBe("2026/08/20");
  });

  it("UTC の日付が変わる前でも JST の日付で出す（1 日ずれない）", () => {
    // 2026-08-19T23:30Z = 2026-08-20 08:30 JST。UTC 基準だと 8/19 に見えてしまう。
    expect(formatLinkedDate("2026-08-19T23:30:00.000Z", "ja")).toBe("2026/08/20");
  });

  it("null → 日付を言わない", () => {
    expect(formatLinkedDate(null, "ja")).toBeNull();
  });

  it("壊れた文字列 → 日付を言わない（Invalid Date を画面に出さない）", () => {
    expect(formatLinkedDate("not-a-date", "ja")).toBeNull();
  });
});

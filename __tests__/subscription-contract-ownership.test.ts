/**
 * 所有者照合そのもの (lib/shopify/customer.ts) の単体テスト。
 *
 * `verifySubscriptionContractOwnership` は Admin API 経路の Server Action が
 * 「呼び出し元がこの契約の持ち主か」を判断する唯一の根拠なので、
 * **証明できないケースはすべて false** でなければならない (fail-closed)。
 * ここが true に倒れると上位の所有者照合が丸ごと無効化される。
 *
 * Customer Account API の `customer` はトークンの持ち主に暗黙スコープされるため、
 * 他人の契約 ID を渡すと `subscriptionContract` が null で返る。これを
 * 「持っていない証明」として使う。
 *
 * fetch は mock。実 Shopify へは一切アクセスしない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSubscriptionContractGid,
  verifySubscriptionContractOwnership,
} from "@/lib/shopify/customer";

const TOKEN = "shcat_test_access_token";
const CONTRACT = "gid://shopify/SubscriptionContract/1111";
const OTHER_CONTRACT = "gid://shopify/SubscriptionContract/2222";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isSubscriptionContractGid", () => {
  it("正しい形の SubscriptionContract GID を受け入れる", () => {
    expect(isSubscriptionContractGid(CONTRACT)).toBe(true);
  });

  it("別リソース種別・生の数値 ID・非文字列を拒否する", () => {
    expect(isSubscriptionContractGid("gid://shopify/Order/1111")).toBe(false);
    expect(isSubscriptionContractGid("gid://shopify/SubscriptionContract/abc")).toBe(false);
    expect(isSubscriptionContractGid("1111")).toBe(false);
    expect(isSubscriptionContractGid("")).toBe(false);
    expect(isSubscriptionContractGid(null)).toBe(false);
    expect(isSubscriptionContractGid(undefined)).toBe(false);
    expect(isSubscriptionContractGid(1111)).toBe(false);
    // 前後に余計なものを付けて正規表現を跨がせる細工も拒否する
    expect(
      isSubscriptionContractGid("gid://shopify/SubscriptionContract/1111 ")
    ).toBe(false);
    expect(
      isSubscriptionContractGid("x gid://shopify/SubscriptionContract/1111")
    ).toBe(false);
  });
});

describe("verifySubscriptionContractOwnership", () => {
  it("同じ契約が返れば true (所有の肯定的証明)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { customer: { subscriptionContract: { id: CONTRACT } } } })
    );

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("契約が null なら false (他人のもの)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { customer: { subscriptionContract: null } } })
    );

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(false);
  });

  it("違う契約 ID が返れば false", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { customer: { subscriptionContract: { id: OTHER_CONTRACT } } },
      })
    );

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(false);
  });

  it("GraphQL エラーで fail-closed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: [{ message: "throttled" }] })
    );

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(false);
  });

  it("HTTP エラーで fail-closed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(false);
  });

  it("ネットワーク例外で fail-closed", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(verifySubscriptionContractOwnership(TOKEN, CONTRACT)).resolves.toBe(false);
  });

  it("形式不正な契約 ID は API を叩かずに false", async () => {
    await expect(verifySubscriptionContractOwnership(TOKEN, "1111")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空トークンは API を叩かずに false", async () => {
    await expect(verifySubscriptionContractOwnership("", CONTRACT)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("照合クエリは契約 ID を variables で渡す (文字列連結で組まない)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { customer: { subscriptionContract: { id: CONTRACT } } } })
    );

    await verifySubscriptionContractOwnership(TOKEN, CONTRACT);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.variables).toEqual({ id: CONTRACT });
    // 呼び出し元のトークンで照合する (Admin トークンでは意味がない)
    expect((init.headers as Record<string, string>).Authorization).toBe(TOKEN);
  });
});

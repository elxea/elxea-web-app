/**
 * Tests for 定期便 Server Action の **GID 形式検証** (停止 / 再開 / 解約 / スキップ)。
 *
 * なぜ必要か: `lib/shopify/subscription-actions.ts` の export はすべて Server Action
 * = 公開 HTTP エンドポイントで、`contractId` はクライアント由来＝信頼できない。
 * 停止 / 再開 / 解約 / スキップは顧客自身のトークンで Customer Account API を叩くので
 * 「他人の契約を操作できる」問題は Shopify 側のスコープで防がれるが、**id の形**は
 * Shopify が見てくれない。形式不正な文字列がそのまま転送されると、
 *   - 返るエラー文の違いが「どの id が存在するか」を探る手掛かりになりうる
 *   - Shopify 側に無意味なリクエストが出る
 * ので、形式で弾いて **リクエストを 1 度も出さない**ことをここで固定する。
 *
 * 以前は skip だけが `isSubscriptionContractGid` を持ち、停止 / 再開 / 解約は
 * 素通しだった。この非対称の再発防止がこのファイルの目的。
 *
 * `__tests__/subscription-contract-ownership.test.ts` は customer.ts の関数を直接
 * 呼ぶ層のテスト。こちらは **Server Action の入口から呼んで** 実 customer.ts を
 * 通し、outbound fetch が 0 件であることを見る (customer.ts は mock しない)。
 * auth (セッション) だけを mock し、Shopify へは一切アクセスしない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/shopify/auth", () => ({
  getSession: () => getSessionMock(),
}));

import {
  pauseSubscriptionAction,
  activateSubscriptionAction,
  cancelSubscriptionAction,
  skipNextDeliveryAction,
} from "@/lib/shopify/subscription-actions";

const VALID_CONTRACT = "gid://shopify/SubscriptionContract/1111";

/** The single failure shape every contract-scoped action must return. */
const INVALID_ID = { success: false, error: "Invalid subscription contract ID" };

/**
 * skip だけは「顧客が画面で見ていたお届け予定日」を第 2 引数に取る (二重実行ガード)。
 * ここでの関心は **contractId の形式検証**なので、日付は常に妥当な値を与えて
 * 4 操作を同じ形 `(contractId) => Promise<ActionResult>` に揃える。
 */
const SEEN_DATE = "2026-09-01";

const ACTIONS = [
  ["pauseSubscriptionAction", pauseSubscriptionAction],
  ["activateSubscriptionAction", activateSubscriptionAction],
  ["cancelSubscriptionAction", cancelSubscriptionAction],
  [
    "skipNextDeliveryAction",
    (contractId: string) => skipNextDeliveryAction(contractId, SEEN_DATE),
  ],
] as const;

/**
 * 形式として不正な contractId。GID らしく見えるが SubscriptionContract ではない
 * / 数値サフィックスでない / 前後に空白がある など、Shopify に届いてはいけない形。
 */
const MALFORMED_CONTRACT_IDS = [
  "1111",
  "gid://shopify/Customer/1111",
  "gid://shopify/SubscriptionContract/abc",
  "gid://shopify/SubscriptionContract/",
  "gid://shopify/SubscriptionContract/1111 ",
  " gid://shopify/SubscriptionContract/1111",
  "gid://shopify/SubscriptionContract/1111/lines",
  "gid://shopify/SubscriptionContract/-1",
  "GID://SHOPIFY/SUBSCRIPTIONCONTRACT/1111",
  "",
] as const;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  getSessionMock.mockResolvedValue({
    accessToken: "shcat_test_access_token",
    refreshToken: "rt",
    expiresAt: Date.now() + 600_000,
  });
  // Any outbound request during these tests is itself the failure being tested.
  fetchMock = vi.fn(async () => {
    throw new Error("outbound request must not happen for a malformed contract id");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Server Action の GID 形式検証 — Shopify へ到達しない", () => {
  for (const [name, action] of ACTIONS) {
    for (const badId of MALFORMED_CONTRACT_IDS) {
      it(`${name}(${JSON.stringify(badId)}) は fetch を 1 度も呼ばない`, async () => {
        await expect(action(badId)).resolves.toEqual(INVALID_ID);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  }

  it("4 操作の失敗メッセージが完全に一致する (どの操作か・なぜ落ちたかを漏らさない)", async () => {
    const messages = await Promise.all(
      ACTIONS.map(async ([, action]) => (await action("1111")).error)
    );

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(INVALID_ID.error);
  });

  it("未ログインなら形式が正しくても Shopify へ到達しない", async () => {
    getSessionMock.mockResolvedValue(null);

    for (const [name, action] of ACTIONS) {
      await expect(action(VALID_CONTRACT), name).rejects.toThrow(/not authenticated/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("形式が正しく認証済みなら Customer Account API を実際に叩く (検証が過剰でない証拠)", async () => {
    // Only this test allows an outbound call; it asserts the happy path is not
    // accidentally blocked by the shape guard.
    const okFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { anyMutation: { userErrors: [] } } }),
      text: async () => "{}",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", okFetch);

    await expect(pauseSubscriptionAction(VALID_CONTRACT)).resolves.toEqual({
      success: true,
    });
    expect(okFetch).toHaveBeenCalledTimes(1);
  });
});

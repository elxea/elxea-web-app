/**
 * Tests for 定期便 Server Action の所有者照合（Admin API 経路）。
 *
 * なぜ必要か: lib/shopify/subscription-actions.ts の export は Server Action なので
 * すべて HTTP 露出しており、contractId はクライアント由来＝信頼できない。
 * changeDeliveryFrequencyAction / changeSubscriptionProductAction は
 * **ストア全体に効く Admin API トークン**を使うため、Shopify 側では呼び出し元顧客に
 * スコープされない。ログイン確認だけでは「ログイン済み別顧客が他人の契約を操作できる」。
 *
 * この層が守るべき契約:
 *   1. 所有者でない → Admin API 関数を **1 度も呼ばない**（拒否は照合の後ではなく前）。
 *   2. 照合不能（ネットワーク/GraphQL 失敗）→ 同じく拒否（fail-closed）。
 *   3. GID 形式不正 → 照合 API すら叩かずに拒否。
 *   4. エラーメッセージは「存在しない」「他人のもの」「照合不能」で区別しない
 *      （契約 ID の存在を探れるオラクルを作らない）。
 *   5. 所有者である → 従来どおり Admin API 経路が 1 回だけ走る。
 *   6. skipNextDeliveryAction は billingCycleIndex をクライアントから受け取らない
 *      （サイクル指定はサーバ側解決に限る）。
 *
 * auth（セッション）/ customer（照合）/ subscription-admin（Admin API）は mock。
 * 実 Shopify へは一切アクセスしない。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/shopify/auth", () => ({
  getSession: () => getSessionMock(),
}));

const verifyOwnershipMock = vi.fn();
const skipNextBillingCycleMock = vi.fn();
const pauseSubscriptionMock = vi.fn();
const activateSubscriptionMock = vi.fn();
const cancelSubscriptionMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  // isSubscriptionContractGid は純関数なので実物を使う（形状判定を二重定義しない）
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer"
  );
  return {
    ...actual,
    verifySubscriptionContractOwnership: (...args: unknown[]) =>
      verifyOwnershipMock(...args),
    skipNextBillingCycle: (...args: unknown[]) => skipNextBillingCycleMock(...args),
    pauseSubscription: (...args: unknown[]) => pauseSubscriptionMock(...args),
    activateSubscription: (...args: unknown[]) => activateSubscriptionMock(...args),
    cancelSubscription: (...args: unknown[]) => cancelSubscriptionMock(...args),
  };
});

const updateSubscriptionContractMock = vi.fn();
const getSellingPlanGroupsMock = vi.fn();
vi.mock("@/lib/shopify/subscription-admin", () => ({
  updateSubscriptionContract: (...args: unknown[]) =>
    updateSubscriptionContractMock(...args),
  getSellingPlanGroups: (...args: unknown[]) => getSellingPlanGroupsMock(...args),
}));

import {
  changeDeliveryFrequencyAction,
  pauseSubscriptionAction,
  skipNextDeliveryAction,
} from "@/lib/shopify/subscription-actions";
import { STALE_BILLING_CYCLE_VIEW } from "@/lib/subscription-view";

const OWN_CONTRACT = "gid://shopify/SubscriptionContract/1111";
const OTHER_CONTRACT = "gid://shopify/SubscriptionContract/2222";
const LINE_GID = "gid://shopify/SubscriptionLine/3333";
const VARIANT_GID = "gid://shopify/ProductVariant/4444";

/** The generic denial message — identical for every unauthorized outcome. */
const DENIED = "Subscription not found or not accessible";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getSessionMock.mockResolvedValue({
    accessToken: "shcat_test_access_token",
    refreshToken: "rt",
    expiresAt: Date.now() + 600_000,
  });
  updateSubscriptionContractMock.mockResolvedValue({ id: OWN_CONTRACT, status: "ACTIVE" });
  skipNextBillingCycleMock.mockResolvedValue({ success: true });
  pauseSubscriptionMock.mockResolvedValue({ success: true });
  // ストアに実在する selling plan (毎月 / 2ヶ月ごと / 3ヶ月ごと)。
  // 頻度変更はこの実データに含まれる頻度しか受け付けない。
  getSellingPlanGroupsMock.mockResolvedValue([
    {
      sellingPlans: [
        { deliveryPolicy: { interval: "MONTH", intervalCount: 1 } },
        { deliveryPolicy: { interval: "MONTH", intervalCount: 2 } },
        { deliveryPolicy: { interval: "MONTH", intervalCount: 3 } },
      ],
    },
  ]);
});

describe("changeDeliveryFrequencyAction — 所有者照合", () => {
  it("rejects a contract owned by another customer without touching the Admin API", async () => {
    verifyOwnershipMock.mockResolvedValue(false);

    const result = await changeDeliveryFrequencyAction(OTHER_CONTRACT, "MONTH", 1);

    expect(result).toEqual({ success: false, error: DENIED });
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("fails closed when ownership verification itself fails", async () => {
    verifyOwnershipMock.mockRejectedValue(new Error("verification transport failure"));

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 1);

    expect(result.success).toBe(false);
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed contract id without even verifying", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeDeliveryFrequencyAction("1111", "MONTH", 1);

    expect(result).toEqual({ success: false, error: DENIED });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller without verifying or calling the Admin API", async () => {
    getSessionMock.mockResolvedValue(null);
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 1);

    expect(result.success).toBe(false);
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("does not distinguish 'not owned' from 'verification failed' in the message", async () => {
    verifyOwnershipMock.mockResolvedValue(false);
    const notOwned = await changeDeliveryFrequencyAction(OTHER_CONTRACT, "MONTH", 1);

    verifyOwnershipMock.mockResolvedValue(false);
    const malformed = await changeDeliveryFrequencyAction("gid://shopify/Customer/9", "MONTH", 1);

    expect(notOwned.error).toBe(DENIED);
    expect(malformed.error).toBe(DENIED);
  });

  it("proceeds for the owner, verifying with the session token first", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 2);

    expect(result).toEqual({ success: true });
    expect(verifyOwnershipMock).toHaveBeenCalledWith(
      "shcat_test_access_token",
      OWN_CONTRACT
    );
    expect(updateSubscriptionContractMock).toHaveBeenCalledTimes(1);
    expect(updateSubscriptionContractMock).toHaveBeenCalledWith(OWN_CONTRACT, {
      deliveryPolicy: { interval: "MONTH", intervalCount: 2 },
      billingPolicy: { interval: "MONTH", intervalCount: 2 },
    });
  });

  it("rejects a frequency the store does not actually sell", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    // 毎週 / 隔週は Shopify に selling plan が無い。画面が古くても、あるいは
    // リクエストを直接作られても、実在しない頻度で契約を書き換えさせない。
    const weekly = await changeDeliveryFrequencyAction(OWN_CONTRACT, "WEEK", 1);
    const biWeekly = await changeDeliveryFrequencyAction(OWN_CONTRACT, "WEEK", 2);

    expect(weekly).toEqual({ success: false, error: "Unsupported delivery frequency" });
    expect(biWeekly).toEqual({ success: false, error: "Unsupported delivery frequency" });
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("still validates the interval payload before authorizing", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    // @ts-expect-error deliberately invalid interval from an untrusted caller
    const badInterval = await changeDeliveryFrequencyAction(OWN_CONTRACT, "FORTNIGHT", 1);
    const badCount = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 0);
    const fractionalCount = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 1.5);

    expect(badInterval).toEqual({ success: false, error: "Invalid interval" });
    expect(badCount).toEqual({ success: false, error: "Invalid interval count" });
    expect(fractionalCount).toEqual({ success: false, error: "Invalid interval count" });
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });
});

/**
 * 顧客に返すメッセージに内部情報を混ぜない (2026-08-12 の QA 指摘 3)。
 *
 * これらの action の返り値はそのままブラウザに届く。実測された漏洩例は
 * `{"success":false,"error":"Customer API 429 throttled for customer 8877"}` で、
 * 顧客 ID と外部 API の内部状態が画面に出ていた。従来のテストは
 * `success === false` しか見ておらずメッセージを固定していなかったため、
 * いつでも表に出せる状態だった。ここで**文言そのもの**を固定する。
 */
describe("エラーメッセージに内部情報を載せない", () => {
  /** 内部情報と判定する語 (顧客 ID・外部 API 名・HTTP status・生の例外文)。 */
  const INTERNAL_MARKERS = [
    "Customer API",
    "throttled",
    "customer 8877",
    "GraphQL",
    "429",
    "500",
    "Shopify",
    "transport",
    "fetch",
  ];

  function expectNoInternalDetail(message: string | undefined) {
    if (message === undefined) return; // 文言を載せない = 画面側の localized 文言に委ねる
    for (const marker of INTERNAL_MARKERS) {
      expect(message.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  }

  it("照合が内部エラーで落ちても、返るのは一般化した固定文言だけ", async () => {
    // 実測された漏洩の形をそのまま再現する
    verifyOwnershipMock.mockRejectedValue(
      new Error("Customer API 429 throttled for customer 8877")
    );

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 1);

    expect(result).toEqual({ success: false, error: DENIED });
    expectNoInternalDetail(result.error);
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  });

  it("Admin API が生メッセージで落ちても、それを顧客に返さない", async () => {
    verifyOwnershipMock.mockResolvedValue(true);
    updateSubscriptionContractMock.mockRejectedValue(
      new Error("Shopify subscriptionDraftCommit failed: internal draft 998877")
    );

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 2);

    // 文言を載せない → 画面は自分の localized な frequencyChangeError を出す
    expect(result).toEqual({ success: false });
    expectNoInternalDetail(result.error);
  });

  it("Customer API の userErrors を顧客に転送しない", async () => {
    // pause は Customer Account API 経路。executeSubscriptionMutation の
    // userErrors がそのまま返っていた箇所を固定する。
    pauseSubscriptionMock.mockResolvedValue({ success: false });

    const result = await pauseSubscriptionAction(OWN_CONTRACT);

    expect(result).toEqual({ success: false });
    expectNoInternalDetail(result.error);
  });
});

describe("skipNextDeliveryAction", () => {
  const SEEN_DATE = "2026-09-01";

  it("does not let the caller choose the billing cycle index", async () => {
    // 受け取る 2 つ目の引数は「顧客が画面で見ていたお届け予定日」であって
    // 周期指定ではない。billingCycleIndex は undefined のまま渡し、index の解決は
    // サーバ (customer.ts) に閉じたままであることを固定する。
    expect(skipNextDeliveryAction.length).toBe(2);

    await skipNextDeliveryAction(OWN_CONTRACT, SEEN_DATE);

    expect(skipNextBillingCycleMock).toHaveBeenCalledWith(
      "shcat_test_access_token",
      OWN_CONTRACT,
      undefined,
      SEEN_DATE
    );
  });

  it("rejects an unauthenticated caller", async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(skipNextDeliveryAction(OWN_CONTRACT, SEEN_DATE)).rejects.toThrow(
      /not authenticated/i
    );
    expect(skipNextBillingCycleMock).not.toHaveBeenCalled();
  });

  /**
   * 二重実行ガードの入口側 (2026-08-11 の失敗系監査 Medium-4)。
   * 見ていた日付が無いまま呼ばれたら、周期を解決せずに拒否する — Server Action は
   * 公開 HTTP エンドポイントなので、ガードを外して呼べる抜け道を残さない。
   */
  it("拒否する: 見ていたお届け予定日が無いとき (Shopify へ到達しない)", async () => {
    const result = await skipNextDeliveryAction(OWN_CONTRACT, null);

    expect(result).toEqual({
      success: false,
      error: STALE_BILLING_CYCLE_VIEW,
    });
    expect(skipNextBillingCycleMock).not.toHaveBeenCalled();
  });

  it("形式不正の契約 ID は日付の有無より先に弾く (エラー文言の対称性を保つ)", async () => {
    const result = await skipNextDeliveryAction("1111", null);

    expect(result).toEqual({
      success: false,
      error: "Invalid subscription contract ID",
    });
    expect(skipNextBillingCycleMock).not.toHaveBeenCalled();
  });
});

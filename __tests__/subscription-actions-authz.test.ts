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
const changeSubscriptionLineItemMock = vi.fn();
vi.mock("@/lib/shopify/subscription-admin", () => ({
  updateSubscriptionContract: (...args: unknown[]) =>
    updateSubscriptionContractMock(...args),
  changeSubscriptionLineItem: (...args: unknown[]) =>
    changeSubscriptionLineItemMock(...args),
}));

import {
  changeDeliveryFrequencyAction,
  changeSubscriptionProductAction,
  skipNextDeliveryAction,
} from "@/lib/shopify/subscription-actions";

const OWN_CONTRACT = "gid://shopify/SubscriptionContract/1111";
const OTHER_CONTRACT = "gid://shopify/SubscriptionContract/2222";
const LINE_GID = "gid://shopify/SubscriptionLine/3333";
const VARIANT_GID = "gid://shopify/ProductVariant/4444";

/** The generic denial message — identical for every unauthorized outcome. */
const DENIED = "Subscription not found or not accessible";

function changeProduct(contractId: string) {
  return changeSubscriptionProductAction(contractId, LINE_GID, VARIANT_GID, "3800");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getSessionMock.mockResolvedValue({
    accessToken: "shcat_test_access_token",
    refreshToken: "rt",
    expiresAt: Date.now() + 600_000,
  });
  updateSubscriptionContractMock.mockResolvedValue({ id: OWN_CONTRACT, status: "ACTIVE" });
  changeSubscriptionLineItemMock.mockResolvedValue({ id: OWN_CONTRACT, status: "ACTIVE" });
  skipNextBillingCycleMock.mockResolvedValue({ success: true });
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

    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "WEEK", 2);

    expect(result).toEqual({ success: true });
    expect(verifyOwnershipMock).toHaveBeenCalledWith(
      "shcat_test_access_token",
      OWN_CONTRACT
    );
    expect(updateSubscriptionContractMock).toHaveBeenCalledTimes(1);
    expect(updateSubscriptionContractMock).toHaveBeenCalledWith(OWN_CONTRACT, {
      deliveryPolicy: { interval: "WEEK", intervalCount: 2 },
      billingPolicy: { interval: "WEEK", intervalCount: 2 },
    });
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

describe("changeSubscriptionProductAction — 所有者照合", () => {
  it("rejects a contract owned by another customer without touching the Admin API", async () => {
    verifyOwnershipMock.mockResolvedValue(false);

    const result = await changeProduct(OTHER_CONTRACT);

    expect(result).toEqual({ success: false, error: DENIED });
    expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
  });

  it("fails closed when ownership verification itself fails", async () => {
    verifyOwnershipMock.mockRejectedValue(new Error("verification transport failure"));

    const result = await changeProduct(OWN_CONTRACT);

    expect(result.success).toBe(false);
    expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed contract id without even verifying", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeProduct("gid://shopify/SubscriptionContract/not-a-number");

    expect(result).toEqual({ success: false, error: DENIED });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    getSessionMock.mockResolvedValue(null);
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeProduct(OWN_CONTRACT);

    expect(result.success).toBe(false);
    expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid quantity before authorizing", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeSubscriptionProductAction(
      OWN_CONTRACT,
      LINE_GID,
      VARIANT_GID,
      "3800",
      0
    );

    expect(result).toEqual({ success: false, error: "Invalid quantity" });
    expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
  });

  it("proceeds for the owner", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await changeProduct(OWN_CONTRACT);

    expect(result).toEqual({ success: true });
    expect(changeSubscriptionLineItemMock).toHaveBeenCalledTimes(1);
    expect(changeSubscriptionLineItemMock).toHaveBeenCalledWith(OWN_CONTRACT, LINE_GID, {
      productVariantId: VARIANT_GID,
      currentPrice: "3800",
      quantity: 1,
    });
  });
});

describe("skipNextDeliveryAction", () => {
  it("does not let the caller choose the billing cycle index", async () => {
    // The action takes exactly one parameter; the cycle is resolved server-side.
    expect(skipNextDeliveryAction.length).toBe(1);

    await skipNextDeliveryAction(OWN_CONTRACT);

    expect(skipNextBillingCycleMock).toHaveBeenCalledWith(
      "shcat_test_access_token",
      OWN_CONTRACT
    );
  });

  it("rejects an unauthenticated caller", async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(skipNextDeliveryAction(OWN_CONTRACT)).rejects.toThrow(/not authenticated/i);
    expect(skipNextBillingCycleMock).not.toHaveBeenCalled();
  });
});

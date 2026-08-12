/**
 * 定期便 Server Action の所有者照合 (Admin API 経路)。
 *
 * なぜ必要か: lib/shopify/subscription-actions.ts の export は Server Action なので
 * すべて HTTP 露出しており、contractId はクライアント由来 = 信頼できない。
 * changeDeliveryFrequencyAction / changeSubscriptionProductAction は
 * **ストア全体に効く Admin API トークン**を使うため、Shopify 側では呼び出し元顧客に
 * スコープされない。ログイン確認だけでは「ログイン済みの別顧客が他人の契約を操作できる」
 * (2026-08-12 に実データ調査で確認された IDOR)。
 *
 * この層が守るべき契約:
 *   1. 所有者でない → Admin API 関数を **1 度も呼ばない** (拒否は照合の後ではなく前)。
 *   2. 照合不能 (ネットワーク / GraphQL 失敗) → 同じく拒否 (fail-closed)。
 *   3. GID 形式不正 → 照合 API すら叩かずに拒否。
 *   4. エラーメッセージは「存在しない」「他人のもの」「照合不能」で区別しない
 *      (契約 ID の存在を探れるオラクルを作らない)。
 *   5. 所有者である → 従来どおり Admin API 経路が 1 回だけ走る。
 *
 * auth (セッション) / customer (照合) / subscription-admin (Admin API) は mock。
 * 実 Shopify へは一切アクセスしない。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/shopify/auth", () => ({
  getSession: () => getSessionMock(),
}));

const verifyOwnershipMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  // isSubscriptionContractGid は純関数なので実物を使う (形状判定を二重定義しない)
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer"
  );
  return {
    ...actual,
    verifySubscriptionContractOwnership: (...args: unknown[]) =>
      verifyOwnershipMock(...args),
    pauseSubscription: vi.fn(),
    activateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    skipNextBillingCycle: vi.fn(),
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
} from "@/lib/shopify/subscription-actions";

const OWN_CONTRACT = "gid://shopify/SubscriptionContract/1111";
const OTHER_CONTRACT = "gid://shopify/SubscriptionContract/2222";
const LINE_GID = "gid://shopify/SubscriptionLine/3333";
const VARIANT_GID = "gid://shopify/ProductVariant/4444";

/** 許可されない結果すべてに共通の汎用メッセージ。 */
const DENIED = "Subscription not found or not accessible";

function changeFrequency(contractId: string) {
  return changeDeliveryFrequencyAction(contractId, "MONTH", 1);
}

function changeProduct(contractId: string) {
  return changeSubscriptionProductAction(contractId, LINE_GID, VARIANT_GID, "3800");
}

/** Admin API に一切到達していないことの確認 (拒否は照合より後ろに置かない)。 */
function expectAdminApiUntouched() {
  expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
  expect(changeSubscriptionLineItemMock).not.toHaveBeenCalled();
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
});

describe.each([
  ["changeDeliveryFrequencyAction", changeFrequency],
  ["changeSubscriptionProductAction", changeProduct],
] as const)("%s — 所有者照合", (_name, run) => {
  it("他人の契約 ID を拒否し、Admin API に到達させない", async () => {
    verifyOwnershipMock.mockResolvedValue(false);

    const result = await run(OTHER_CONTRACT);

    expect(result).toEqual({ success: false, error: DENIED });
    expectAdminApiUntouched();
  });

  it("照合自体が失敗したときも拒否する (fail-closed)", async () => {
    verifyOwnershipMock.mockRejectedValue(new Error("network down"));

    const result = await run(OWN_CONTRACT);

    expect(result.success).toBe(false);
    expectAdminApiUntouched();
  });

  it("形式不正な契約 ID は照合 API すら叩かずに拒否する", async () => {
    const result = await run("1111");

    expect(result).toEqual({ success: false, error: DENIED });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expectAdminApiUntouched();
  });

  it("未ログインなら照合も Admin API も走らない", async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await run(OWN_CONTRACT);

    expect(result.success).toBe(false);
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expectAdminApiUntouched();
  });

  it("所有者ならセッショントークンで照合してから 1 回だけ Admin API へ進む", async () => {
    verifyOwnershipMock.mockResolvedValue(true);

    const result = await run(OWN_CONTRACT);

    expect(result).toEqual({ success: true });
    expect(verifyOwnershipMock).toHaveBeenCalledWith(
      "shcat_test_access_token",
      OWN_CONTRACT
    );
    const adminCalls =
      updateSubscriptionContractMock.mock.calls.length +
      changeSubscriptionLineItemMock.mock.calls.length;
    expect(adminCalls).toBe(1);
  });
});

describe("拒否メッセージの対称性", () => {
  it("「他人のもの」と「照合不能」を文言で区別しない", async () => {
    verifyOwnershipMock.mockResolvedValue(false);
    const notOwned = await changeFrequency(OTHER_CONTRACT);

    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      accessToken: "shcat_test_access_token",
      refreshToken: "rt",
      expiresAt: Date.now() + 600_000,
    });
    verifyOwnershipMock.mockResolvedValue(false);
    const malformed = await changeFrequency("gid://shopify/Order/9999");

    expect(notOwned.error).toBe(DENIED);
    expect(malformed.error).toBe(DENIED);
  });
});

describe("入力検証は照合より前に落とす", () => {
  it("不正な interval は照合せずに弾く", async () => {
    const result = await changeDeliveryFrequencyAction(
      OWN_CONTRACT,
      "FORTNIGHT" as never,
      1
    );

    expect(result).toEqual({ success: false, error: "Invalid interval" });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
    expectAdminApiUntouched();
  });

  it("整数でない intervalCount を弾く", async () => {
    const result = await changeDeliveryFrequencyAction(OWN_CONTRACT, "MONTH", 1.5);

    expect(result).toEqual({ success: false, error: "Invalid interval count" });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
  });

  it("不正な quantity を弾く", async () => {
    const result = await changeSubscriptionProductAction(
      OWN_CONTRACT,
      LINE_GID,
      VARIANT_GID,
      "3800",
      0
    );

    expect(result).toEqual({ success: false, error: "Invalid quantity" });
    expect(verifyOwnershipMock).not.toHaveBeenCalled();
  });
});

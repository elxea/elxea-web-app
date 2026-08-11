/**
 * Tests for `lib/shopify/billing-cycle-reset` — 再開時に置く「課金周期リセット」
 * マーカーの読み書き。
 *
 * このモジュールが守るべき契約:
 *   1. 契約 GID の数値サフィックスを doc ID にする (GID をそのまま使わない)。
 *   2. 読めない / 無い / 壊れている場合は `null` = 「リセット無し」。null は従来判定
 *      (課金を足さない側) を意味するので、Firestore 障害が誤課金に化けない。
 *   3. 書き込み失敗で例外を投げない (顧客の再開操作を壊さない)。
 *   4. TTL フィールドを必ず持つ (台帳が無限に伸びない)。
 *
 * Firestore は mock。**実 Firestore に触れない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const docMock = vi.fn();
const collectionMock = vi.fn();
const getAdminFirestoreMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: (...args: unknown[]) => getAdminFirestoreMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-timestamp" },
  Timestamp: { fromDate: (d: Date) => ({ __ts: d.toISOString(), toDate: () => d }) },
}));

import {
  CYCLE_RESET_COLLECTION,
  cycleResetDocId,
  getBillingCycleResetAt,
  recordBillingCycleReset,
} from "@/lib/shopify/billing-cycle-reset";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/25318162590";
const RESET_AT = new Date("2026-06-18T09:00:00.000Z");

let setMock: ReturnType<typeof vi.fn>;
let getMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  setMock = vi.fn().mockResolvedValue(undefined);
  getMock = vi.fn().mockResolvedValue({ exists: false, data: () => undefined });
  docMock.mockReturnValue({ set: setMock, get: getMock });
  collectionMock.mockReturnValue({ doc: docMock });
  getAdminFirestoreMock.mockReturnValue({ collection: collectionMock });
});

describe("cycleResetDocId", () => {
  it("契約 GID の数値サフィックスを doc ID にする", () => {
    expect(cycleResetDocId(CONTRACT_GID)).toBe("25318162590");
  });

  it("SubscriptionContract 以外・形式不正は null", () => {
    expect(cycleResetDocId("gid://shopify/Customer/1111")).toBeNull();
    expect(cycleResetDocId("25318162590")).toBeNull();
    expect(cycleResetDocId("gid://shopify/SubscriptionContract/abc")).toBeNull();
    expect(cycleResetDocId("")).toBeNull();
  });
});

describe("recordBillingCycleReset", () => {
  it("契約・理由・時刻・TTL を書く", async () => {
    await expect(
      recordBillingCycleReset(CONTRACT_GID, { at: RESET_AT })
    ).resolves.toBe(true);

    expect(collectionMock).toHaveBeenCalledWith(CYCLE_RESET_COLLECTION);
    expect(docMock).toHaveBeenCalledWith("25318162590");

    const written = setMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.contractId).toBe(CONTRACT_GID);
    expect(written.reason).toBe("customer-resume");
    expect(written.resetAtIso).toBe(RESET_AT.toISOString());
    expect(written.ttl).toBeDefined();
  });

  it("形式不正の契約 ID では書かない", async () => {
    await expect(recordBillingCycleReset("1111")).resolves.toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("Firestore が落ちても throw せず false を返す (再開操作を壊さない)", async () => {
    setMock.mockRejectedValue(new Error("firestore unavailable"));

    await expect(recordBillingCycleReset(CONTRACT_GID)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("getBillingCycleResetAt", () => {
  it("ISO 文字列から時刻を読む", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ resetAtIso: RESET_AT.toISOString() }),
    });

    const at = await getBillingCycleResetAt(CONTRACT_GID);
    expect(at?.toISOString()).toBe(RESET_AT.toISOString());
  });

  it("Timestamp 形式 (toDate を持つ値) からも読む", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ resetAt: { toDate: () => RESET_AT } }),
    });

    const at = await getBillingCycleResetAt(CONTRACT_GID);
    expect(at?.toISOString()).toBe(RESET_AT.toISOString());
  });

  it("doc が無ければ null", async () => {
    getMock.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(getBillingCycleResetAt(CONTRACT_GID)).resolves.toBeNull();
  });

  it("値が壊れていれば null (推測で日付を作らない)", async () => {
    getMock.mockResolvedValue({
      exists: true,
      data: () => ({ resetAtIso: "not-a-date" }),
    });

    await expect(getBillingCycleResetAt(CONTRACT_GID)).resolves.toBeNull();
  });

  it("Firestore が落ちたら null (= リセット無し = 課金を足さない側)", async () => {
    getMock.mockRejectedValue(new Error("firestore unavailable"));

    await expect(getBillingCycleResetAt(CONTRACT_GID)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("形式不正の契約 ID では Firestore に触らない", async () => {
    await expect(getBillingCycleResetAt("1111")).resolves.toBeNull();
    expect(getAdminFirestoreMock).not.toHaveBeenCalled();
  });
});

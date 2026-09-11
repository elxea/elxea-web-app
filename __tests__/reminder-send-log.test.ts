/**
 * Tests for `lib/email/reminder-send-log` — リマインダーの送信予約 (二重送信ガード)。
 *
 * このモジュールが守るべき契約:
 *   1. 予約は `create()` で取る (既存があれば失敗する = Firestore の原子性に任せる)。
 *   2. ALREADY_EXISTS は `duplicate` として返す (異常ではない)。
 *   3. それ以外の失敗は `claim-failed`。呼び出し側は**送らない**。
 *   4. キーが作れない (契約 ID / 日付の形が不正) 場合も `claim-failed`。
 *   5. 結果の書き戻しに失敗しても throw しない (記録の失敗でメールの成否は変わらない)。
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
  claimReminderSend,
  recordReminderOutcome,
  reminderLogDocId,
  REMINDER_LOG_COLLECTION,
} from "@/lib/email/reminder-send-log";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/2222";
const DATE = "2026-08-14";

let createMock: ReturnType<typeof vi.fn>;
let setMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});

  createMock = vi.fn().mockResolvedValue(undefined);
  setMock = vi.fn().mockResolvedValue(undefined);
  docMock.mockReturnValue({ create: createMock, set: setMock });
  collectionMock.mockReturnValue({ doc: docMock });
  getAdminFirestoreMock.mockReturnValue({ collection: collectionMock });
});

describe("reminderLogDocId", () => {
  it("契約の数値 ID と対象日を組み合わせる", () => {
    expect(reminderLogDocId(CONTRACT_GID, DATE)).toBe("2222_2026-08-14");
  });

  it("契約 ID・日付の形が不正なら null", () => {
    expect(reminderLogDocId("2222", DATE)).toBeNull();
    expect(reminderLogDocId(CONTRACT_GID, "2026/08/14")).toBeNull();
    expect(reminderLogDocId(CONTRACT_GID, "")).toBeNull();
  });
});

describe("claimReminderSend", () => {
  it("create で予約を取り、docId を返す", async () => {
    const claim = await claimReminderSend(CONTRACT_GID, DATE);

    expect(claim).toEqual({ claimed: true, docId: "2222_2026-08-14" });
    expect(collectionMock).toHaveBeenCalledWith(REMINDER_LOG_COLLECTION);
    expect(docMock).toHaveBeenCalledWith("2222_2026-08-14");
    const written = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.contractId).toBe(CONTRACT_GID);
    expect(written.reminderDate).toBe(DATE);
    expect(written.ttl).toBeDefined();
  });

  it("既に予約があれば duplicate (code 6 = ALREADY_EXISTS)", async () => {
    createMock.mockRejectedValue(Object.assign(new Error("boom"), { code: 6 }));

    await expect(claimReminderSend(CONTRACT_GID, DATE)).resolves.toEqual({
      claimed: false,
      reason: "duplicate",
    });
  });

  it("メッセージだけで判る ALREADY_EXISTS も duplicate として扱う", async () => {
    createMock.mockRejectedValue(new Error("Document already exists: foo"));

    await expect(claimReminderSend(CONTRACT_GID, DATE)).resolves.toMatchObject({
      claimed: false,
      reason: "duplicate",
    });
  });

  it("その他の失敗は claim-failed (呼び出し側は送らない)", async () => {
    createMock.mockRejectedValue(new Error("firestore unavailable"));

    const claim = await claimReminderSend(CONTRACT_GID, DATE);

    expect(claim).toMatchObject({ claimed: false, reason: "claim-failed" });
  });

  it("キーが作れなければ Firestore に触らない", async () => {
    const claim = await claimReminderSend("2222", DATE);

    expect(claim).toMatchObject({ claimed: false, reason: "claim-failed" });
    expect(getAdminFirestoreMock).not.toHaveBeenCalled();
  });
});

describe("recordReminderOutcome", () => {
  it("送信結果を merge で書き戻す", async () => {
    await recordReminderOutcome("2222_2026-08-14", { sent: true });

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
      { merge: true }
    );
  });

  it("失敗理由も残す", async () => {
    await recordReminderOutcome("2222_2026-08-14", {
      sent: false,
      error: "rate limit",
    });

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "rate limit" }),
      { merge: true }
    );
  });

  it("書き戻しに失敗しても throw しない", async () => {
    setMock.mockRejectedValue(new Error("firestore unavailable"));

    await expect(
      recordReminderOutcome("2222_2026-08-14", { sent: true })
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

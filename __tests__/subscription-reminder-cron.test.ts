/**
 * Tests for GET /api/cron/subscription-reminder の**二重送信ガードと沈黙の解消**
 * (シナリオ S5-4)。
 *
 * 是正前の欠陥 (2026-08-11 の失敗系監査 Medium-2):
 *   1. 対象日の一致だけで契約を拾い、冪等キーが無かった。cron が同じ日に二重発火
 *      すると**同じ顧客に同じメールが 2 通**届いた。
 *   2. `sendSubscriptionReminder` は Resend のエラー応答を例外にせず
 *      `{ success: false }` を返すため、throw 経路にしか無かった Sentry には
 *      一切乗らず、不着が沈黙した。
 *
 * この仕様が守るべき契約:
 *   1. 送る前に「契約 x 対象日」の予約を取り、取れたときだけ送る。
 *   2. 予約が既にある (= 送信済み) なら送らない。異常ではないので Sentry には上げない。
 *   3. 予約が取れない (Firestore 障害) なら**送らない**で監視に上げる
 *      (予約なしで送ると二重送信を防げなくなる)。
 *   4. `success: false` は Sentry に上がり、summary の errors に計上される。
 *   5. 送信結果は台帳に書き戻す (運営が後から追える)。
 *
 * Resend・Shopify・Firestore はすべて mock。**実送信しない**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "cron-secret-for-tests";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-for-tests";
});

const getSubscriptionContractsMock = vi.fn();
vi.mock("@/lib/shopify/subscription-admin", () => ({
  getSubscriptionContracts: (...args: unknown[]) =>
    getSubscriptionContractsMock(...args),
}));

const sendSubscriptionReminderMock = vi.fn();
vi.mock("@/lib/email/subscription-reminder", () => ({
  sendSubscriptionReminder: (...args: unknown[]) =>
    sendSubscriptionReminderMock(...args),
}));

const claimReminderSendMock = vi.fn();
const recordReminderOutcomeMock = vi.fn();
vi.mock("@/lib/email/reminder-send-log", () => ({
  claimReminderSend: (...args: unknown[]) => claimReminderSendMock(...args),
  recordReminderOutcome: (...args: unknown[]) =>
    recordReminderOutcomeMock(...args),
}));

const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import { GET } from "@/app/api/cron/subscription-reminder/route";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/2222";
/** 現在 08-11 / リマインダーは 3 日後 = 08-14 の請求分。 */
const NOW = new Date("2026-08-11T02:00:00.000Z");
const REMINDER_DATE = "2026-08-14";

function contract() {
  return {
    id: CONTRACT_GID,
    nextBillingDate: `${REMINDER_DATE}T00:00:00.000Z`,
    customer: { email: "customer@example.test", displayName: "Test Customer" },
    lines: [
      {
        title: "Tea Subscription",
        quantity: 1,
        currentPrice: { amount: "3000", currencyCode: "JPY" },
      },
    ],
    deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
  };
}

function request(): NextRequest {
  return new NextRequest("http://localhost/api/cron/subscription-reminder", {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

type Body = {
  sent: number;
  errors: number;
  skipped: number;
  duplicates: number;
  results: { status: string; detail?: string }[];
};

async function runCron(): Promise<Body> {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([contract()]);
  claimReminderSendMock.mockResolvedValue({ claimed: true, docId: "2222_2026-08-14" });
  sendSubscriptionReminderMock.mockResolvedValue({ success: true });
  recordReminderOutcomeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("二重送信ガード", () => {
  it("予約が取れたときだけ送る (契約 x 対象日で 1 通)", async () => {
    const body = await runCron();

    expect(claimReminderSendMock).toHaveBeenCalledWith(CONTRACT_GID, REMINDER_DATE);
    expect(sendSubscriptionReminderMock).toHaveBeenCalledTimes(1);
    expect(body.sent).toBe(1);
    expect(body.duplicates).toBe(0);
  });

  it("同じ対象日の 2 回目は送らない (cron 二重発火)", async () => {
    claimReminderSendMock.mockResolvedValue({ claimed: false, reason: "duplicate" });

    const body = await runCron();

    expect(sendSubscriptionReminderMock).not.toHaveBeenCalled();
    expect(body.duplicates).toBe(1);
    expect(body.sent).toBe(0);
    // 正常系なので監視には上げない
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("予約が取れなければ送らずに監視へ上げる (予約なしで送らない)", async () => {
    claimReminderSendMock.mockResolvedValue({
      claimed: false,
      reason: "claim-failed",
      detail: "firestore unavailable",
    });

    const body = await runCron();

    expect(sendSubscriptionReminderMock).not.toHaveBeenCalled();
    expect(body.errors).toBe(1);
    expect(body.results[0]!.detail).toContain("Reminder claim failed");
    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Subscription Reminder] claim failed",
      expect.objectContaining({ level: "error" })
    );
  });
});

describe("送信失敗の沈黙を解消する", () => {
  it("success: false を Sentry に上げ、errors に計上する", async () => {
    sendSubscriptionReminderMock.mockResolvedValue({
      success: false,
      error: "Resend rate limit exceeded",
    });

    const body = await runCron();

    expect(body.errors).toBe(1);
    expect(body.sent).toBe(0);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Subscription Reminder] email not sent",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          contractId: CONTRACT_GID,
          reason: "Resend rate limit exceeded",
        }),
      })
    );
  });

  it("送信結果を台帳へ書き戻す (成功・失敗とも)", async () => {
    await runCron();
    expect(recordReminderOutcomeMock).toHaveBeenCalledWith("2222_2026-08-14", {
      sent: true,
      error: undefined,
    });

    vi.clearAllMocks();
    getSubscriptionContractsMock.mockResolvedValue([contract()]);
    claimReminderSendMock.mockResolvedValue({ claimed: true, docId: "2222_2026-08-14" });
    recordReminderOutcomeMock.mockResolvedValue(undefined);
    sendSubscriptionReminderMock.mockRejectedValue(new Error("network down"));

    await runCron();

    expect(recordReminderOutcomeMock).toHaveBeenCalledWith("2222_2026-08-14", {
      sent: false,
      error: "network down",
    });
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

describe("宛先が無い契約", () => {
  it("予約も取らずに skipped にする (無駄な予約を残さない)", async () => {
    getSubscriptionContractsMock.mockResolvedValue([
      { ...contract(), customer: { email: null, displayName: null } },
    ]);

    const body = await runCron();

    expect(claimReminderSendMock).not.toHaveBeenCalled();
    expect(sendSubscriptionReminderMock).not.toHaveBeenCalled();
    expect(body.skipped).toBe(1);
  });
});

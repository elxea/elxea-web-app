/**
 * Tests for 督促メールの**送信可否が申告に必ず現れる**こと (シナリオ S5-3)。
 *
 * 是正前の欠陥 (2026-08-11 の失敗系監査 High-2):
 *   `sendDunningEmail` は Resend のエラー応答を例外にせず `{ success: false }` を返す。
 *   課金 cron は戻り値を見ずに「Dunning email sent」と console.log するだけだったので、
 *   メール不着は Sentry にも LINE にも乗らず完全に沈黙した。さらに運営宛の停止通知は
 *   固定文で「顧客への最終案内は送信済み」と書いていたため、**届いていない契約まで
 *   案内済みと誤認**させた。
 *
 * この仕様が守るべき契約:
 *   1. `{ success: false }` は Sentry に error として上がる。
 *   2. summary の `dunning_email_failed` に計上され、結果の detail にも現れる。
 *   3. 停止通知には実結果 (`customerNotified`) がそのまま渡る。
 *   4. 課金処理そのものは止めない (メールが送れないことは課金の失敗ではない)。
 *   5. 送信例外・宛先不明も同じ扱い (沈黙する経路を残さない)。
 *   6. 送れているときは false positive を出さない。
 *
 * Shopify Admin・Resend・LINE・Firestore はすべて mock。**実送信しない**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "cron-secret-for-tests";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-for-tests";
});

const getSubscriptionContractsMock = vi.fn();
const getSubscriptionContractMock = vi.fn();
const createBillingAttemptMock = vi.fn();
const getBillingAttemptsMock = vi.fn();
const updateSubscriptionContractMock = vi.fn();

vi.mock("@/lib/shopify/subscription-admin", () => ({
  getSubscriptionContracts: (...args: unknown[]) =>
    getSubscriptionContractsMock(...args),
  getSubscriptionContract: (...args: unknown[]) =>
    getSubscriptionContractMock(...args),
  createBillingAttempt: (...args: unknown[]) =>
    createBillingAttemptMock(...args),
  getBillingAttempts: (...args: unknown[]) => getBillingAttemptsMock(...args),
  updateSubscriptionContract: (...args: unknown[]) =>
    updateSubscriptionContractMock(...args),
}));

const getBillingCycleResetAtMock = vi.fn();
vi.mock("@/lib/shopify/billing-cycle-reset", () => ({
  getBillingCycleResetAt: (...args: unknown[]) =>
    getBillingCycleResetAtMock(...args),
}));

const sendDunningEmailMock = vi.fn();
vi.mock("@/lib/email/dunning", () => ({
  sendDunningEmail: (...args: unknown[]) => sendDunningEmailMock(...args),
}));

const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();
// nextBillingDate の前進は Shopify Admin を叩くので mock する。ここでは「呼ばれた/
// 呼ばれない」の配線だけが関心事で、前進そのものの検証は
// __tests__/next-billing-date.test.ts と __tests__/billing-advance-wiring.test.ts が持つ。
const advanceNextBillingDateMock = vi.fn();
vi.mock("@/lib/shopify/next-billing-date", () => ({
  advanceNextBillingDate: (...args: unknown[]) =>
    advanceNextBillingDateMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

const notifyBillingRunFailuresMock = vi.fn();
const notifySubscriptionPausedMock = vi.fn();
const notifyBillingCronFatalMock = vi.fn();
vi.mock("@/lib/line/monitoring-alerts", () => ({
  notifyBillingRunFailures: (...args: unknown[]) =>
    notifyBillingRunFailuresMock(...args),
  notifySubscriptionPaused: (...args: unknown[]) =>
    notifySubscriptionPausedMock(...args),
  notifyBillingCronFatal: (...args: unknown[]) =>
    notifyBillingCronFatalMock(...args),
}));

import { GET } from "@/app/api/cron/billing/route";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/25318162590";
const ATTEMPT_GID = "gid://shopify/SubscriptionBillingAttempt/9001";
const HOUR_MS = 60 * 60 * 1000;

const BILLING_DATE = "2026-04-19T00:00:00.000Z";
const NOW = new Date("2026-07-12T03:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(new Date(BILLING_DATE).getTime() + offsetMs).toISOString();
}

function failure(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/f-${createdAt}`,
    createdAt,
    ready: false,
    errorCode: "PAYMENT_METHOD_DECLINED",
    errorMessage: "The card was declined",
  };
}

/** 上限到達済み = この run で PAUSE + 最終督促メールに入る形。 */
const MAX_FAILURES = [failure(iso(HOUR_MS)), failure(iso(25 * HOUR_MS)), failure(iso(49 * HOUR_MS))];

function request(): NextRequest {
  return new NextRequest("http://localhost/api/cron/billing", {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

type CronBody = {
  paused: number;
  failed: number;
  dunning_email_failed: number;
  results: { action: string; detail?: string }[];
};

async function runCron(): Promise<CronBody> {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()) as CronBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  advanceNextBillingDateMock.mockResolvedValue({
    action: "noop",
    from: null,
    to: null,
    reason: "test default",
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([
    { id: CONTRACT_GID, nextBillingDate: BILLING_DATE },
  ]);
  getBillingAttemptsMock.mockResolvedValue(MAX_FAILURES);
  getBillingCycleResetAtMock.mockResolvedValue(null);
  getSubscriptionContractMock.mockResolvedValue({
    id: CONTRACT_GID,
    customer: { email: "customer@example.test", displayName: "Test Customer" },
    lines: [
      {
        title: "Tea Subscription",
        quantity: 1,
        currentPrice: { amount: "3000", currencyCode: "JPY" },
      },
    ],
  });
  sendDunningEmailMock.mockResolvedValue({ success: true });
  updateSubscriptionContractMock.mockResolvedValue({
    id: CONTRACT_GID,
    status: "PAUSED",
  });
  createBillingAttemptMock.mockResolvedValue({
    id: ATTEMPT_GID,
    ready: true,
    errorCode: null,
    errorMessage: null,
  });
  notifyBillingRunFailuresMock.mockResolvedValue(undefined);
  notifySubscriptionPausedMock.mockResolvedValue(undefined);
  notifyBillingCronFatalMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("最終督促メール (PAUSE 時) が送れなかった場合", () => {
  beforeEach(() => {
    sendDunningEmailMock.mockResolvedValue({
      success: false,
      error: "Resend rate limit exceeded",
    });
  });

  it("Sentry に error として上がる (是正前は console だけで沈黙した)", async () => {
    await runCron();

    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Billing Cron] Dunning email not sent",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          contractId: CONTRACT_GID,
          isFinalAttempt: true,
          reason: "Resend rate limit exceeded",
        }),
      })
    );
  });

  it("summary の dunning_email_failed に計上し、detail にも書く", async () => {
    const body = await runCron();

    expect(body.dunning_email_failed).toBe(1);
    expect(body.results[0]!.detail).toContain("final dunning email not sent");
    expect(body.results[0]!.detail).toContain("Resend rate limit exceeded");
  });

  it("運営宛の停止通知に「顧客へ届いていない」ことを渡す", async () => {
    await runCron();

    expect(notifySubscriptionPausedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: CONTRACT_GID,
        customerNotified: false,
      })
    );
  });

  it("契約の停止そのものは成功として申告する (メール失敗で課金申告を壊さない)", async () => {
    const body = await runCron();

    expect(body.paused).toBe(1);
    expect(body.results[0]!.action).toBe("paused");
    expect(updateSubscriptionContractMock).toHaveBeenCalledWith(CONTRACT_GID, {
      status: "PAUSED",
    });
  });
});

describe("送れなかった他の経路も同じ扱いにする", () => {
  it("送信が例外で落ちた場合", async () => {
    sendDunningEmailMock.mockRejectedValue(new Error("network down"));

    const body = await runCron();

    expect(captureExceptionMock).toHaveBeenCalled();
    expect(body.dunning_email_failed).toBe(1);
    expect(notifySubscriptionPausedMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerNotified: false })
    );
  });

  it("宛先メールが無い契約", async () => {
    getSubscriptionContractMock.mockResolvedValue({
      id: CONTRACT_GID,
      customer: { email: null, displayName: "Test Customer" },
      lines: [],
    });

    const body = await runCron();

    expect(sendDunningEmailMock).not.toHaveBeenCalled();
    expect(body.dunning_email_failed).toBe(1);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Billing Cron] Dunning email not sent",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({ reason: "no customer email" }),
      })
    );
    expect(notifySubscriptionPausedMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerNotified: false })
    );
  });
});

describe("課金失敗 (PAUSE 前) の督促メールが送れなかった場合", () => {
  it("failed の申告は保ったまま、メール不着を別軸で計上する", async () => {
    getBillingAttemptsMock.mockResolvedValue([]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });
    sendDunningEmailMock.mockResolvedValue({
      success: false,
      error: "domain not verified",
    });

    const body = await runCron();

    expect(body.failed).toBe(1);
    expect(body.dunning_email_failed).toBe(1);
    expect(body.results[0]!.detail).toContain("dunning email not sent");
    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Billing Cron] Dunning email not sent",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({ isFinalAttempt: false }),
      })
    );
  });
});

describe("送れているときに false positive を出さない", () => {
  it("success: true なら計上せず、停止通知は「送信済み」で渡る", async () => {
    const body = await runCron();

    expect(body.dunning_email_failed).toBe(0);
    expect(body.results[0]!.detail).toBe("Contract paused after max retries");
    expect(captureMessageMock).not.toHaveBeenCalledWith(
      "[Billing Cron] Dunning email not sent",
      expect.anything()
    );
    expect(notifySubscriptionPausedMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerNotified: true })
    );
  });
});

/**
 * Tests for 「停止 → 顧客が支払い方法を更新して再開」後の課金 cron の挙動
 * (シナリオ S8-1 / S8-5 / S8-6)。
 *
 * 是正前の欠陥 (2026-08-11 の失敗系監査 High-1):
 *   課金 3 回失敗で自動停止した契約は `nextBillingDate` が前進しないまま失敗履歴を
 *   抱える。顧客がカードを更新して再開 (ACTIVE 復帰) しても、翌日の cron は同じ周期を
 *   見て `failureCount >= MAX_RETRY_ATTEMPTS` と判定し、**新しい課金を 1 度も試さずに**
 *   再び PAUSED + 最終督促メールを送り直した (無限再停止)。督促メール文面の
 *   「お支払い方法を更新後、マイページから再開していただけます」が機能しない誤案内。
 *
 * この仕様が守るべき契約:
 *   1. 再開後は、必ず**新しい課金試行が 1 回走ってから**でないと停止しない。
 *   2. 再開後の課金鍵は停止前と別物 (同じ鍵だと Shopify の重複判定で課金が作られない)。
 *   3. 同じ日に cron が二重発火したら鍵は一致する (= 二重課金しない) ままである。
 *   4. リセットは周期の内側にあるときだけ効く。前の周期の古いマーカーは無視する。
 *   5. リセットが無い / 読めない契約は従来どおり (課金を足さない側 = 停止) に倒す。
 *   6. 再開後にもう一度上限まで失敗したら、正当に停止する (ガードは緩めない)。
 *
 * Shopify Admin・督促メール・LINE 監視通知・Firestore はすべて mock。**実送信しない**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { analyzeBillingCycle, CYCLE_GRACE_HOURS } from "@/lib/shopify/billing-dunning";

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
const DAY_MS = 24 * HOUR_MS;

/** 請求日 04-19 / 現在 07-12。停止前の失敗はすべて 04 月にある。 */
const BILLING_DATE = "2026-04-19T00:00:00.000Z";
const NOW = new Date("2026-07-12T03:00:00.000Z");
/** 顧客がカードを更新して再開した時刻 (失敗より後・現在より前)。 */
const RESUMED_AT = new Date("2026-06-18T09:00:00.000Z");

function iso(base: string, offsetMs: number): string {
  return new Date(new Date(base).getTime() + offsetMs).toISOString();
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

function completed(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/ok-${createdAt}`,
    createdAt,
    ready: true,
    errorCode: null,
    errorMessage: null,
  };
}

/** 停止に至った 3 件の失敗 (請求日直後)。 */
const PRE_PAUSE_FAILURES = [
  failure(iso(BILLING_DATE, 1 * HOUR_MS)),
  failure(iso(BILLING_DATE, 25 * HOUR_MS)),
  failure(iso(BILLING_DATE, 49 * HOUR_MS)),
];

function request(secret: string = CRON_SECRET): NextRequest {
  return new NextRequest("http://localhost/api/cron/billing", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

type CronBody = {
  due: number;
  billed: number;
  paused: number;
  failed: number;
  skipped: number;
  dunning_email_failed: number;
  results: {
    contractId: string;
    action: string;
    attemptNumber?: number;
    detail?: string;
  }[];
};

async function runCron(): Promise<CronBody> {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()) as CronBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([
    { id: CONTRACT_GID, nextBillingDate: BILLING_DATE },
  ]);
  getBillingAttemptsMock.mockResolvedValue([]);
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
  createBillingAttemptMock.mockResolvedValue({
    id: ATTEMPT_GID,
    ready: true,
    errorCode: null,
    errorMessage: null,
  });
  updateSubscriptionContractMock.mockResolvedValue({
    id: CONTRACT_GID,
    status: "PAUSED",
  });
  notifyBillingRunFailuresMock.mockResolvedValue(undefined);
  notifySubscriptionPausedMock.mockResolvedValue(undefined);
  notifyBillingCronFatalMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 判定そのもの (純関数) ─────────────────────────────────────────

describe("analyzeBillingCycle: 再開による周期リセット", () => {
  it("リセットより前の失敗は数えない (再開後は 0 件から数え直す)", () => {
    const state = analyzeBillingCycle(PRE_PAUSE_FAILURES, BILLING_DATE, {
      cycleResetAt: RESUMED_AT,
    });

    expect(state.failureCount).toBe(0);
    expect(state.lastFailureAt).toBeNull();
    expect(state.cycleResetAt?.toISOString()).toBe(RESUMED_AT.toISOString());
  });

  it("リセット後の失敗は数える (再開しても青天井にはしない)", () => {
    const state = analyzeBillingCycle(
      [...PRE_PAUSE_FAILURES, failure(new Date(RESUMED_AT.getTime() + HOUR_MS).toISOString())],
      BILLING_DATE,
      { cycleResetAt: RESUMED_AT }
    );

    expect(state.failureCount).toBe(1);
  });

  it("リセット後に課金が完了していれば completedAt として拾う (二重課金しない)", () => {
    const chargedAt = new Date(RESUMED_AT.getTime() + 2 * HOUR_MS).toISOString();
    const state = analyzeBillingCycle(
      [...PRE_PAUSE_FAILURES, completed(chargedAt)],
      BILLING_DATE,
      { cycleResetAt: RESUMED_AT }
    );

    expect(state.completedAt?.toISOString()).toBe(chargedAt);
  });

  it("周期の外 (grace より前) のリセットは無視する", () => {
    const stale = new Date(
      new Date(BILLING_DATE).getTime() - (CYCLE_GRACE_HOURS + 1) * HOUR_MS
    );

    const state = analyzeBillingCycle(PRE_PAUSE_FAILURES, BILLING_DATE, {
      cycleResetAt: stale,
    });

    expect(state.cycleResetAt).toBeNull();
    expect(state.failureCount).toBe(3);
  });

  it("リセットを渡さなければ従来どおり (失敗 3 件のまま)", () => {
    const state = analyzeBillingCycle(PRE_PAUSE_FAILURES, BILLING_DATE);

    expect(state.failureCount).toBe(3);
    expect(state.cycleResetAt).toBeNull();
  });
});

// ─── route の挙動 (S8-1 / S8-5 / S8-6) ─────────────────────────────

describe("S8-1: 停止 → 再開後の cron (是正前は即再停止していた)", () => {
  beforeEach(() => {
    getBillingAttemptsMock.mockResolvedValue(PRE_PAUSE_FAILURES);
    getBillingCycleResetAtMock.mockResolvedValue(RESUMED_AT);
  });

  it("新しい課金試行を 1 回作る (再停止しない・最終督促メールを送り直さない)", async () => {
    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "billed", attemptNumber: 1 });
    expect(body.paused).toBe(0);
    expect(createBillingAttemptMock).toHaveBeenCalledTimes(1);
    // 契約を止めない
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
    // 顧客に最終案内を送り直さない
    expect(sendDunningEmailMock).not.toHaveBeenCalled();
    expect(notifySubscriptionPausedMock).not.toHaveBeenCalled();
  });

  it("課金鍵に再開時刻を混ぜる (停止前の attempt1 と同じ鍵にしない)", async () => {
    await runCron();

    const key = createBillingAttemptMock.mock.calls[0]![1] as string;
    expect(key).toBe(
      `${CONTRACT_GID}-${BILLING_DATE}-reset${RESUMED_AT.getTime()}-attempt1`
    );
    expect(key).not.toBe(`${CONTRACT_GID}-${BILLING_DATE}-attempt1`);
  });

  it("同じ日に cron が二重発火しても鍵は同一 (Shopify 側で二重課金を拒否できる)", async () => {
    await runCron();
    await runCron();

    const [first, second] = createBillingAttemptMock.mock.calls.map(
      (call) => call[1] as string
    );
    expect(second).toBe(first);
  });

  it("再開後の課金が失敗したら 1 回目の失敗として扱う (いきなり停止しない)", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "failed", attemptNumber: 1 });
    expect(body.paused).toBe(0);
    expect(updateSubscriptionContractMock).not.toHaveBeenCalled();
    // 督促は「1 回目」であって最終通知ではない
    expect(sendDunningEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ isFinalAttempt: false, attemptNumber: 1 })
    );
  });
});

describe("S8-5: 再開しても防御は緩めない", () => {
  it("再開マーカーが無ければ従来どおり停止する (課金を足す側に倒さない)", async () => {
    getBillingAttemptsMock.mockResolvedValue(PRE_PAUSE_FAILURES);
    getBillingCycleResetAtMock.mockResolvedValue(null);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "paused" });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("再開後にもう一度上限まで失敗したら正当に停止する", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      ...PRE_PAUSE_FAILURES,
      failure(new Date(RESUMED_AT.getTime() + 1 * HOUR_MS).toISOString()),
      failure(new Date(RESUMED_AT.getTime() + 25 * HOUR_MS).toISOString()),
      failure(new Date(RESUMED_AT.getTime() + 49 * HOUR_MS).toISOString()),
    ]);
    getBillingCycleResetAtMock.mockResolvedValue(RESUMED_AT);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "paused" });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
    expect(sendDunningEmailMock).toHaveBeenCalledTimes(1);
    expect(sendDunningEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ isFinalAttempt: true })
    );
  });

  it("再開後に課金が完了していれば二重課金しない", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      ...PRE_PAUSE_FAILURES,
      completed(new Date(RESUMED_AT.getTime() + 2 * HOUR_MS).toISOString()),
    ]);
    getBillingCycleResetAtMock.mockResolvedValue(RESUMED_AT);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    expect(body.results[0]!.detail).toContain("Already charged");
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

describe("S8-6: 古い再開マーカーは次の周期の判定を歪めない", () => {
  it("前の周期に置かれたマーカーは無視して従来判定になる", async () => {
    getBillingAttemptsMock.mockResolvedValue(PRE_PAUSE_FAILURES);
    getBillingCycleResetAtMock.mockResolvedValue(
      new Date(new Date(BILLING_DATE).getTime() - 30 * DAY_MS)
    );

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "paused" });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("マーカーが無い通常契約の課金鍵は従来の形のまま", async () => {
    getBillingAttemptsMock.mockResolvedValue([]);
    getBillingCycleResetAtMock.mockResolvedValue(null);

    await runCron();

    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      CONTRACT_GID,
      `${CONTRACT_GID}-${BILLING_DATE}-attempt1`
    );
  });
});

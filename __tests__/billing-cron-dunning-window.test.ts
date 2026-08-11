/**
 * Tests for 督促 (dunning) の判定窓 — `lib/shopify/billing-dunning.ts` と
 * それを使う GET /api/cron/billing.
 *
 * 是正前の欠陥 (2026-08-11 の決済失敗調査で判明):
 *   失敗の集計窓が `nextBillingDate -24h 〜 +96h` に固定されていた。**課金が失敗した
 *   契約の `nextBillingDate` は前進しない**ため、請求日から 96h を過ぎた契約は窓の外に
 *   落ち、失敗履歴が何件あっても `failureCount` が常に 0 と評価された。結果:
 *     - `MAX_RETRY_ATTEMPTS` に永久に到達せず契約が一時停止されない
 *     - 毎日「初回試行」として再課金され、督促メールが無限に送られる
 *   実例: 契約 25318162590 (請求日 04-19 に対し 07-12 にも試行)。
 *
 * この仕様が守るべき契約:
 *   1. 窓に上限は無い。請求日から何日経っていても、この周期の失敗は数え落とさない。
 *   2. 下限 (grace 24h) は残す。前の周期の失敗を今の周期に持ち込まない。
 *   3. 上限到達で確実に一時停止 (PAUSED) に入り、再課金も督促メールもそこで止まる。
 *   4. 判断がつかないときは課金しない側に倒す (完了済み / 結果待ち / 時刻不明)。
 *
 * Shopify Admin・督促メール・LINE 監視通知はすべて mock。**実送信は行わない**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  analyzeBillingCycle,
  isReadyForRetry,
  isStaleInFlight,
  CYCLE_GRACE_HOURS,
  MAX_RETRY_ATTEMPTS,
  RETRY_INTERVAL_HOURS,
  STALE_IN_FLIGHT_HOURS,
} from "@/lib/shopify/billing-dunning";

const CRON_SECRET = "cron-secret-for-tests";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-for-tests";
});

// --- module mocks（route が import するもの） -------------------------------
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

// 外部送信は一切させない (LINE 監視通知も mock で塞ぐ)
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

/** 実例に合わせた固定時刻。請求日 04-19 / 現在 07-12 (84 日後)。 */
const BILLING_DATE = "2026-04-19T00:00:00.000Z";
const NOW = new Date("2026-07-12T03:00:00.000Z");

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

function inFlight(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/wip-${createdAt}`,
    createdAt,
    ready: false,
    errorCode: null,
    errorMessage: null,
  };
}

// ─── 判定そのもの (純関数) ──────────────────────────────────────────

describe("analyzeBillingCycle: 失敗の集計窓", () => {
  it("請求日から 96h を大きく超えた失敗も数える（是正前は 0 件と評価された）", () => {
    // 84 日前の請求日に対し、直後 2 件 + 80 日後 1 件。旧実装の上限 (+96h) では
    // 80 日後の失敗が窓から落ち、failureCount が上限に届かなかった。
    const attempts = [
      failure(iso(BILLING_DATE, 1 * HOUR_MS)),
      failure(iso(BILLING_DATE, 25 * HOUR_MS)),
      failure(iso(BILLING_DATE, 80 * DAY_MS)),
    ];

    const state = analyzeBillingCycle(attempts, BILLING_DATE);

    expect(state.failureCount).toBe(3);
    expect(state.failureCount).toBeGreaterThanOrEqual(MAX_RETRY_ATTEMPTS);
    expect(state.lastFailureAt?.toISOString()).toBe(iso(BILLING_DATE, 80 * DAY_MS));
  });

  it("窓に上限が無いこと: 1 年後の失敗でも数える", () => {
    const state = analyzeBillingCycle(
      [failure(iso(BILLING_DATE, 365 * DAY_MS))],
      BILLING_DATE
    );

    expect(state.failureCount).toBe(1);
  });

  it("前の周期の失敗は数えない（grace より前は対象外）", () => {
    const state = analyzeBillingCycle(
      [failure(iso(BILLING_DATE, -48 * HOUR_MS))],
      BILLING_DATE
    );

    expect(state.failureCount).toBe(0);
    expect(state.lastFailureAt).toBeNull();
  });

  it("grace の境界は含む / 1ms でも前なら含まない", () => {
    const onBoundary = analyzeBillingCycle(
      [failure(iso(BILLING_DATE, -CYCLE_GRACE_HOURS * HOUR_MS))],
      BILLING_DATE
    );
    const justBefore = analyzeBillingCycle(
      [failure(iso(BILLING_DATE, -CYCLE_GRACE_HOURS * HOUR_MS - 1))],
      BILLING_DATE
    );

    expect(onBoundary.failureCount).toBe(1);
    expect(justBefore.failureCount).toBe(0);
  });

  it("成功 (errorCode なし & ready) は completedAt として拾い、失敗に数えない", () => {
    const state = analyzeBillingCycle(
      [failure(iso(BILLING_DATE, 1 * HOUR_MS)), completed(iso(BILLING_DATE, 2 * HOUR_MS))],
      BILLING_DATE
    );

    expect(state.failureCount).toBe(1);
    expect(state.completedAt?.toISOString()).toBe(iso(BILLING_DATE, 2 * HOUR_MS));
    expect(state.inFlightAt).toBeNull();
  });

  it("結果待ち (errorCode なし & ready でない) は inFlightAt として拾う", () => {
    const state = analyzeBillingCycle(
      [inFlight(iso(BILLING_DATE, 1 * HOUR_MS))],
      BILLING_DATE
    );

    expect(state.failureCount).toBe(0);
    expect(state.completedAt).toBeNull();
    expect(state.inFlightAt?.toISOString()).toBe(iso(BILLING_DATE, 1 * HOUR_MS));
  });

  it("請求日が読めなければ billingDateValid=false （判定不能）", () => {
    const state = analyzeBillingCycle([failure(iso(BILLING_DATE, 0))], "not-a-date");

    expect(state.billingDateValid).toBe(false);
    expect(state.failureCount).toBe(0);
  });

  it("createdAt が読めない失敗は数える（数え落として再課金しない側に倒す）", () => {
    const state = analyzeBillingCycle([failure("garbage")], BILLING_DATE);

    expect(state.failureCount).toBe(1);
    expect(state.lastFailureAt).toBeNull();
  });
});

describe("isReadyForRetry / isStaleInFlight の境界", () => {
  it(`ちょうど ${RETRY_INTERVAL_HOURS}h でリトライ可、1ms 手前は不可`, () => {
    const last = new Date(NOW.getTime() - RETRY_INTERVAL_HOURS * HOUR_MS);
    const justShort = new Date(NOW.getTime() - RETRY_INTERVAL_HOURS * HOUR_MS + 1);

    expect(isReadyForRetry(last, NOW)).toBe(true);
    expect(isReadyForRetry(justShort, NOW)).toBe(false);
  });

  it(`結果待ちが ${STALE_IN_FLIGHT_HOURS}h を超えたら滞留と見なす`, () => {
    const stale = new Date(NOW.getTime() - STALE_IN_FLIGHT_HOURS * HOUR_MS);
    const fresh = new Date(NOW.getTime() - 1 * HOUR_MS);

    expect(isStaleInFlight(stale, NOW)).toBe(true);
    expect(isStaleInFlight(fresh, NOW)).toBe(false);
  });
});

// ─── route の挙動 ─────────────────────────────────────────────────

function request(secret: string = CRON_SECRET): NextRequest {
  return new NextRequest("http://localhost/api/cron/billing", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

type CronBody = {
  checked: number;
  due: number;
  billed: number;
  retried: number;
  pending: number;
  failed: number;
  retry_failed: number;
  paused: number;
  waiting: number;
  skipped: number;
  errors: number;
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
  sendDunningEmailMock.mockResolvedValue(undefined);
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

describe("請求日から 96h を超えた契約 (実例 25318162590 の形)", () => {
  it("上限到達済みなら再課金せず PAUSED にする（是正前は毎日再課金していた）", async () => {
    // 請求日 04-19 の直後に 3 回失敗し、現在は 07-12。
    getBillingAttemptsMock.mockResolvedValue([
      failure(iso(BILLING_DATE, 1 * HOUR_MS)),
      failure(iso(BILLING_DATE, 25 * HOUR_MS)),
      failure(iso(BILLING_DATE, 49 * HOUR_MS)),
    ]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      contractId: CONTRACT_GID,
      action: "paused",
    });
    expect(body.paused).toBe(1);
    expect(body.billed).toBe(0);
    expect(body.failed).toBe(0);
    // 再課金しない
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
    // 契約は止まる
    expect(updateSubscriptionContractMock).toHaveBeenCalledWith(CONTRACT_GID, {
      status: "PAUSED",
    });
    // 督促メールは最終通知の 1 通だけ (無限送信しない)
    expect(sendDunningEmailMock).toHaveBeenCalledTimes(1);
    expect(sendDunningEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ isFinalAttempt: true })
    );
  });

  it("バグで積み上がった大量の失敗も 1 回の PAUSE で収束する", async () => {
    // 是正前の毎日再課金で 04-19 以降に 80 件の失敗が残っている状態。
    const attempts = Array.from({ length: 80 }, (_, i) =>
      failure(iso(BILLING_DATE, i * DAY_MS))
    );
    getBillingAttemptsMock.mockResolvedValue(attempts);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "paused" });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
    expect(updateSubscriptionContractMock).toHaveBeenCalledTimes(1);
    expect(sendDunningEmailMock).toHaveBeenCalledTimes(1);
  });

  it("失敗 1 件だけなら初回試行に戻らず attempt 2 としてリトライする", async () => {
    // 是正前は窓の外なので failureCount=0 → 毎日「初回試行」として課金していた。
    getBillingAttemptsMock.mockResolvedValue([failure(iso(BILLING_DATE, 1 * HOUR_MS))]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "retry_failed",
      attemptNumber: 2,
    });
    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      CONTRACT_GID,
      `${CONTRACT_GID}-${BILLING_DATE}-attempt2`
    );
  });
});

describe("課金しない側に倒すケース", () => {
  it("この周期の課金が完了していれば二重課金しない", async () => {
    getBillingAttemptsMock.mockResolvedValue([completed(iso(BILLING_DATE, 1 * HOUR_MS))]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    expect(body.results[0]!.detail).toContain("Already charged");
    expect(body.skipped).toBe(1);
    expect(body.billed).toBe(0);
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
    expect(sendDunningEmailMock).not.toHaveBeenCalled();
  });

  it("試行が結果待ちなら課金せず、滞留が長ければ運営に上げる", async () => {
    getBillingAttemptsMock.mockResolvedValue([inFlight(iso(BILLING_DATE, 1 * HOUR_MS))]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    expect(body.results[0]!.detail).toContain("still processing");
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
    // 84 日放置されているので滞留として記録される
    expect(captureMessageMock).toHaveBeenCalledWith(
      "[Billing Cron] Billing attempt stuck in flight",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("結果待ちが新しければ滞留通知は出さない", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      inFlight(new Date(NOW.getTime() - 1 * HOUR_MS).toISOString()),
    ]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("失敗はあるが時刻が読めなければ課金しない", async () => {
    getBillingAttemptsMock.mockResolvedValue([failure("garbage")]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped", attemptNumber: 1 });
    expect(body.results[0]!.detail).toContain("Cannot determine retry timing");
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

describe("正常系が壊れていないこと", () => {
  it("この周期に試行が無ければ初回課金する", async () => {
    getBillingAttemptsMock.mockResolvedValue([]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "billed", attemptNumber: 1 });
    expect(createBillingAttemptMock).toHaveBeenCalledWith(
      CONTRACT_GID,
      `${CONTRACT_GID}-${BILLING_DATE}-attempt1`
    );
  });

  it("前の周期の失敗は持ち込まず、初回試行として扱う", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      failure(iso(BILLING_DATE, -30 * DAY_MS)),
      failure(iso(BILLING_DATE, -29 * DAY_MS)),
      failure(iso(BILLING_DATE, -28 * DAY_MS)),
    ]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    // 前周期の失敗 3 件で PAUSE してはいけない (誤停止)
    expect(body.paused).toBe(0);
    expect(body.results[0]).toMatchObject({ action: "billed", attemptNumber: 1 });
  });

  it("リトライ間隔が未経過なら課金せず waiting", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      failure(new Date(NOW.getTime() - 1 * HOUR_MS).toISOString()),
    ]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "waiting", attemptNumber: 1 });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

/**
 * Tests for GET /api/cron/billing の `action` 判定（成否の申告を実態に合わせる）.
 *
 * この route が守るべき契約:
 *   1. 課金試行が errorCode を返したら action は **失敗として申告する**
 *      (初回 = "failed" / リトライ = "retry_failed")。旧実装は失敗でも
 *      "billed" / "retried" を返し、失敗は detail にしか出なかったため、
 *      action と summary.billed を見る監視には「成功した run」に見えていた。
 *   2. errorCode なし & ready=true のときだけ "billed" / "retried"。
 *   3. errorCode なし & ready=false は Shopify が試行を受理しただけで
 *      課金完了ではないので "pending"。billed には数えない
 *      (確定結果は subscription_billing_attempts/success|failure webhook)。
 *   4. summary は action ごとの実数を返し、失敗が billed に混ざらない。
 *   5. 既存の督促フロー (retry 間隔待ち → "waiting"、上限超過 → "paused") は
 *      この変更で壊れない。
 *
 * Shopify Admin / 督促メールは mock。**メールの実送信は行わない**
 * (sendDunningEmail は呼ばれたことだけを観測する)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from "@/app/api/cron/billing/route";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/7001";
const ATTEMPT_GID = "gid://shopify/SubscriptionBillingAttempt/9001";

/** 24 時間以上前 = 課金対象。現在時刻依存を避けるため相対で作る。 */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function dueContract() {
  return { id: CONTRACT_GID, nextBillingDate: hoursAgo(2) };
}

function failedAttempt(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/${createdAt}`,
    createdAt,
    ready: false,
    errorCode: "PAYMENT_METHOD_DECLINED",
    errorMessage: "The card was declined",
  };
}

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
  results: { contractId: string; action: string; attemptNumber?: number; detail?: string }[];
};

async function runCron(): Promise<CronBody> {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()) as CronBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([dueContract()]);
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
});

describe("課金試行が失敗したときの action", () => {
  it("初回試行が errorCode を返したら action=failed（billed に数えない）", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      contractId: CONTRACT_GID,
      action: "failed",
      attemptNumber: 1,
    });
    expect(body.results[0]!.detail).toContain("Failed");
    expect(body.failed).toBe(1);
    expect(body.billed).toBe(0);
    expect(body.retried).toBe(0);
    // 督促通知は従来どおり送られる（実送信は mock）
    expect(sendDunningEmailMock).toHaveBeenCalledTimes(1);
  });

  it("リトライ試行が errorCode を返したら action=retry_failed（retried に数えない）", async () => {
    // 25 時間前に 1 件失敗 → retry 間隔を満たすのでこの run でリトライされる
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(25))]);
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
    expect(body.retry_failed).toBe(1);
    expect(body.retried).toBe(0);
    expect(body.billed).toBe(0);
  });
});

describe("課金試行が成功／未確定のときの action", () => {
  it("errorCode なし & ready=true なら action=billed", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "billed",
      attemptNumber: 1,
      detail: "Success",
    });
    expect(body.billed).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.pending).toBe(0);
    expect(sendDunningEmailMock).not.toHaveBeenCalled();
  });

  it("リトライが errorCode なし & ready=true なら action=retried", async () => {
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(25))]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "retried",
      attemptNumber: 2,
      detail: "Success",
    });
    expect(body.retried).toBe(1);
    expect(body.billed).toBe(0);
  });

  it("errorCode なし & ready=false は billed ではなく pending", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "pending",
      attemptNumber: 1,
    });
    expect(body.pending).toBe(1);
    expect(body.billed).toBe(0);
    expect(sendDunningEmailMock).not.toHaveBeenCalled();
  });
});

describe("既存の督促フローが壊れていないこと", () => {
  it("retry 間隔が未経過なら課金せず action=waiting", async () => {
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(1))]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "waiting" });
    expect(body.waiting).toBe(1);
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("失敗が上限に達していたら契約を PAUSED にして action=paused", async () => {
    // 3 件とも countRecentFailures の集計窓 (課金日の -24h 〜 +96h) の内側に置く
    getBillingAttemptsMock.mockResolvedValue([
      failedAttempt(hoursAgo(1)),
      failedAttempt(hoursAgo(10)),
      failedAttempt(hoursAgo(20)),
    ]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "paused" });
    expect(body.paused).toBe(1);
    expect(updateSubscriptionContractMock).toHaveBeenCalledWith(CONTRACT_GID, {
      status: "PAUSED",
    });
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("課金日が無い契約は課金対象から外れ、課金を試行しない", async () => {
    getSubscriptionContractsMock.mockResolvedValue([
      { id: CONTRACT_GID, nextBillingDate: null },
    ]);

    const body = await runCron();

    // nextBillingDate が無い契約は due 抽出の段階で外れる
    expect(body.checked).toBe(1);
    expect(body.billed).toBe(0);
    expect(body.results).toEqual([]);
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

describe("認可", () => {
  it("CRON_SECRET が違えば 401 で Shopify を一切呼ばない", async () => {
    const res = await GET(request("wrong-secret-value--------"));

    expect(res.status).toBe(401);
    expect(getSubscriptionContractsMock).not.toHaveBeenCalled();
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });
});

/**
 * Tests for GET /api/cron/billing の**運営宛 LINE 監視通知の配線**.
 *
 * `sendLineNotify` は 2026-08 時点で呼び出し元が 0 件（= 本番 env を入れても何も
 * 届かない）だった。ここで検証するのは「どの状況で通知が出て、どの状況で出ないか」。
 *
 * 契約:
 *   1. 失敗が 0 件の run では 1 通も送らない（正常時に通知を出さない）。
 *   2. failed / retry_failed / error が出た run では **run 単位で 1 通だけ**送る。
 *      契約が複数失敗しても 1 通に集約する。
 *   3. 契約が PAUSE 遷移したら、その契約について個別に 1 通送る。
 *      PAUSE だけの run では run 集約の通知は出さない（二重通知にしない）。
 *   4. cron が最後まで走れず 500 になる場合も 1 通送る。
 *   5. 通知の送出が失敗しても cron の応答は変わらない（通知が本処理を壊さない）。
 *
 * Shopify Admin / 督促メール / LINE 送出はすべて mock。**実送信はしない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  createBillingAttempt: (...args: unknown[]) => createBillingAttemptMock(...args),
  getBillingAttempts: (...args: unknown[]) => getBillingAttemptsMock(...args),
  updateSubscriptionContract: (...args: unknown[]) =>
    updateSubscriptionContractMock(...args),
}));

const sendDunningEmailMock = vi.fn();
vi.mock("@/lib/email/dunning", () => ({
  sendDunningEmail: (...args: unknown[]) => sendDunningEmailMock(...args),
}));

// nextBillingDate の前進は Shopify Admin を叩くので mock する。ここでは「呼ばれた/
// 呼ばれない」の配線だけが関心事で、前進そのものの検証は
// __tests__/next-billing-date.test.ts と __tests__/billing-advance-wiring.test.ts が持つ。
const advanceNextBillingDateMock = vi.fn();
vi.mock("@/lib/shopify/next-billing-date", () => ({
  advanceNextBillingDate: (...args: unknown[]) =>
    advanceNextBillingDateMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// 通知の「呼ばれた/呼ばれない」を観測する。文面自体は
// __tests__/line-monitoring-alerts.test.ts の担当。
const notifyBillingRunFailuresMock = vi.fn();
const notifyBillingCronFatalMock = vi.fn();
const notifySubscriptionPausedMock = vi.fn();
vi.mock("@/lib/line/monitoring-alerts", () => ({
  notifyBillingRunFailures: (...args: unknown[]) =>
    notifyBillingRunFailuresMock(...args),
  notifyBillingCronFatal: (...args: unknown[]) =>
    notifyBillingCronFatalMock(...args),
  notifySubscriptionPaused: (...args: unknown[]) =>
    notifySubscriptionPausedMock(...args),
}));

import { GET } from "@/app/api/cron/billing/route";

const CONTRACT_A = "gid://shopify/SubscriptionContract/7001";
const CONTRACT_B = "gid://shopify/SubscriptionContract/7002";
const ATTEMPT_GID = "gid://shopify/SubscriptionBillingAttempt/9001";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function dueContract(id: string) {
  return { id, nextBillingDate: hoursAgo(2) };
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

beforeEach(() => {
  vi.clearAllMocks();
  advanceNextBillingDateMock.mockResolvedValue({
    action: "noop",
    from: null,
    to: null,
    reason: "test default",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([dueContract(CONTRACT_A)]);
  getBillingAttemptsMock.mockResolvedValue([]);
  getSubscriptionContractMock.mockResolvedValue({
    id: CONTRACT_A,
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
    id: CONTRACT_A,
    status: "PAUSED",
  });
  notifyBillingRunFailuresMock.mockResolvedValue(undefined);
  notifyBillingCronFatalMock.mockResolvedValue(undefined);
  notifySubscriptionPausedMock.mockResolvedValue(undefined);
});

describe("通知を出さない run", () => {
  it("課金が全件成功したら 1 通も送らない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
    expect(notifyBillingCronFatalMock).not.toHaveBeenCalled();
    expect(notifySubscriptionPausedMock).not.toHaveBeenCalled();
  });

  it("結果が pending（Shopify が受理しただけ）でも送らない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: null,
      errorMessage: null,
    });

    await GET(request());

    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("課金対象が 0 件なら送らない", async () => {
    getSubscriptionContractsMock.mockResolvedValue([
      { id: CONTRACT_A, nextBillingDate: null },
    ]);

    await GET(request());

    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("retry 間隔待ち（waiting）だけの run では送らない", async () => {
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(1))]);

    await GET(request());

    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("認可が通らなければ何も送らない", async () => {
    const res = await GET(request("wrong-secret-value--------"));

    expect(res.status).toBe(401);
    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
    expect(notifyBillingCronFatalMock).not.toHaveBeenCalled();
  });
});

describe("失敗が出た run", () => {
  it("初回失敗で run 集約を 1 通、件数と契約 ID を渡す", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    await GET(request());

    expect(notifyBillingRunFailuresMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith({
      due: 1,
      failed: 1,
      retryFailed: 0,
      errors: 0,
      advanceFailed: 0,
      advanceBlocked: 0,
      advanceNoUnbilledCycle: 0,
      contractIds: [CONTRACT_A],
    });
  });

  it("再試行失敗も同じ経路で 1 通（retryFailed に入る）", async () => {
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(25))]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    await GET(request());

    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 0, retryFailed: 1 }),
    );
  });

  it("契約が 2 件失敗しても通知は 1 通に集約する", async () => {
    getSubscriptionContractsMock.mockResolvedValue([
      dueContract(CONTRACT_A),
      dueContract(CONTRACT_B),
    ]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    await GET(request());

    expect(notifyBillingRunFailuresMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith(
      expect.objectContaining({
        due: 2,
        failed: 2,
        contractIds: [CONTRACT_A, CONTRACT_B],
      }),
    );
  });

  it("契約処理中の例外（action=error）も run 集約に含める", async () => {
    getBillingAttemptsMock.mockRejectedValue(new Error("Admin API 503"));

    await GET(request());

    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith(
      expect.objectContaining({ errors: 1, contractIds: [CONTRACT_A] }),
    );
  });
});

describe("PAUSE 遷移", () => {
  const maxedOutAttempts = [
    failedAttempt(hoursAgo(1)),
    failedAttempt(hoursAgo(10)),
    failedAttempt(hoursAgo(20)),
  ];

  it("契約が PAUSE されたら個別に 1 通送る", async () => {
    getBillingAttemptsMock.mockResolvedValue(maxedOutAttempts);

    await GET(request());

    expect(notifySubscriptionPausedMock).toHaveBeenCalledTimes(1);
    // customerNotified は最終督促メールの実結果。ここでは送信成功のケース。
    expect(notifySubscriptionPausedMock).toHaveBeenCalledWith({
      contractId: CONTRACT_A,
      failureCount: 3,
      customerNotified: true,
    });
  });

  it("PAUSE だけの run では run 集約の通知を出さない（二重通知にしない）", async () => {
    getBillingAttemptsMock.mockResolvedValue(maxedOutAttempts);

    await GET(request());

    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("PAUSE 自体が失敗したら（action=error）PAUSE 通知は送らず run 集約に倒す", async () => {
    getBillingAttemptsMock.mockResolvedValue(maxedOutAttempts);
    updateSubscriptionContractMock.mockRejectedValue(new Error("pause rejected"));

    await GET(request());

    expect(notifySubscriptionPausedMock).not.toHaveBeenCalled();
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith(
      expect.objectContaining({ errors: 1 }),
    );
  });
});

describe("cron 自体が落ちたとき", () => {
  it("契約一覧の取得に失敗したら 1 通送り、応答は 500 のまま", async () => {
    getSubscriptionContractsMock.mockRejectedValue(new Error("Admin API 503"));

    const res = await GET(request());

    expect(res.status).toBe(500);
    expect(notifyBillingCronFatalMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingCronFatalMock).toHaveBeenCalledWith({
      message: "Admin API 503",
    });
    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("Error でない値が throw されても message を埋めて送る", async () => {
    getSubscriptionContractsMock.mockRejectedValue("string failure");

    await GET(request());

    expect(notifyBillingCronFatalMock).toHaveBeenCalledWith({
      message: "Unknown error",
    });
  });
});

describe("通知の失敗が本処理を壊さない", () => {
  it("PAUSE 通知が reject しても契約は paused と申告される", async () => {
    getBillingAttemptsMock.mockResolvedValue([
      failedAttempt(hoursAgo(1)),
      failedAttempt(hoursAgo(10)),
      failedAttempt(hoursAgo(20)),
    ]);
    notifySubscriptionPausedMock.mockRejectedValue(new Error("push exploded"));

    const res = await GET(request());
    const body = (await res.json()) as {
      paused: number;
      errors: number;
      results: { action: string }[];
    };

    expect(res.status).toBe(200);
    expect(body.results[0]!.action).toBe("paused");
    expect(body.paused).toBe(1);
    expect(body.errors).toBe(0);
  });

  it("run 集約の通知が reject しても 200 応答は変わらない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });
    // 実装 (monitoring-alerts) は例外を外に出さないが、route 側が通知の成否に
    // 依存していないことをここで独立に固定する。
    notifyBillingRunFailuresMock.mockRejectedValue(new Error("push exploded"));

    const res = await GET(request());

    // 通知の失敗は cron の失敗ではない: fatal 経路へ落ちて 500 にならないこと
    expect(res.status).toBe(200);
    expect(notifyBillingCronFatalMock).not.toHaveBeenCalled();
  });
});

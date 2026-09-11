/**
 * Tests for `nextBillingDate` の前進の**配線** (GET /api/cron/billing).
 *
 * 前進そのものの正しさ (導出規則・5 ガード) は `__tests__/next-billing-date.test.ts` が
 * 持つ。ここで固定するのは「いつ呼ぶ / いつ呼ばない / 失敗をどう申告するか」だけ。
 *
 * この層が守るべき契約:
 *
 *   1. **確定成功枝だけ**で前進させる (`billed` / `retried`)
 *   2. **`pending` では絶対に前進させない**。Shopify が受理しただけで課金の成否は
 *      未確定なので、ここで請求日を進めると失敗した周期を飛ばして未収を作る
 *   3. **Case 1 (この周期は既に課金済み = skipped) でも前進させる**。一度詰まった
 *      契約が自力で復旧できる唯一の口。ここを塞ぐと既存の停止契約が永久に残る
 *   4. 結果待ち (in-flight) の skipped では前進させない (2 と同じ理由)
 *   5. 前進が失敗しても課金の `action` を `error` に倒さない (金は動いている)
 *   6. ただし **`failed` を捨てない**。`advance_failed` に計上し、運営宛通知に載せ、
 *      課金の失敗が 0 件の run でも通知を出す (捨てると 2026-08 の無音停止が再発する)
 *   7. **`blocked_backward` / `no_unbilled_cycle` も捨てない** (2026-08-12 / QA 条件 1)。
 *      独立カウンタ `advance_blocked` / `advance_no_unbilled_cycle` に計上し通知の
 *      発火条件に含めるが、`advanceFailed` には数えない (別の軸・別の言葉で伝える)
 *   8. 無音停止の安全網: 課金完了から 1 周期 + 猶予を過ぎてまだ同じ請求日なら
 *      Sentry error を出す。過ぎていなければ出さない。**1 周期は契約の
 *      `billingPolicy` から出す** (2026-08-12 / QA 条件 2)
 *   9. summary の JSON キーは snake_case (`advance_failed` 等)
 *
 * Shopify Admin / 督促メール / LINE 送出 / 前進処理はすべて mock。**実送信・実 mutation
 * は行わない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

import {
  ADVANCE_STALL_GRACE_HOURS,
  ADVANCE_STALL_PERIOD_HOURS,
  INTERVAL_MAX_HOURS,
  advanceStallPeriodHours,
  isAdvanceStalled,
} from "@/lib/shopify/billing-dunning";

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

const advanceNextBillingDateMock = vi.fn();
vi.mock("@/lib/shopify/next-billing-date", () => ({
  advanceNextBillingDate: (...args: unknown[]) =>
    advanceNextBillingDateMock(...args),
}));

const sendDunningEmailMock = vi.fn();
vi.mock("@/lib/email/dunning", () => ({
  sendDunningEmail: (...args: unknown[]) => sendDunningEmailMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const notifyBillingRunFailuresMock = vi.fn();
const notifyBillingCronFatalMock = vi.fn();
vi.mock("@/lib/line/monitoring-alerts", () => ({
  notifyBillingRunFailures: (...args: unknown[]) =>
    notifyBillingRunFailuresMock(...args),
  notifyBillingCronFatal: (...args: unknown[]) =>
    notifyBillingCronFatalMock(...args),
  notifySubscriptionPaused: vi.fn(),
}));

import { GET } from "@/app/api/cron/billing/route";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/7001";
const ATTEMPT_GID = "gid://shopify/SubscriptionBillingAttempt/9001";

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function request(secret: string = CRON_SECRET): NextRequest {
  return new NextRequest("http://localhost/api/cron/billing", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

/**
 * summary の JSON キーは **snake_case** (既存の慣習: TS プロパティは camelCase、
 * summary キーは snake_case = `dunningEmailFailed` -> `dunning_email_failed`)。
 * `advanced` は 1 語なのでそのまま。
 */
type CronBody = {
  due: number;
  billed: number;
  retried: number;
  pending: number;
  failed: number;
  skipped: number;
  errors: number;
  advanced: number;
  advance_failed: number;
  advance_blocked: number;
  advance_no_unbilled_cycle: number;
  results: {
    contractId: string;
    action: string;
    detail?: string;
    advanced?: boolean;
    advanceFailed?: boolean;
    advanceBlocked?: boolean;
    advanceNoUnbilledCycle?: boolean;
    advanceAction?: string;
  }[];
};

async function runCron(): Promise<CronBody> {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()) as CronBody;
}

/** 課金完了済みの試行 (Case 1 に落ちる形)。 */
function completedAttempt(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/c-${createdAt}`,
    createdAt,
    ready: true,
    errorCode: null,
    errorMessage: null,
  };
}

/** 結果待ちの試行 (Case 2 に落ちる形)。 */
function inFlightAttempt(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/i-${createdAt}`,
    createdAt,
    ready: false,
    errorCode: null,
    errorMessage: null,
  };
}

function failedAttempt(createdAt: string) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/f-${createdAt}`,
    createdAt,
    ready: false,
    errorCode: "PAYMENT_METHOD_DECLINED",
    errorMessage: "The card was declined",
  };
}

const ADVANCED = {
  action: "advanced",
  from: "2026-09-12T04:00:00Z",
  to: "2026-10-12T04:00:00Z",
  cycleIndex: 2,
};

const NOOP = {
  action: "noop",
  from: "2026-10-12T04:00:00Z",
  to: "2026-10-12T04:00:00Z",
  reason: "導出値が現在値と一致",
};

const FAILED = {
  action: "failed",
  from: "2026-09-12T04:00:00Z",
  to: null,
  reason: "Admin API 503",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSubscriptionContractsMock.mockResolvedValue([
    { id: CONTRACT_GID, nextBillingDate: hoursAgo(2) },
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
  advanceNextBillingDateMock.mockResolvedValue(ADVANCED);
  // route は通知の Promise に `.catch` を繋ぐので、mock も Promise を返さないと
  // 「通知の失敗」が「cron の異常終了」に化けて本題の検証が隠れる。
  notifyBillingRunFailuresMock.mockResolvedValue(undefined);
  notifyBillingCronFatalMock.mockResolvedValue(undefined);
});

describe("確定成功したときだけ前進させる", () => {
  it("初回課金が確定成功 (billed) したら前進処理を呼ぶ", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "billed",
      advanced: true,
      advanceAction: "advanced",
    });
    expect(advanceNextBillingDateMock).toHaveBeenCalledTimes(1);
    expect(advanceNextBillingDateMock).toHaveBeenCalledWith(CONTRACT_GID);
    expect(body.advanced).toBe(1);
    expect(body.advance_failed).toBe(0);
    // 前進の結末は detail からも読める (action だけ見る監視の取りこぼしを防ぐ)
    expect(body.results[0]!.detail).toContain("advanced");
  });

  it("リトライが確定成功 (retried) したら前進処理を呼ぶ", async () => {
    getBillingAttemptsMock.mockResolvedValue([failedAttempt(hoursAgo(25))]);
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "retried", advanced: true });
    expect(advanceNextBillingDateMock).toHaveBeenCalledWith(CONTRACT_GID);
    expect(body.advanced).toBe(1);
  });

  it("pending (Shopify が受理しただけ) では前進処理を呼ばない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: null,
      errorMessage: null,
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "pending" });
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
    expect(body.advanced).toBe(0);
    expect(body.advance_failed).toBe(0);
  });

  it("課金が失敗したら前進処理を呼ばない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: false,
      errorCode: "PAYMENT_METHOD_DECLINED",
      errorMessage: "The card was declined",
    });

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "failed" });
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });
});

describe("詰まった契約の自力復旧 (skipped 経路)", () => {
  it("この周期が既に課金済み (skipped) でも前進処理を呼ぶ", async () => {
    // 「課金は通ったのに請求日が動いていない」状態。cron が毎日ここに落ちて
    // skipped を返し続けたのが 2026-08 の無音停止。
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "skipped",
      advanced: true,
      advanceAction: "advanced",
    });
    expect(advanceNextBillingDateMock).toHaveBeenCalledWith(CONTRACT_GID);
    expect(body.advanced).toBe(1);
    // 復旧であって再課金ではない
    expect(createBillingAttemptMock).not.toHaveBeenCalled();
  });

  it("既に前進済みなら noop として申告し、advanced には数えない", async () => {
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);
    advanceNextBillingDateMock.mockResolvedValue(NOOP);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "skipped",
      advanceAction: "noop",
    });
    expect(body.results[0]!.advanced).toBeUndefined();
    expect(body.advanced).toBe(0);
    expect(body.advance_failed).toBe(0);
  });

  it("結果待ち (in-flight) の skipped では前進処理を呼ばない", async () => {
    getBillingAttemptsMock.mockResolvedValue([inFlightAttempt(hoursAgo(1))]);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    expect(body.results[0]!.detail).toContain("still processing");
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });

  it("請求日が読めない skipped では前進処理を呼ばない", async () => {
    getSubscriptionContractsMock.mockResolvedValue([
      { id: CONTRACT_GID, nextBillingDate: "not-a-date" },
    ]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    // 日時として読めない値は due 判定 (new Date(x) <= now) を通らないので、
    // そもそも処理対象に入らない。前進も呼ばれない。
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });
});

describe("前進の失敗は捨てない (無音にしない)", () => {
  it("前進が失敗しても課金の action は billed のまま (error に倒さない)", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });
    advanceNextBillingDateMock.mockResolvedValue(FAILED);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      action: "billed",
      advanceFailed: true,
      advanceAction: "failed",
    });
    expect(body.billed).toBe(1);
    expect(body.errors).toBe(0);
    expect(body.advance_failed).toBe(1);
    expect(body.advanced).toBe(0);
    // 理由が detail に残る
    expect(body.results[0]!.detail).toContain("Admin API 503");
  });

  it("課金が全部通っていても前進が失敗した run は運営宛通知を出す", async () => {
    // ここが要点。failed/retry_failed/error はすべて 0 なので、前進失敗を発火条件に
    // 含めなければ通知は 1 通も出ない = 2026-08 の無音停止と同じ形になる。
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });
    advanceNextBillingDateMock.mockResolvedValue(FAILED);

    const body = await runCron();

    expect(body.failed).toBe(0);
    expect(body.errors).toBe(0);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith({
      due: 1,
      failed: 0,
      retryFailed: 0,
      errors: 0,
      advanceFailed: 1,
      advanceBlocked: 0,
      advanceNoUnbilledCycle: 0,
      contractIds: [CONTRACT_GID],
    });
  });

  it("前進が成功した run では通知を出さない", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });

    await runCron();

    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });

  it("summary の前進系キーは snake_case (camelCase を残さない)", async () => {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });
    advanceNextBillingDateMock.mockResolvedValue(FAILED);

    const raw = (await (await GET(request())).json()) as Record<
      string,
      unknown
    >;

    // 既存の慣習: TS プロパティは camelCase、summary の JSON キーは snake_case
    // (`dunningEmailFailed` -> `dunning_email_failed`)。
    expect(Object.keys(raw)).toContain("advance_failed");
    expect(Object.keys(raw)).toContain("advance_blocked");
    expect(Object.keys(raw)).toContain("advance_no_unbilled_cycle");
    expect(Object.keys(raw)).not.toContain("advanceFailed");
    expect(Object.keys(raw)).not.toContain("advanceBlocked");
    expect(Object.keys(raw)).not.toContain("advanceNoUnbilledCycle");
    // 1 語の `advanced` は分解しない
    expect(Object.keys(raw)).toContain("advanced");
  });
});

/**
 * 2026-08-12 / QA 条件 1: `advanced` と `failed` しか数えていなかったため、
 * `blocked_backward` と `no_unbilled_cycle` はどのカウンタにも載らず運営通知にも
 * 出なかった (= 本修正が消そうとした「無音」そのもの)。
 *
 * この describe が固定するのは 3 点:
 *   1. 独立カウンタに載る (`advance_blocked` / `advance_no_unbilled_cycle`)
 *   2. 課金が全部通った run でも通知が出る
 *   3. **`advanceFailed` には数えない** (「前進が失敗した」と伝えると運営が課金履歴を
 *      調べて「問題なし」と誤結論する)
 *
 * Sentry を error にする責務は lib 側 (`__tests__/next-billing-date.test.ts` が固定)。
 */
describe("失敗ではない無変更も無音にしない (blocked_backward / no_unbilled_cycle)", () => {
  const BLOCKED = {
    action: "blocked_backward",
    from: "2026-10-12T04:00:00Z",
    to: "2026-09-12T04:00:00Z",
    reason: "導出値が現在値より過去",
  };

  const NO_UNBILLED = {
    action: "no_unbilled_cycle",
    from: "2026-10-12T04:00:00Z",
    to: null,
    reason: "UNBILLED (skipped でない) cycle が無い",
  };

  /** 課金は確定成功する run (= 前進側だけが異常な形)。 */
  function billedRun() {
    createBillingAttemptMock.mockResolvedValue({
      id: ATTEMPT_GID,
      ready: true,
      errorCode: null,
      errorMessage: null,
    });
  }

  it("blocked_backward は advance_blocked に計上し、advanceFailed には数えない", async () => {
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);
    advanceNextBillingDateMock.mockResolvedValue(BLOCKED);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      advanceBlocked: true,
      advanceAction: "blocked_backward",
    });
    expect(body.advance_blocked).toBe(1);
    // 失敗の軸には入れない (保護が正しく働いた結末)
    expect(body.advance_failed).toBe(0);
    expect(body.results[0]!.advanceFailed).toBeUndefined();
    expect(body.advanced).toBe(0);
  });

  it("blocked_backward だけの run でも運営宛通知を出す", async () => {
    billedRun();
    advanceNextBillingDateMock.mockResolvedValue(BLOCKED);

    const body = await runCron();

    // 課金は全部通っている = 発火条件に含めなければ通知は 1 通も出ない
    expect(body.failed).toBe(0);
    expect(body.errors).toBe(0);
    expect(body.advance_failed).toBe(0);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith({
      due: 1,
      failed: 0,
      retryFailed: 0,
      errors: 0,
      advanceFailed: 0,
      advanceBlocked: 1,
      advanceNoUnbilledCycle: 0,
      contractIds: [CONTRACT_GID],
    });
  });

  it("no_unbilled_cycle は advance_no_unbilled_cycle に計上し、advanceFailed には数えない", async () => {
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);
    advanceNextBillingDateMock.mockResolvedValue(NO_UNBILLED);

    const body = await runCron();

    expect(body.results[0]).toMatchObject({
      advanceNoUnbilledCycle: true,
      advanceAction: "no_unbilled_cycle",
    });
    expect(body.advance_no_unbilled_cycle).toBe(1);
    expect(body.advance_failed).toBe(0);
    expect(body.results[0]!.advanceFailed).toBeUndefined();
  });

  it("no_unbilled_cycle だけの run でも運営宛通知を出す", async () => {
    billedRun();
    advanceNextBillingDateMock.mockResolvedValue(NO_UNBILLED);

    const body = await runCron();

    expect(body.failed).toBe(0);
    expect(body.advance_failed).toBe(0);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledTimes(1);
    expect(notifyBillingRunFailuresMock).toHaveBeenCalledWith({
      due: 1,
      failed: 0,
      retryFailed: 0,
      errors: 0,
      advanceFailed: 0,
      advanceBlocked: 0,
      advanceNoUnbilledCycle: 1,
      contractIds: [CONTRACT_GID],
    });
  });

  it("noop だけの run は通知を出さない (正常に前進済み)", async () => {
    billedRun();
    advanceNextBillingDateMock.mockResolvedValue(NOOP);

    const body = await runCron();

    expect(body.advance_blocked).toBe(0);
    expect(body.advance_no_unbilled_cycle).toBe(0);
    expect(notifyBillingRunFailuresMock).not.toHaveBeenCalled();
  });
});

describe("無音停止の安全網 (isAdvanceStalled の配線)", () => {
  const STALL_HOURS = ADVANCE_STALL_PERIOD_HOURS + ADVANCE_STALL_GRACE_HOURS;

  /**
   * 「請求日が 1 周期以上前のまま、その周期の課金だけは通っている」契約を作る。
   * 課金完了は `analyzeBillingCycle` の集計窓 (請求日 -24h 以降) の内側に置く必要が
   * あるので、請求日も同じだけ過去に置く。
   */
  function stalledContract() {
    getSubscriptionContractsMock.mockResolvedValue([
      { id: CONTRACT_GID, nextBillingDate: hoursAgo(STALL_HOURS + 2) },
    ]);
    getBillingAttemptsMock.mockResolvedValue([
      completedAttempt(hoursAgo(STALL_HOURS + 1)),
    ]);
  }

  function advanceStallMessages() {
    return vi
      .mocked(Sentry.captureMessage)
      .mock.calls.filter(
        ([message]) =>
          typeof message === "string" && message.includes("failed to advance"),
      );
  }

  it("課金完了から 1 周期 + 猶予を超えてまだ同じ請求日なら Sentry error", async () => {
    stalledContract();

    const body = await runCron();

    expect(body.results[0]).toMatchObject({ action: "skipped" });
    const calls = advanceStallMessages();
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({ level: "error" });
    expect(body.results[0]!.detail).toContain("advance stalled");
  });

  it("課金完了が直近なら鳴らさない (課金直後の正常なラグ)", async () => {
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);

    await runCron();

    expect(advanceStallMessages()).toHaveLength(0);
  });

  it("鳴らしたイベントに復旧結果を載せる (鳴った時点で直ったのかが分かる)", async () => {
    stalledContract();
    advanceNextBillingDateMock.mockResolvedValue(FAILED);

    await runCron();

    const [, options] = advanceStallMessages()[0]!;
    expect(options).toMatchObject({
      extra: expect.objectContaining({
        contractId: CONTRACT_GID,
        recoveryAction: "failed",
      }),
    });
  });
});

describe("isAdvanceStalled の境界 (純関数)", () => {
  const base = new Date("2026-08-12T00:00:00Z");
  const stallMs = (ADVANCE_STALL_PERIOD_HOURS + ADVANCE_STALL_GRACE_HOURS) * HOUR_MS;

  it("ちょうど 1 周期 + 猶予では鳴らさない (超えたときだけ)", () => {
    expect(isAdvanceStalled(base, new Date(base.getTime() + stallMs))).toBe(
      false,
    );
    expect(isAdvanceStalled(base, new Date(base.getTime() + stallMs + 1))).toBe(
      true,
    );
  });

  it("1 周期ぶん経っただけでは鳴らさない (猶予の内側)", () => {
    const oneperiod = ADVANCE_STALL_PERIOD_HOURS * HOUR_MS;
    expect(isAdvanceStalled(base, new Date(base.getTime() + oneperiod))).toBe(
      false,
    );
  });

  it("周期を引数で渡せる (月次以外の契約に閾値を合わせられる)", () => {
    const twoWeeksHours = 24 * 14;
    const now = new Date(
      base.getTime() + (twoWeeksHours + ADVANCE_STALL_GRACE_HOURS + 1) * HOUR_MS,
    );
    expect(isAdvanceStalled(base, now, twoWeeksHours)).toBe(true);
    // 既定 (月次) の閾値ではまだ鳴らない
    expect(isAdvanceStalled(base, now)).toBe(false);
  });

  it("時刻が読めなければ鳴らさない (判断材料が無いのに error を出さない)", () => {
    expect(isAdvanceStalled(new Date("not-a-date"), base)).toBe(false);
  });

  it("未来の completedAt でも鳴らさない (負の経過時間)", () => {
    expect(
      isAdvanceStalled(new Date(base.getTime() + stallMs * 2), base),
    ).toBe(false);
  });
});

/**
 * 2026-08-12 / QA 条件 2: 停止検知の閾値が契約周期を見ていなかった。
 *
 * `ADVANCE_STALL_PERIOD_HOURS` (24x31) + 猶予 24 の**固定 768h** で、cron は
 * `periodHours` を渡していなかった。`subscription-actions.ts` は DAY / WEEK / MONTH /
 * YEAR を受け付けるので、**週次契約が詰まっても約 8 日で気づくべきところ 32 日**
 * かかっていた。誤検知は起こり得ない (`nextBillingDate <= now` の due フィルタにより
 * 健全な契約は Case 1 に到達しない) ので、これは純粋な検知遅れの是正。
 */
describe("停止検知の閾値を契約周期から出す (advanceStallPeriodHours)", () => {
  it("DAY / WEEK / MONTH / YEAR をそれぞれ最長側で算出する", () => {
    expect(advanceStallPeriodHours({ interval: "DAY", intervalCount: 1 })).toBe(
      24,
    );
    expect(advanceStallPeriodHours({ interval: "WEEK", intervalCount: 1 })).toBe(
      24 * 7,
    );
    // 月は最長の月 (31 日)。28 日で見ると月末アンカーの契約を誤検知する。
    expect(
      advanceStallPeriodHours({ interval: "MONTH", intervalCount: 1 }),
    ).toBe(24 * 31);
    // 年は閏年 (366 日)。365 日で見ると閏年の契約を誤検知する。
    expect(advanceStallPeriodHours({ interval: "YEAR", intervalCount: 1 })).toBe(
      24 * 366,
    );
    // 公開定数と一致している (route 側が別の表を持たない)
    expect(INTERVAL_MAX_HOURS).toEqual({
      DAY: 24,
      WEEK: 24 * 7,
      MONTH: 24 * 31,
      YEAR: 24 * 366,
    });
  });

  it("intervalCount を掛ける (2 週ごと / 3 か月ごとの契約)", () => {
    expect(advanceStallPeriodHours({ interval: "WEEK", intervalCount: 2 })).toBe(
      24 * 14,
    );
    expect(
      advanceStallPeriodHours({ interval: "MONTH", intervalCount: 3 }),
    ).toBe(24 * 93);
  });

  it("既定 (MONTH x1) は従来の閾値と同じ = 既存契約の挙動を変えない", () => {
    expect(
      advanceStallPeriodHours({ interval: "MONTH", intervalCount: 1 }),
    ).toBe(ADVANCE_STALL_PERIOD_HOURS);
  });

  it("読めない値は月次既定にフォールバックする (鳴るのが遅れる側に倒す)", () => {
    expect(advanceStallPeriodHours(undefined)).toBe(ADVANCE_STALL_PERIOD_HOURS);
    expect(advanceStallPeriodHours(null)).toBe(ADVANCE_STALL_PERIOD_HOURS);
    expect(advanceStallPeriodHours({})).toBe(ADVANCE_STALL_PERIOD_HOURS);
    // 未知の interval (Shopify が enum を増やした場合)
    expect(
      advanceStallPeriodHours({
        interval: "FORTNIGHT" as never,
        intervalCount: 1,
      }),
    ).toBe(ADVANCE_STALL_PERIOD_HOURS);
    // 非数 / 0 以下の intervalCount は 1 として扱う (0 倍で閾値が消えないように)
    expect(
      advanceStallPeriodHours({ interval: "WEEK", intervalCount: 0 }),
    ).toBe(24 * 7);
    expect(
      advanceStallPeriodHours({
        interval: "WEEK",
        intervalCount: Number.NaN,
      }),
    ).toBe(24 * 7);
  });

  it("各周期の境界: 閾値ちょうどは鳴らず、+1h で鳴り、-1h では鳴らない", () => {
    const base = new Date("2026-08-12T00:00:00Z");
    const cases: { interval: "DAY" | "WEEK" | "MONTH" | "YEAR"; hours: number }[] =
      [
        { interval: "DAY", hours: 24 },
        { interval: "WEEK", hours: 24 * 7 },
        { interval: "MONTH", hours: 24 * 31 },
        { interval: "YEAR", hours: 24 * 366 },
      ];

    for (const { interval, hours } of cases) {
      const periodHours = advanceStallPeriodHours({
        interval,
        intervalCount: 1,
      });
      expect(periodHours).toBe(hours);
      const thresholdHours = periodHours + ADVANCE_STALL_GRACE_HOURS;
      const at = (h: number) => new Date(base.getTime() + h * HOUR_MS);

      expect(isAdvanceStalled(base, at(thresholdHours - 1), periodHours)).toBe(
        false,
      );
      // 厳密 `>` なので閾値ちょうどでは鳴らない
      expect(isAdvanceStalled(base, at(thresholdHours), periodHours)).toBe(
        false,
      );
      expect(isAdvanceStalled(base, at(thresholdHours + 1), periodHours)).toBe(
        true,
      );
    }
  });

  it("週次契約は約 8 日で鳴る (月次固定だと 32 日かかっていた)", () => {
    const base = new Date("2026-08-12T00:00:00Z");
    const weekly = advanceStallPeriodHours({
      interval: "WEEK",
      intervalCount: 1,
    });
    // 8 日 + 1h 経過時点
    const now = new Date(base.getTime() + (24 * 8 + 1) * HOUR_MS);

    expect(isAdvanceStalled(base, now, weekly)).toBe(true);
    // 同じ時点を月次既定で見ると、まだ鳴らない (= 24 日以上の検知遅れ)
    expect(isAdvanceStalled(base, now)).toBe(false);
  });
});

describe("cron が契約の billingPolicy から閾値を出す (配線)", () => {
  function advanceStallMessages() {
    return vi
      .mocked(Sentry.captureMessage)
      .mock.calls.filter(
        ([message]) =>
          typeof message === "string" && message.includes("failed to advance"),
      );
  }

  /**
   * 「請求日が N 時間前のまま、その周期の課金だけは通っている」契約を作る。
   * 課金完了は `analyzeBillingCycle` の集計窓 (請求日 -24h 以降) の内側に置く。
   */
  function stalledContract(
    hours: number,
    billingPolicy?: { interval: string; intervalCount: number },
  ) {
    getSubscriptionContractsMock.mockResolvedValue([
      {
        id: CONTRACT_GID,
        nextBillingDate: hoursAgo(hours + 2),
        ...(billingPolicy ? { billingPolicy } : {}),
      },
    ]);
    getBillingAttemptsMock.mockResolvedValue([
      completedAttempt(hoursAgo(hours + 1)),
    ]);
  }

  /** 週次契約の閾値 = 168 + 24 = 192h。その 1h 後を見る。 */
  const WEEKLY_STALL_HOURS = 24 * 7 + ADVANCE_STALL_GRACE_HOURS + 1;

  it("週次契約は約 8 日で鳴る (月次固定では鳴らなかった時点)", async () => {
    stalledContract(WEEKLY_STALL_HOURS, {
      interval: "WEEK",
      intervalCount: 1,
    });

    await runCron();

    const calls = advanceStallMessages();
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({ level: "error" });
    // 判定に使った周期をイベントに載せる (閾値が契約ごとに変わるので必須)
    expect(calls[0]![1]).toMatchObject({
      extra: expect.objectContaining({
        billingInterval: "WEEK",
        billingIntervalCount: 1,
        periodHours: 24 * 7,
      }),
    });
  });

  it("同じ経過時間でも月次契約なら鳴らさない (周期ごとに閾値が変わる)", async () => {
    stalledContract(WEEKLY_STALL_HOURS, {
      interval: "MONTH",
      intervalCount: 1,
    });

    await runCron();

    expect(advanceStallMessages()).toHaveLength(0);
  });

  it("2 週ごとの契約は intervalCount ぶん遅く鳴る", async () => {
    // 週次の閾値を超えた時点ではまだ鳴らない
    stalledContract(WEEKLY_STALL_HOURS, {
      interval: "WEEK",
      intervalCount: 2,
    });

    await runCron();

    expect(advanceStallMessages()).toHaveLength(0);
  });

  it("billingPolicy が無ければ月次既定で判定する (挙動を変えない)", async () => {
    stalledContract(ADVANCE_STALL_PERIOD_HOURS + ADVANCE_STALL_GRACE_HOURS + 1);

    await runCron();

    const calls = advanceStallMessages();
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({
      extra: expect.objectContaining({
        billingInterval: null,
        billingIntervalCount: null,
        periodHours: ADVANCE_STALL_PERIOD_HOURS,
      }),
    });
  });

  it("日次契約は 2 日で鳴る (最短周期でも取りこぼさない)", async () => {
    stalledContract(24 + ADVANCE_STALL_GRACE_HOURS + 1, {
      interval: "DAY",
      intervalCount: 1,
    });

    await runCron();

    const calls = advanceStallMessages();
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({
      extra: expect.objectContaining({ periodHours: 24 }),
    });
  });

  it("年次契約は 1 年を超えるまで鳴らさない (誤検知を作らない)", async () => {
    stalledContract(24 * 200, { interval: "YEAR", intervalCount: 1 });

    await runCron();

    expect(advanceStallMessages()).toHaveLength(0);
  });
});

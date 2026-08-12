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
 *   6. ただし **`failed` を捨てない**。`advanceFailed` に計上し、運営宛通知に載せ、
 *      課金の失敗が 0 件の run でも通知を出す (捨てると 2026-08 の無音停止が再発する)
 *   7. 無音停止の安全網: 課金完了から 1 周期 + 猶予を過ぎてまだ同じ請求日なら
 *      Sentry error を出す。過ぎていなければ出さない
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

type CronBody = {
  due: number;
  billed: number;
  retried: number;
  pending: number;
  failed: number;
  skipped: number;
  errors: number;
  advanced: number;
  advanceFailed: number;
  results: {
    contractId: string;
    action: string;
    detail?: string;
    advanced?: boolean;
    advanceFailed?: boolean;
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
    expect(body.advanceFailed).toBe(0);
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
    expect(body.advanceFailed).toBe(0);
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
    expect(body.advanceFailed).toBe(0);
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
    expect(body.advanceFailed).toBe(1);
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

  it("巻き戻り拒否 (blocked_backward) は失敗に数えないが申告には残す", async () => {
    // lib 側が Sentry warning を上げており「書かない判断が正しく働いた」状態。
    // ここを advanceFailed に数えると、正常な保護でも運営通知が鳴る。
    getBillingAttemptsMock.mockResolvedValue([completedAttempt(hoursAgo(3))]);
    advanceNextBillingDateMock.mockResolvedValue({
      action: "blocked_backward",
      from: "2026-10-12T04:00:00Z",
      to: "2026-09-12T04:00:00Z",
      reason: "導出値が現在値より過去",
    });

    const body = await runCron();

    expect(body.advanceFailed).toBe(0);
    expect(body.results[0]!.advanceAction).toBe("blocked_backward");
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

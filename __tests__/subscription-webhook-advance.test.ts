/**
 * Tests for POST /api/subscription/webhook の `nextBillingDate` 前進の配線.
 *
 * ## なぜ webhook 側にも前進が要るか
 *
 * Shopify の課金は非同期で、`subscriptionBillingAttemptCreate` は `ready: false` を
 * 返すことがある。cron (`app/api/cron/billing`) は**確定成功枝でしか**前進させないので、
 * その run は `pending` で抜ける。確定結果は
 * `subscription_billing_attempts/success` webhook にしか来ない — つまり
 * **`pending` で抜けた課金を拾える唯一の場所がここ**。ここが `console.log` だけの
 * ままだと、非同期で通った課金の請求日は永久に前進しない。
 *
 * この層が守るべき契約:
 *
 *   1. 課金成功 topic で前進処理を呼ぶ。渡すのは数値 id ではなく **Admin API の GID**
 *   2. handler は `await` される (前進の完了前に markProcessed / 200 を返さない)
 *   3. **再送は no-op**。`checkWebhookIdempotency` が先に落とすので前進処理は呼ばれない
 *   4. 前進が失敗しても 200 を返す (500 を返すと Shopify が同じ成功イベントを再送し
 *      続ける。前進が失敗した契約は cron の Case 1 が翌日以降に拾い直す)
 *   5. 課金失敗 topic では前進させない
 *   6. contract id が使えない形なら前進せず **Sentry error で鳴らす** (無音にしない)
 *
 * HMAC 検証 / Firestore / 前進処理はすべて mock。**実 mutation・実送信はしない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

const validateWebhookRequestMock = vi.fn();
const checkWebhookIdempotencyMock = vi.fn();
vi.mock("@/lib/shopify/webhooks/verify", () => ({
  validateWebhookRequest: (...args: unknown[]) =>
    validateWebhookRequestMock(...args),
  checkWebhookIdempotency: (...args: unknown[]) =>
    checkWebhookIdempotencyMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({}) }) }),
}));

const advanceNextBillingDateMock = vi.fn();
vi.mock("@/lib/shopify/next-billing-date", () => ({
  advanceNextBillingDate: (...args: unknown[]) =>
    advanceNextBillingDateMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST } from "@/app/api/subscription/webhook/route";

const CONTRACT_NUMERIC_ID = 28008382622;
const CONTRACT_GID = `gid://shopify/SubscriptionContract/${CONTRACT_NUMERIC_ID}`;

const ADVANCED = {
  action: "advanced",
  from: "2026-09-12T04:00:00Z",
  to: "2026-10-12T04:00:00Z",
  cycleIndex: 2,
};

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    admin_graphql_api_id: "gid://shopify/SubscriptionBillingAttempt/9001",
    id: 9001,
    subscription_contract_id: CONTRACT_NUMERIC_ID,
    ready: true,
    error_message: null,
    error_code: null,
    created_at: "2026-08-12T04:00:00Z",
    ...overrides,
  };
}

/** validateWebhookRequest が返す「検証済み」の形。 */
function validated(topic: string, payload: unknown, webhookId = "wh-1") {
  return { ok: true as const, rawBody: "{}", payload, topic, webhookId };
}

const markProcessedMock = vi.fn();

function request(): NextRequest {
  return new NextRequest("http://localhost/api/subscription/webhook", {
    method: "POST",
    body: "{}",
  });
}

async function post(): Promise<{ status: number; body: unknown }> {
  const res = await POST(request());
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  markProcessedMock.mockResolvedValue(undefined);
  checkWebhookIdempotencyMock.mockResolvedValue({
    alreadyProcessed: false,
    markProcessed: markProcessedMock,
  });
  advanceNextBillingDateMock.mockResolvedValue(ADVANCED);
  validateWebhookRequestMock.mockResolvedValue(
    validated("subscription_billing_attempts/success", successPayload()),
  );
});

describe("課金成功 webhook で nextBillingDate を前進させる", () => {
  it("GID に組み立てて前進処理を呼び、200 を返す", async () => {
    const { status, body } = await post();

    expect(status).toBe(200);
    expect(body).toMatchObject({ received: true });
    expect(advanceNextBillingDateMock).toHaveBeenCalledTimes(1);
    // 数値 id をそのまま渡さない (Admin API は GID しか受けない)
    expect(advanceNextBillingDateMock).toHaveBeenCalledWith(CONTRACT_GID);
  });

  it("前進の完了を待ってから処理済みマークを付ける", async () => {
    // await を落とすと「前進が終わる前に 200 + markProcessed」になり、失敗しても
    // idempotency で二度目が来ないため完全に取りこぼす。
    const order: string[] = [];
    advanceNextBillingDateMock.mockImplementation(async () => {
      await Promise.resolve();
      order.push("advance");
      return ADVANCED;
    });
    markProcessedMock.mockImplementation(async () => {
      order.push("markProcessed");
    });

    await post();

    expect(order).toEqual(["advance", "markProcessed"]);
  });

  it("前進が失敗しても 200 を返す (Shopify に成功イベントを再送させない)", async () => {
    advanceNextBillingDateMock.mockResolvedValue({
      action: "failed",
      from: "2026-09-12T04:00:00Z",
      to: null,
      reason: "Admin API 503",
    });

    const { status } = await post();

    // 申告は lib 側 (Sentry + console) が担保する。ここでは 500 に化けないことを固定。
    expect(status).toBe(200);
    expect(markProcessedMock).toHaveBeenCalledTimes(1);
  });

  it("導出値が既に一致していれば noop でも 200 (再送が自然に無害)", async () => {
    advanceNextBillingDateMock.mockResolvedValue({
      action: "noop",
      from: "2026-10-12T04:00:00Z",
      to: "2026-10-12T04:00:00Z",
      reason: "導出値が現在値と一致",
    });

    const { status } = await post();

    expect(status).toBe(200);
  });
});

describe("再送は no-op", () => {
  it("同じ webhook が再送されたら前進処理を呼ばない", async () => {
    checkWebhookIdempotencyMock.mockResolvedValue({ alreadyProcessed: true });

    const { status, body } = await post();

    expect(status).toBe(200);
    expect(body).toMatchObject({ idempotent: true });
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });
});

describe("前進させない経路", () => {
  it("課金失敗 topic では前進させない", async () => {
    validateWebhookRequestMock.mockResolvedValue(
      validated(
        "subscription_billing_attempts/failure",
        successPayload({
          ready: false,
          error_code: "PAYMENT_METHOD_DECLINED",
          error_message: "The card was declined",
        }),
      ),
    );

    const { status } = await post();

    expect(status).toBe(200);
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });

  it("success topic に error_code が入っていたら前進させない", async () => {
    // topic 名だけを根拠に請求日を進めると、失敗した周期を飛ばして未収を作る。
    validateWebhookRequestMock.mockResolvedValue(
      validated(
        "subscription_billing_attempts/success",
        successPayload({ error_code: "PAYMENT_METHOD_DECLINED" }),
      ),
    );

    const { status } = await post();

    expect(status).toBe(200);
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });

  it("契約更新 topic では前進させない", async () => {
    validateWebhookRequestMock.mockResolvedValue(
      validated("subscription_contracts/update", {
        id: 1,
        status: "ACTIVE",
        customer: { id: 2 },
      }),
    );

    await post();

    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
  });

  it("HMAC 検証が通らなければ前進処理に到達しない", async () => {
    validateWebhookRequestMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();
    expect(checkWebhookIdempotencyMock).not.toHaveBeenCalled();
  });
});

describe("contract id が使えない形のときは黙って落とさない", () => {
  it.each([
    ["null", null],
    ["文字列", "28008382622"],
    ["0", 0],
    ["負値", -1],
    ["小数", 1.5],
  ])("%s なら前進させず Sentry error を出す", async (_label, contractId) => {
    validateWebhookRequestMock.mockResolvedValue(
      validated(
        "subscription_billing_attempts/success",
        successPayload({ subscription_contract_id: contractId }),
      ),
    );

    const { status } = await post();

    // webhook 自体は成功扱い (再送させても直らない) だが、前進できなかったことは残す。
    expect(status).toBe(200);
    expect(advanceNextBillingDateMock).not.toHaveBeenCalled();

    const errors = vi
      .mocked(Sentry.captureMessage)
      .mock.calls.filter(
        ([message]) =>
          typeof message === "string" &&
          message.includes("nextBillingDate advance skipped"),
      );
    expect(errors).toHaveLength(1);
    expect(errors[0]![1]).toMatchObject({ level: "error" });
  });
});

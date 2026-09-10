/**
 * Tests for POST /api/webhooks/orders の**運営宛 LINE 監視通知の配線**.
 *
 * 注文 webhook の取り込みが落ちても顧客側には何も見えない (Shopify 上の注文は成立
 * している)。よって運営が気づく経路が必要で、その配線をここで固定する。
 *
 * 契約:
 *   1. 正常に取り込めた run では 1 通も送らない。
 *   2. 取り込み処理が例外で落ちたら 1 通送り、応答は 500 のまま
 *      (Shopify の再送を止めない)。
 *   3. 通知に渡すのは topic と注文番号だけ。**顧客の識別子 (customerId) や
 *      メールアドレスは渡さない**。
 *   4. HMAC 不正・スキーマ不正で弾いた場合は「処理の例外」ではないので送らない。
 *   5. 通知が reject しても 500 応答は変わらない。
 *
 * Shopify 検証 / Firestore / LINE 送出はすべて mock。**実送信はしない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const validateWebhookRequestMock = vi.fn();
const checkWebhookIdempotencyMock = vi.fn();
vi.mock("@/lib/shopify/webhooks/verify", () => ({
  validateWebhookRequest: (...args: unknown[]) =>
    validateWebhookRequestMock(...args),
  checkWebhookIdempotency: (...args: unknown[]) =>
    checkWebhookIdempotencyMock(...args),
}));

const runTransactionMock = vi.fn();
const getAdminFirestoreMock = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: (...args: unknown[]) => getAdminFirestoreMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-timestamp" },
  Timestamp: { fromDate: (d: Date) => ({ toDate: () => d }) },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const notifyWebhookExceptionMock = vi.fn();
vi.mock("@/lib/line/monitoring-alerts", () => ({
  notifyWebhookException: (...args: unknown[]) =>
    notifyWebhookExceptionMock(...args),
}));

import { POST } from "@/app/api/webhooks/orders/route";

const CUSTOMER_ID = 555000111;
const CUSTOMER_EMAIL = "customer@example.test";

function orderPayload() {
  return {
    id: 9900001,
    order_number: 1234,
    email: CUSTOMER_EMAIL,
    customer: {
      id: CUSTOMER_ID,
      email: CUSTOMER_EMAIL,
      first_name: "太郎",
      last_name: "山田",
    },
    line_items: [
      {
        title: "Tea",
        quantity: 1,
        variant_id: 1,
        product_id: 2,
        price: "3000.00",
      },
    ],
    total_price: "3000.00",
    currency: "JPY",
    created_at: new Date().toISOString(),
    financial_status: "paid",
    fulfillment_status: null,
  };
}

/** Firestore の参照チェーンを最小限だけ満たすスタブ。 */
function firestoreStub() {
  /* `count()` は persona 推論用の注文件数集計のためだけに要っていた。
     T-1 で persona の書き手を cx-agent 側に一本化し、その読み取りごと
     route から外したので、スタブ側も落とす (実装に無いものを満たさない)。 */
  const docRef = {
    collection: () => ({ doc: () => docRef }),
  };
  return {
    collection: () => ({ doc: () => docRef }),
    runTransaction: runTransactionMock,
  };
}

function request(): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  validateWebhookRequestMock.mockResolvedValue({
    ok: true,
    rawBody: "{}",
    payload: orderPayload(),
    topic: "orders/create",
    webhookId: "wh-1",
  });
  checkWebhookIdempotencyMock.mockResolvedValue({
    alreadyProcessed: false,
    markProcessed: vi.fn(async () => {}),
  });
  getAdminFirestoreMock.mockImplementation(() => firestoreStub());
  /* トランザクションの戻り値から `personaSignal` は無くなった (T-1)。
     route は skipped だけを見てログを分岐する。 */
  runTransactionMock.mockResolvedValue({ skipped: false });
  notifyWebhookExceptionMock.mockResolvedValue(undefined);
});

describe("正常時", () => {
  it("取り込みが成功したら通知しない", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(notifyWebhookExceptionMock).not.toHaveBeenCalled();
  });

  it("重複配信 (idempotent) でも通知しない", async () => {
    checkWebhookIdempotencyMock.mockResolvedValue({
      alreadyProcessed: true,
      markProcessed: vi.fn(),
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(notifyWebhookExceptionMock).not.toHaveBeenCalled();
  });
});

describe("弾いた要求は「処理の例外」ではない", () => {
  it("HMAC 不正 (401) では通知しない", async () => {
    validateWebhookRequestMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(notifyWebhookExceptionMock).not.toHaveBeenCalled();
  });

  it("スキーマ不正 (400) では通知しない", async () => {
    validateWebhookRequestMock.mockResolvedValue({
      ok: true,
      rawBody: "{}",
      payload: { id: "not-a-number" },
      topic: "orders/create",
      webhookId: "wh-2",
    });

    const res = await POST(request());

    expect(res.status).toBe(400);
    expect(notifyWebhookExceptionMock).not.toHaveBeenCalled();
  });
});

describe("処理が例外で落ちたとき", () => {
  it("1 通送り、応答は 500 のまま (Shopify に再送させる)", async () => {
    runTransactionMock.mockRejectedValue(new Error("Firestore unavailable"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(notifyWebhookExceptionMock).toHaveBeenCalledTimes(1);
    expect(notifyWebhookExceptionMock).toHaveBeenCalledWith({
      webhook: "orders/create",
      reference: "注文 #1234",
      message: "Firestore unavailable",
    });
  });

  it("通知の引数に顧客の識別子・メールを含めない", async () => {
    runTransactionMock.mockRejectedValue(new Error("Firestore unavailable"));

    await POST(request());

    const arg = JSON.stringify(notifyWebhookExceptionMock.mock.calls[0]![0]);
    expect(arg).not.toContain(CUSTOMER_EMAIL);
    expect(arg).not.toContain(String(CUSTOMER_ID));
    expect(arg).not.toContain("山田");
  });

  it("Error でない値が throw されても message を埋めて送る", async () => {
    runTransactionMock.mockRejectedValue("string failure");

    await POST(request());

    expect(notifyWebhookExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Unknown error" }),
    );
  });

  it("通知が reject しても 500 応答は変わらない", async () => {
    runTransactionMock.mockRejectedValue(new Error("Firestore unavailable"));
    notifyWebhookExceptionMock.mockRejectedValue(new Error("push exploded"));

    const res = await POST(request());

    expect(res.status).toBe(500);
  });
});

/**
 * Tests for `lib/line/monitoring-alerts`（運営宛 LINE 監視通知の文面と送出）.
 *
 * このモジュールが守るべき契約:
 *   1. **例外を外に出さない**。送信層が reject しても呼び出し元 (課金 cron / webhook)
 *      へ例外を伝播させない。かつ黙って捨てず console.error に残す。
 *   2. **顧客の個人情報を載せない**。件数と Shopify 上で引ける識別子だけを載せ、
 *      エラー文言に紛れ込んだメールアドレスは伏せる。
 *   3. 識別子が多いときは上限まで列挙して残りは件数に畳む (通知が読める長さに保つ)。
 *   4. 事象ごとに level が妥当 (契約停止・cron 異常終了は error / run 内失敗は warning)。
 *
 * 送信層 (`sendLineNotify`) は mock。**実送信はしない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendLineNotifyMock = vi.fn();
vi.mock("@/lib/line/notify", () => ({
  sendLineNotify: (...args: unknown[]) => sendLineNotifyMock(...args),
}));

import {
  notifyBillingCronFatal,
  notifyBillingRunFailures,
  notifySubscriptionPaused,
  notifyWebhookException,
  sanitizeDetail,
  shortId,
} from "@/lib/line/monitoring-alerts";

type Sent = { subject: string; body: string; level?: string };

function sent(): Sent {
  expect(sendLineNotifyMock).toHaveBeenCalledTimes(1);
  return sendLineNotifyMock.mock.calls[0]![0] as Sent;
}

function contractGid(id: number | string): string {
  return `gid://shopify/SubscriptionContract/${id}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendLineNotifyMock.mockResolvedValue(undefined);
});

describe("shortId", () => {
  it("Shopify GID を末尾の数値 ID に縮める", () => {
    expect(shortId(contractGid(7001))).toBe("7001");
  });

  it("GID 形式でなければそのまま返す", () => {
    expect(shortId("7001")).toBe("7001");
  });
});

describe("sanitizeDetail", () => {
  it("メールアドレスを伏せる", () => {
    const out = sanitizeDetail("Card declined for customer@example.test (code 51)");
    expect(out).not.toContain("customer@example.test");
    expect(out).toContain("<email>");
  });

  it("改行・連続空白を 1 スペースに畳む", () => {
    expect(sanitizeDetail("line1\n  line2\t\tline3")).toBe("line1 line2 line3");
  });

  it("長すぎる文言を切る", () => {
    const out = sanitizeDetail("x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(203);
    expect(out.endsWith("...")).toBe(true);
  });

  it("空文字は「詳細なし」に置き換える", () => {
    expect(sanitizeDetail("   ")).toBe("(詳細なし)");
  });
});

describe("notifyBillingRunFailures", () => {
  it("件数と契約 ID を載せ、level は warning", async () => {
    await notifyBillingRunFailures({
      due: 3,
      failed: 1,
      retryFailed: 1,
      errors: 0,
      contractIds: [contractGid(7001), contractGid(7002)],
    });

    const payload = sent();
    expect(payload.level).toBe("warning");
    expect(payload.body).toContain("対象 3 件");
    expect(payload.body).toContain("初回失敗 1 件");
    expect(payload.body).toContain("再試行失敗 1 件");
    expect(payload.body).toContain("7001, 7002");
    // 顧客の個人情報は文面に一切入らない
    expect(payload.body).not.toContain("@");
  });

  it("契約が上限を超えたら「他 N 件」に畳む", async () => {
    await notifyBillingRunFailures({
      due: 7,
      failed: 7,
      retryFailed: 0,
      errors: 0,
      contractIds: [1, 2, 3, 4, 5, 6, 7].map((n) => contractGid(n)),
    });

    const body = sent().body;
    expect(body).toContain("1, 2, 3, 4, 5 他 2 件");
    expect(body).not.toContain("6, 7");
  });

  it("契約 ID が空でも本文が壊れない", async () => {
    await notifyBillingRunFailures({
      due: 1,
      failed: 0,
      retryFailed: 0,
      errors: 1,
      contractIds: [],
    });

    expect(sent().body).toContain("契約: -");
  });
});

describe("notifyBillingCronFatal", () => {
  it("原因と「課金が完了していない」旨を伝え、level は error", async () => {
    await notifyBillingCronFatal({ message: "Shopify Admin API 503" });

    const payload = sent();
    expect(payload.level).toBe("error");
    expect(payload.body).toContain("Shopify Admin API 503");
    expect(payload.body).toContain("完了していません");
  });
});

describe("notifySubscriptionPaused", () => {
  it("契約 ID と失敗回数を載せ、level は error", async () => {
    await notifySubscriptionPaused({
      contractId: contractGid(7001),
      failureCount: 3,
      customerNotified: true,
    });

    const payload = sent();
    expect(payload.level).toBe("error");
    expect(payload.subject).toContain("停止");
    expect(payload.body).toContain("契約: 7001");
    expect(payload.body).toContain("3 回");
  });

  /**
   * 以前ここは固定文で「顧客への最終案内は送信済み」と書いていた。督促メールが
   * 送れていなくても運営には送信済みと見え、顧客だけが何も知らないまま契約が
   * 止まる (2026-08-11 の失敗系監査 High-2)。実結果をそのまま出す。
   */
  it("最終督促メールを送れていれば「送信済み」と書く", async () => {
    await notifySubscriptionPaused({
      contractId: contractGid(7001),
      failureCount: 3,
      customerNotified: true,
    });

    expect(sent().body).toContain("顧客への最終案内は送信済み");
    expect(sent().body).not.toContain("手動連絡");
  });

  it("送れていなければ「送信できていません (手動連絡が必要)」と書く", async () => {
    await notifySubscriptionPaused({
      contractId: contractGid(7001),
      failureCount: 3,
      customerNotified: false,
    });

    const body = sent().body;
    expect(body).toContain("顧客への最終案内は送信できていません");
    expect(body).toContain("手動連絡が必要");
    expect(body).not.toContain("送信済み");
  });
});

describe("notifyWebhookException", () => {
  it("topic・対象・原因を載せる", async () => {
    await notifyWebhookException({
      webhook: "orders/create",
      reference: "注文 #1234",
      message: "Firestore transaction failed",
    });

    const payload = sent();
    expect(payload.level).toBe("error");
    expect(payload.body).toContain("orders/create");
    expect(payload.body).toContain("注文 #1234");
    expect(payload.body).toContain("Firestore transaction failed");
  });

  it("reference が無ければ対象行を出さない", async () => {
    await notifyWebhookException({
      webhook: "orders/create",
      message: "boom",
    });

    expect(sent().body).not.toContain("対象:");
  });
});

describe("送信が失敗しても本処理を壊さない", () => {
  it("sendLineNotify が reject しても throw せず、ログに残す", async () => {
    sendLineNotifyMock.mockRejectedValue(new Error("push exploded"));

    await expect(
      notifySubscriptionPaused({
        contractId: contractGid(7001),
        failureCount: 3,
        customerNotified: true,
      }),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});

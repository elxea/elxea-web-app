import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PAST_LIMIT,
  ACCOUNT_UPCOMING_LIMIT,
  accountDisplayName,
  buildAccountView,
  buildPast,
  buildUpcoming,
  formatRecordDate,
  isPlaceholderEmail,
} from "@/lib/account-view";

/**
 * マイページ【R2: 確定版】(Figma 8095:731) の描画モデルの単体テスト。
 *
 * 確定版は「これから」「続き」「これまで」「お支払い方法」の 4 節しか持たないので、
 * 各節に何が入り、何が入らないかを型ではなく振る舞いで固定する。
 * 特に「解約済み / 過去日付の予定を『これから』に出さない」ことと
 * 「お支払い方法は権限が無いので常に null (推測を出さない)」ことを守る。
 */

const NOW = new Date("2026-08-08T12:00:00.000Z");

describe("accountDisplayName", () => {
  it("姓名を結合する", () => {
    expect(accountDisplayName({ firstName: "結城", lastName: "彩" })).toBe("結城 彩");
  });

  it("両方無いときは null (「さん」だけの挨拶を作らない)", () => {
    expect(accountDisplayName({ firstName: null, lastName: null })).toBeNull();
    expect(accountDisplayName({ firstName: "  ", lastName: null })).toBeNull();
  });
});

describe("buildUpcoming (これから)", () => {
  const subscription = (over: Record<string, unknown> = {}) => ({
    id: "gid://shopify/SubscriptionContract/1",
    status: "ACTIVE",
    nextBillingDate: "2026-08-20T00:00:00.000Z",
    lines: { edges: [{ node: { title: "深蒸し煎茶「やまかげ」" } }] },
    ...over,
  });

  it("次回請求日のある契約を定期便カードにする", () => {
    const [card] = buildUpcoming({ subscriptions: [subscription()], events: [], now: NOW });
    expect(card).toMatchObject({
      kind: "subscription",
      date: "2026-08-20T00:00:00.000Z",
      title: "深蒸し煎茶「やまかげ」",
      href: "/account/subscriptions",
    });
  });

  it("解約済み・次回請求日なし・過去日付は出さない", () => {
    const result = buildUpcoming({
      subscriptions: [
        subscription({ status: "CANCELLED" }),
        subscription({ id: "x", nextBillingDate: null }),
        subscription({ id: "y", nextBillingDate: "2026-01-01T00:00:00.000Z" }),
      ],
      events: [],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("これから開催のイベントだけを混ぜ、日付昇順に並べる", () => {
    const result = buildUpcoming({
      subscriptions: [subscription()],
      events: [
        { id: "e-past", eventSlug: "past", eventTitle: "終わった会", eventDate: "2026-07-01T00:00:00.000Z" },
        { id: "e-1", eventSlug: "nomikurabe", eventTitle: "火入れの飲みくらべ会", eventDate: "2026-09-02T00:00:00.000Z" },
        { id: "e-2", eventSlug: "ochakai", eventTitle: "秋のお茶会", eventDate: "2026-08-14T00:00:00.000Z" },
      ],
      now: NOW,
    });

    expect(result.map((r) => r.title)).toEqual([
      "秋のお茶会",
      "深蒸し煎茶「やまかげ」",
      "火入れの飲みくらべ会",
    ]);
    expect(result[0]?.href).toBe("/events/ochakai");
  });

  it("題名の無いイベント (壊れたドキュメント) は落とす", () => {
    const result = buildUpcoming({
      subscriptions: [],
      events: [{ id: "e", eventSlug: "s", eventTitle: null, eventDate: "2026-09-02T00:00:00.000Z" }],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("確定版 1 行分 (3 枚) までに切る", () => {
    const events = Array.from({ length: 6 }, (_, i) => ({
      id: `e-${i}`,
      eventSlug: `s-${i}`,
      eventTitle: `会 ${i}`,
      eventDate: `2026-09-0${i + 1}T00:00:00.000Z`,
    }));
    expect(buildUpcoming({ subscriptions: [], events, now: NOW })).toHaveLength(
      ACCOUNT_UPCOMING_LIMIT
    );
  });
});

describe("buildPast (これまで = 注文履歴)", () => {
  const order = (name: string, processedAt: string, amount = "6000") => ({
    node: {
      id: `gid://shopify/Order/${name}`,
      name,
      processedAt,
      totalPrice: { amount, currencyCode: "JPY" },
    },
  });

  it("新しい順に並べ、金額の素材を持つ", () => {
    const result = buildPast({
      orders: {
        edges: [
          order("#1018", "2026-05-24T00:00:00.000Z", "2400"),
          order("#1042", "2026-07-06T00:00:00.000Z", "4200"),
        ],
      },
    });
    expect(result.map((r) => r.title)).toEqual(["#1042", "#1018"]);
    expect(result[0]?.amount).toEqual({ value: "4200", currencyCode: "JPY" });
    expect(result[0]?.kind).toBe("order");
  });

  it("注文が無ければ空 (節ごと出さない判断はページ側)", () => {
    expect(buildPast({})).toEqual([]);
    expect(buildPast({ orders: { edges: [] } })).toEqual([]);
  });

  it("確定版 1 行分 (3 枚) までに切る", () => {
    const edges = Array.from({ length: 7 }, (_, i) =>
      order(`#10${i}`, `2026-0${i + 1}-01T00:00:00.000Z`)
    );
    expect(buildPast({ orders: { edges } })).toHaveLength(ACCOUNT_PAST_LIMIT);
  });
});

describe("buildAccountView", () => {
  it("お支払い方法は常に null (read_customer_payment_methods 未付与のため推測しない)", () => {
    const view = buildAccountView({
      customer: {
        firstName: "結城",
        lastName: null,
        emailAddress: { emailAddress: "yuki@example.com" },
        orders: { edges: [] },
      },
      now: NOW,
    });

    expect(view.paymentMethod).toBeNull();
    expect(view.seeded).toBe(false);
    expect(view.email).toBe("yuki@example.com");
    expect(view.displayName).toBe("結城");
  });
});

describe("formatRecordDate", () => {
  /* 年を出すのは Figma (「8月20日(木)」) からの意図的な逸脱。注文履歴は何年でも
     遡るので、年が無いと 2 年前の注文が今年の注文に見える (実測 2026-08-25)。 */
  it("年つきの「2026年8月20日(木)」形にする", () => {
    expect(formatRecordDate("2026-08-20T00:00:00.000Z", "ja")).toBe("2026年8月20日(木)");
  });

  it("何年前の記録でも年で見分けが付く", () => {
    expect(formatRecordDate("2024-03-21T01:28:32.000Z", "ja")).toBe("2024年3月21日(木)");
  });

  it("日付が無い・壊れているときは null", () => {
    expect(formatRecordDate(null, "ja")).toBeNull();
    expect(formatRecordDate("not-a-date", "ja")).toBeNull();
  });
});

describe("送信専用アドレスは識別子として出さない", () => {
  it("no-reply 系はメール欄を空にする (表示名に落ちる)", () => {
    const view = buildAccountView({
      customer: {
        firstName: "世堅",
        lastName: "温",
        emailAddress: { emailAddress: "no-reply@elxea.com" },
      },
    });

    expect(view.email).toBeNull();
    expect(view.displayName).toBe("世堅 温");
  });

  it("本人のアドレスはそのまま残す", () => {
    const view = buildAccountView({
      customer: { emailAddress: { emailAddress: "yuki@example.com" } },
    });

    expect(view.email).toBe("yuki@example.com");
  });

  it("大文字・別綴りの送信専用アドレスも落とす", () => {
    for (const email of ["NoReply@example.com", "do-not-reply@example.jp"]) {
      expect(isPlaceholderEmail(email)).toBe(true);
    }
    expect(isPlaceholderEmail("noreplytea@example.com")).toBe(false);
  });
});

describe("返金済みの注文を ¥0 と言い切らない", () => {
  const order = (financialStatus: string, amount: string) => ({
    orders: {
      edges: [
        {
          node: {
            id: `gid://order/${financialStatus}`,
            name: "#1027",
            processedAt: "2024-03-21T01:28:32.000Z",
            financialStatus,
            totalPrice: { amount, currencyCode: "JPY" },
          },
        },
      ],
    },
  });

  it("全額返金は refunded", () => {
    expect(buildPast(order("REFUNDED", "0.0"))[0].status).toBe("refunded");
  });

  it("無効・期限切れは voided", () => {
    expect(buildPast(order("VOIDED", "0.0"))[0].status).toBe("voided");
    expect(buildPast(order("EXPIRED", "0.0"))[0].status).toBe("voided");
  });

  it("一部返金は partiallyRefunded (金額と併記する)", () => {
    const record = buildPast(order("PARTIALLY_REFUNDED", "1200.0"))[0];
    expect(record.status).toBe("partiallyRefunded");
    expect(record.amount).toEqual({ value: "1200.0", currencyCode: "JPY" });
  });

  it("通常の入金済みは状態を持たない (金額だけ出す)", () => {
    expect(buildPast(order("PAID", "1598.0"))[0].status).toBeNull();
  });
});

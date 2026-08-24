import { describe, expect, it } from "vitest";

import {
  ACCOUNT_CONTINUE_LIMIT,
  ACCOUNT_PAST_LIMIT,
  ACCOUNT_UPCOMING_LIMIT,
  accountDisplayName,
  buildAccountView,
  buildContinueItems,
  buildPast,
  buildUpcoming,
  formatRecordDate,
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

describe("buildContinueItems (続き)", () => {
  it("記事を先に、商品を後にする", () => {
    const result = buildContinueItems([
      { id: "f1", type: "product", targetId: "sencha-akane", title: "煎茶 茜", imageUrl: "/a.jpg" },
      { id: "f2", type: "article", targetId: "hiire", title: "火入れという時間のかけ方", imageUrl: null },
    ]);
    expect(result.map((r) => r.kind)).toEqual(["article", "product"]);
    expect(result[0]?.href).toBe("/journal/hiire");
    expect(result[1]?.href).toBe("/products/sencha-akane");
  });

  it("題名なし・未知の type は落とす", () => {
    expect(
      buildContinueItems([
        { id: "f1", type: "article", targetId: "x", title: null },
        { id: "f2", type: "farmer", targetId: "y", title: "農家" },
      ])
    ).toEqual([]);
  });

  it("抜粋の枚数までに切る (残りは /account/favorites が受ける)", () => {
    const favorites = Array.from({ length: ACCOUNT_CONTINUE_LIMIT + 3 }, (_, i) => ({
      id: `f-${i}`,
      type: "article",
      targetId: `t-${i}`,
      title: `記事 ${i}`,
    }));
    expect(buildContinueItems(favorites)).toHaveLength(ACCOUNT_CONTINUE_LIMIT);
  });

  it("抜粋は 1 行 (2 枚) より多い — 「入れたのに見当たらない」を作らない", () => {
    expect(ACCOUNT_CONTINUE_LIMIT).toBeGreaterThan(2);
  });

  /**
   * 種類が 3 つになった時点 (F4 で人を追加) の回帰。
   *
   * 「優先順位の高い種類から順に 6 枚で打ち切る」だけだと、持っている件数が
   * 多い種類が枠を食い尽くし、後ろの種類が **1 枚も出ない**。お客さまからは
   * 「商品のお気に入りが消えた」に見え、種類が増えるたびに末尾が黙って落ちる。
   */
  it("持っているどの種類も 1 枚は出る (後ろの種類が枠を食われて消えない)", () => {
    const favorites = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `a-${i}`,
        type: "article",
        targetId: `a-${i}`,
        title: `記事 ${i}`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `pe-${i}`,
        type: "person",
        targetId: `pe-${i}`,
        title: `人 ${i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `pr-${i}`,
        type: "product",
        targetId: `pr-${i}`,
        title: `商品 ${i}`,
      })),
    ];

    const result = buildContinueItems(favorites);

    expect(result).toHaveLength(ACCOUNT_CONTINUE_LIMIT);
    for (const kind of ["article", "person", "product"]) {
      expect(result.filter((item) => item.kind === kind).length, kind).toBeGreaterThan(0);
    }
    // 描く順は種類ごとにまとまったまま (混ぜて時系列に並べない)。
    expect(result.map((item) => item.kind)).toEqual([
      ...result.map((item) => item.kind).filter((kind) => kind === "article"),
      ...result.map((item) => item.kind).filter((kind) => kind === "person"),
      ...result.map((item) => item.kind).filter((kind) => kind === "product"),
    ]);
  });

  it("1 種類しか持っていない人の見え方は変わらない (余った枠は前へ回る)", () => {
    const favorites = Array.from({ length: 10 }, (_, i) => ({
      id: `a-${i}`,
      type: "article",
      targetId: `a-${i}`,
      title: `記事 ${i}`,
    }));

    const result = buildContinueItems(favorites);

    expect(result).toHaveLength(ACCOUNT_CONTINUE_LIMIT);
    expect(result.every((item) => item.kind === "article")).toBe(true);
    expect(result.map((item) => item.id)).toEqual(["a-0", "a-1", "a-2", "a-3", "a-4", "a-5"]);
  });

  it("人はその人のページへ飛ぶ", () => {
    const [item] = buildContinueItems([
      { id: "pe1", type: "person", targetId: "masayuki-kubo", title: "久保 雅之" },
    ]);
    expect(item).toMatchObject({ kind: "person", href: "/people/masayuki-kubo" });
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
  it("確定版のカード 1 行目と同じ「8月20日(木)」形にする", () => {
    expect(formatRecordDate("2026-08-20T00:00:00.000Z", "ja")).toBe("8月20日(木)");
  });

  it("日付が無い・壊れているときは null", () => {
    expect(formatRecordDate(null, "ja")).toBeNull();
    expect(formatRecordDate("not-a-date", "ja")).toBeNull();
  });
});

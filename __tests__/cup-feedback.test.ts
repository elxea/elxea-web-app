/**
 * 顧客プロファイル 第1段 の語彙と写しを固定する（① / ⑤ / ⑥ / ⑦）。
 *
 * ## なぜ値を 1 件ずつ書くのか
 *
 * `lib/cdp/cup-feedback.ts` は cx-agent `src/lib/cdp/event-vocabulary.ts` の
 * **写し**である（型名・`RATING_ASPECTS`・`PURCHASE_SCENES`）。片方だけ変わると
 * 出来事が `schema_ok = false` になり、L0 には残るのに L1 に入らない — つまり
 * **画面は成功したように見えて、見立てが一切動かない**という、いちばん気づきにくい
 * 壊れ方をする。だから値をここに書き写して、黙って変わったら落ちるようにする
 * （`lib/cdp/diagnosis.ts` と `__tests__/cdp-diagnosis.test.ts` と同じ作法）。
 *
 * ## R2（数値・星を見せない）を機械で見張る
 *
 * 択一 #4 の確定条件は「スコアは内部利用のみ・お客さんには星も数値も見せない」。
 * 「気をつける」で守るものではないので、**画面に出る言葉に数字や星が混ざっていない
 * こと**をここで検査する。i18n の文言まで見る。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CUP_ASPECTS,
  CUP_VERDICTS,
  CUP_VERDICT_LABEL_KEYS,
  CUP_VERDICT_SCORES,
  PURCHASE_SCENES,
  SAFETY_TAGS,
  asksAspect,
  isCupAspect,
  isCupVerdict,
  isProductNo,
  isPurchaseScene,
  isSafetyTag,
  jstDay,
  toFeedbackDeclinedGatewayEvent,
  toFeedbackShownGatewayEvent,
  toRatingGatewayEvent,
  toRecipientGatewayEvent,
  toSafetyGatewayEvent,
  verdictScore,
} from "@/lib/cdp/cup-feedback";
import {
  CupFeedbackBodySchema,
  PurchaseRecipientBodySchema,
  SafetyDeclarationBodySchema,
} from "@/lib/validation/profile-schema";

const SUBJECT = { kind: "shopify_customer_id", value: "7654321" };
const AT = "2026-09-01T02:03:04.000Z";

describe("語彙 — cx-agent の写しであることの固定", () => {
  it("5 段階は合う側から合わない側へ並ぶ", () => {
    expect(CUP_VERDICTS).toEqual(["great", "good", "neutral", "slightMiss", "miss"]);
  });

  it("語 → 1-5 の対応は等間隔で、5 がいちばん合った側", () => {
    expect(CUP_VERDICT_SCORES).toEqual({
      great: 5,
      good: 4,
      neutral: 3,
      slightMiss: 2,
      miss: 1,
    });
    /* cx-agent `isRatingPayload` が受けるのは 1-5 の整数だけ。 */
    for (const verdict of CUP_VERDICTS) {
      const score = verdictScore(verdict);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(5);
    }
  });

  it("「どこが」の 4 択は cx-agent RATING_ASPECTS と同じ", () => {
    expect(CUP_ASPECTS).toEqual(["aroma", "strength", "aftertaste", "amount"]);
  });

  it("「誰のために」は 2 値に閉じている", () => {
    expect(PURCHASE_SCENES).toEqual(["self", "gift"]);
  });

  it("安全申告は 3 区分に閉じている", () => {
    expect(SAFETY_TAGS).toEqual(["caffeine", "pregnancy", "allergy"]);
  });

  it("型ガードは語彙の外を通さない", () => {
    expect(isCupVerdict("great")).toBe(true);
    expect(isCupVerdict("excellent")).toBe(false);
    expect(isCupAspect("aroma")).toBe(true);
    expect(isCupAspect("price")).toBe(false);
    expect(isPurchaseScene("gift")).toBe(true);
    expect(isPurchaseScene("both")).toBe(false);
    expect(isSafetyTag("allergy")).toBe(true);
    expect(isSafetyTag("insomnia")).toBe(false);
    expect(isProductNo("10101")).toBe(true);
    expect(isProductNo("1010")).toBe(false);
    expect(isProductNo(10101)).toBe(false);
  });

  it("「どこが」を聞くのは合わなかった側だけ", () => {
    expect(asksAspect("great")).toBe(false);
    expect(asksAspect("good")).toBe(false);
    expect(asksAspect("neutral")).toBe(false);
    expect(asksAspect("slightMiss")).toBe(true);
    expect(asksAspect("miss")).toBe(true);
  });
});

describe("R2 — 画面に数値・星・順位を出さない（択一 #4 の確定条件）", () => {
  const messages = ["ja", "en"].map((locale) => ({
    locale,
    body: JSON.parse(
      readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    ) as Record<string, Record<string, string>>,
  }));

  it("5 段階の文言に数字も星も入っていない", () => {
    for (const { locale, body } of messages) {
      for (const verdict of CUP_VERDICTS) {
        const key = CUP_VERDICT_LABEL_KEYS[verdict];
        const label = body.thisMonth?.[key];
        expect(label, `${locale}: thisMonth.${key} が無い`).toBeTypeOf("string");
        expect(label, `${locale}: ${key} に数字が入っている`).not.toMatch(/[0-9０-９]/);
        expect(label, `${locale}: ${key} に星が入っている`).not.toMatch(/[★☆*]/);
      }
    }
  });

  it("ja と en で thisMonth / safety のキーがそろっている", () => {
    const [ja, en] = messages;
    for (const namespace of ["thisMonth", "safety"] as const) {
      expect(Object.keys(ja.body[namespace]).sort()).toEqual(
        Object.keys(en.body[namespace]).sort(),
      );
    }
  });
});

describe("L0 への写し", () => {
  it("評価は rating.submitted になり、payload に 1-5 の score が入る", () => {
    const event = toRatingGatewayEvent(
      SUBJECT,
      { productNo: "10101", verdict: "slightMiss", aspect: "aroma", deliveryRef: "issue-01" },
      AT,
    );
    expect(event.event_type).toBe("rating.submitted");
    expect(event.channel).toBe("web");
    expect(event.dedupe).toBe(`10101@${AT}`);
    expect(event.source).toBe("web-app.cup-feedback");
    expect(event.payload).toEqual({
      product_no: "10101",
      score: 2,
      aspect: "aroma",
      delivery_ref: "issue-01",
    });
  });

  it("「どこが」を答えなければ aspect は payload に現れない", () => {
    const event = toRatingGatewayEvent(SUBJECT, { productNo: "10101", verdict: "great" }, AT);
    expect(event.payload).toEqual({ product_no: "10101", score: 5 });
  });

  it("誰のためには 1 注文 1 回の冪等キーになる", () => {
    const event = toRecipientGatewayEvent(SUBJECT, { orderRef: "5551234", scene: "gift" }, AT);
    expect(event.event_type).toBe("purchase.recipient_declared");
    expect(event.dedupe).toBe("order:5551234");
    expect(event.payload).toEqual({ scene: "gift", order_ref: "5551234" });
    /* 時刻が違っても同じ鍵 = 2 回目は gateway が落とす。 */
    expect(
      toRecipientGatewayEvent(SUBJECT, { orderRef: "5551234", scene: "self" }, "2026-10-01T00:00:00.000Z")
        .dedupe,
    ).toBe(event.dedupe);
  });

  it("安全申告は tags を並べ替えて 1 件にまとめる", () => {
    const event = toSafetyGatewayEvent(SUBJECT, ["pregnancy", "caffeine"], AT);
    expect(event.event_type).toBe("safety.declared");
    expect(event.payload).toEqual({ tags: ["caffeine", "pregnancy"] });
  });

  it("「出した」は 1 人 × 1 号 × 1 日で 1 行に畳まれる", () => {
    const a = toFeedbackShownGatewayEvent(
      SUBJECT,
      { issueRef: "issue-01", productNos: ["10101", "10201"], day: "2026-09-01" },
      AT,
    );
    const b = toFeedbackShownGatewayEvent(
      SUBJECT,
      { issueRef: "issue-01", productNos: ["10201", "10101"], day: "2026-09-01" },
      "2026-09-01T23:00:00.000Z",
    );
    expect(a.event_type).toBe("flow.feedback_shown");
    expect(a.dedupe).toBe(b.dedupe);
  });

  it("「いまは答えない」は評価ではなくフローとして積む", () => {
    const event = toFeedbackDeclinedGatewayEvent(SUBJECT, "10101", AT);
    /* L1 が畳むのは PROFILE_EVENT_TYPES だけ。flow.* は畳まれないので、
       無回答が見立てを動かすことは構造的に起きない。 */
    expect(event.event_type).toBe("flow.survey_decline");
    expect(event.event_type.startsWith("flow.")).toBe(true);
    expect(event.payload).toEqual({ product_no: "10101" });
  });

  it("payload に生の識別子も自由文も入らない", () => {
    const events = [
      toRatingGatewayEvent(SUBJECT, { productNo: "10101", verdict: "good" }, AT),
      toRecipientGatewayEvent(SUBJECT, { orderRef: "555", scene: "self" }, AT),
      toSafetyGatewayEvent(SUBJECT, ["allergy"], AT),
    ];
    for (const event of events) {
      const serialized = JSON.stringify(event.payload);
      expect(serialized).not.toContain(SUBJECT.value);
      expect(serialized).not.toMatch(/@[a-z]+\./i);
    }
  });

  it("JST の暦日は日付境界をまたいでも正しい", () => {
    /* UTC 2026-08-31T15:00Z = JST 2026-09-01T00:00 */
    expect(jstDay(new Date("2026-08-31T15:00:00.000Z"))).toBe("2026-09-01");
    expect(jstDay(new Date("2026-08-31T14:59:59.000Z"))).toBe("2026-08-31");
  });
});

describe("受け口の形 — 自由文を受ける項目が無い", () => {
  it("評価は語だけを受け、数値は受け付けない", () => {
    expect(
      CupFeedbackBodySchema.safeParse({
        productNo: "10101",
        issueRef: "issue-01",
        verdict: "great",
      }).success,
    ).toBe(true);
    /* 送り手に数値を持たせない（R2 を「持っていない」で守る）。 */
    expect(
      CupFeedbackBodySchema.safeParse({ productNo: "10101", issueRef: "issue-01", score: 5 })
        .success,
    ).toBe(false);
    /* 自由文は受け口の形として存在しない。 */
    expect(
      CupFeedbackBodySchema.safeParse({
        productNo: "10101",
        issueRef: "issue-01",
        verdict: "miss",
        comment: "苦手でした",
      }).success,
    ).toBe(false);
  });

  it("「いまは答えない」と評価は同時に送れない", () => {
    expect(
      CupFeedbackBodySchema.safeParse({
        productNo: "10101",
        issueRef: "issue-01",
        verdict: "great",
        decline: true,
      }).success,
    ).toBe(false);
  });

  it("銘柄番号は 5 桁でなければ弾く", () => {
    expect(
      CupFeedbackBodySchema.safeParse({ productNo: "abc", issueRef: "i", verdict: "good" })
        .success,
    ).toBe(false);
  });

  it("誰のためには語彙の外を弾く", () => {
    expect(PurchaseRecipientBodySchema.safeParse({ orderId: "555", scene: "self" }).success).toBe(
      true,
    );
    expect(PurchaseRecipientBodySchema.safeParse({ orderId: "555", scene: "both" }).success).toBe(
      false,
    );
  });

  it("安全申告は明示同意が無ければ受け口の形として成立しない", () => {
    expect(
      SafetyDeclarationBodySchema.safeParse({ tags: ["caffeine"], consent: true }).success,
    ).toBe(true);
    expect(SafetyDeclarationBodySchema.safeParse({ tags: ["caffeine"] }).success).toBe(false);
    expect(
      SafetyDeclarationBodySchema.safeParse({ tags: ["caffeine"], consent: false }).success,
    ).toBe(false);
    /* 自由記入は受け付けない（要配慮情報が書かれうる欄を作らない）。 */
    expect(
      SafetyDeclarationBodySchema.safeParse({
        tags: ["allergy"],
        consent: true,
        note: "そばアレルギー",
      }).success,
    ).toBe(false);
  });
});

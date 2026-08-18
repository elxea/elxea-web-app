/**
 * 定期便で使える決済手段が、サイト内で 1 通りに保たれているかの回帰テスト。
 *
 * ## なぜ必要か
 *
 * 「定期便でどの決済手段が使えるか」は特定商取引法 第11条2号の表示事項で、
 * **単発販売の一覧を流用すると不実表示になる**。単発では使えるコンビニ決済・
 * 銀行振込・代金引換 (`Cash on Delivery (COD)`) や KOMOJU 経由の楽天ペイ・
 * スマホ決済は、Shopify の定期便が請求先として保管 (`customerPaymentMethod`)
 * できないため、定期便では使えない。
 *
 * 2026-08-11 の実測前は、定期便LP の FAQ が Apple Pay / Google Pay まで
 * 「対応しています」と書いており、特商法ページに書く内容と食い違う状態だった。
 * 文字列が messages とページに分散する構造なので、直しても再発する。よって
 * 「確定値以外の言い方が混ざったら落ちる」テストで機械的に固定する。
 *
 * 確定値 (2026-08-11 実測): **クレジットカード（Visa、Mastercard、American Express、JCB）のみ**。
 * 実測の内訳は `lib/placeholders.ts` の `tokushoho.subscriptionPaymentMethods` の `basis`。
 *
 * Apple Pay / Google Pay を書かないのは「使えないから」ではない。Shopify 公式
 * ドキュメント (https://help.shopify.com/en/manual/products/purchase-options/subscriptions/considerations
 * 2026-08-11 取得) は Shopify Payments 利用時について "Customers can use accelerated
 * checkouts, such as Shop Pay, Apple Pay, Google Pay, or PayPal, to purchase
 * subscriptions" と明記しており、当店は shopify_payments 稼働なので使える見込みが高い。
 *
 * それでも表記に出さないのは、ウォレットで契約しても保管される instrument は
 * クレジットカードだから (実在契約の `CustomerCreditCard` と整合)。カードブランドに
 * 統一した方が実体に忠実で、ウォレット名を並べると "Apple Pay support for subscriptions
 * is limited to Visa and Mastercard" (同 doc) の但し書きが要り、かえって読み手を誤らせる。
 * このテストが守るのは「使える手段を漏れなく列挙すること」ではなく
 * **表記をカードブランドの 1 通りに保つこと**。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLACEHOLDERS, placeholderValue } from "@/lib/placeholders";

const ROOT = join(__dirname, "..");

const read = (relative: string) => readFileSync(join(ROOT, relative), "utf-8");

/** 定期便の決済手段を書いてよい唯一の言い方 (特商法ページに差し込む値そのもの)。 */
const CONFIRMED = "クレジットカード（Visa、Mastercard、American Express、JCB）のみ";

/** 4 ブランド。どの面でも過不足なくこの並びで出す。 */
const BRANDS = ["Visa", "Mastercard", "American Express", "JCB"] as const;

/** 定期便の決済手段を語る面。 */
const SUBSCRIPTION_PAYMENT_SURFACES = ["messages/ja.json", "messages/en.json"] as const;

/**
 * 定期便の決済手段の回答に出してはいけない語。理由は 2 系統ある。
 *
 * (a) **この店舗の定期便では実際に使えない手段** — コンビニ決済・銀行振込・代金引換・
 *     楽天ペイは Shopify の `customerPaymentMethod` として保管できず
 *     `subscriptionBillingAttempt` の請求先にならない。PayPal は PayPal Express
 *     ゲートウェイが未有効 (2026-08-11 実測)。書けば不実表示になる。
 * (b) **使えるが表記に出さない手段** — Apple Pay / Google Pay。理由は冒頭の注記のとおりで、
 *     使えないからではなく、表記をカードブランドに統一するため。
 *
 * 単発販売の記載 (特商法ページ 群 I) には (a) が出てよいので、検査対象は
 * 「定期便の決済手段を答えている FAQ の値」だけに絞る。
 */
const MUST_NOT_APPEAR_IN_SUBSCRIPTION_COPY = [
  "Apple Pay",
  "Google Pay",
  "コンビニ",
  "銀行振込",
  "代金引換",
  "楽天ペイ",
  "PayPal",
] as const;

describe("定期便の決済手段の統一", () => {
  it("レジストリの値が実測どおり確定している", () => {
    const entry = PLACEHOLDERS["tokushoho.subscriptionPaymentMethods"];
    expect(entry.status, "実測で確定済みのはず").toBe("confirmed");
    expect(placeholderValue("tokushoho.subscriptionPaymentMethods")).toBe(CONFIRMED);
  });

  it("4 ブランドを過不足なく持つ", () => {
    const value = placeholderValue("tokushoho.subscriptionPaymentMethods");
    for (const brand of BRANDS) {
      expect(value, `${brand} が欠けている`).toContain(brand);
    }
    // 「のみ」を落とすと、単発販売の手段も使えると読める
    expect(value, "限定の明示 (のみ) が必要").toContain("のみ");
  });

  it("特商法ページが値を直書きせずレジストリから読んでいる", () => {
    const page = read("app/[locale]/legal/tokushoho/page.tsx");
    expect(page).toContain('placeholderValue("tokushoho.subscriptionPaymentMethods")');
    expect(page, "IV-4 の文面に値を直書きしない").not.toContain(CONFIRMED);
  });

  it("特商法ページ IV-4 が定期便で使えない手段を明示している", () => {
    // 群 I (単発販売) にコンビニ決済・銀行振込・代金引換が並ぶため、除外を書かないと
    // 「定期便でも同じ手段が使える」と読める。
    const page = read("app/[locale]/legal/tokushoho/page.tsx");
    expect(page).toContain("定期便ではご利用いただけません");
  });

  it.each(SUBSCRIPTION_PAYMENT_SURFACES)(
    "%s の定期便 FAQ が確定値と同じブランドを出している",
    (relative) => {
      const catalog = JSON.parse(read(relative));
      // 実際に描画されている名前空間は `subscriptionR2`
      // (`app/[locale]/subscription/page.tsx` / `app/[locale]/page.tsx`)。
      // `subscriptionLp` は旧カタログだが、残っている以上は同じ基準に揃える。
      const answers = [catalog.subscriptionR2.faqA2, catalog.subscriptionLp.faqA6];
      for (const answer of answers) {
        for (const brand of BRANDS) {
          expect(answer, `${relative}: ${brand} が欠けている`).toContain(brand);
        }
      }
    }
  );

  it.each(SUBSCRIPTION_PAYMENT_SURFACES)(
    "%s の定期便 FAQ にカードブランド以外の手段名が出ていない",
    (relative) => {
      const catalog = JSON.parse(read(relative));
      const answers = [catalog.subscriptionR2.faqA2, catalog.subscriptionLp.faqA6];
      for (const answer of answers) {
        const found = MUST_NOT_APPEAR_IN_SUBSCRIPTION_COPY.filter((method) =>
          answer.includes(method)
        );
        expect(found, `${relative}: 表記がカードブランドに統一されていない`).toEqual([]);
      }
    }
  );
});

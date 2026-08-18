/**
 * 定期便LP の月額表示を Shopify の実データから導出する純関数群。
 *
 * ## なぜ定数を置かないのか
 *
 * 月額は以前 `lib/placeholders.ts` の仮当て値 (定数) だった。定数は Shopify 側で
 * 価格を変えても画面に反映されず、しかも「画面の数字」と「決済される金額」が
 * 食い違うため、表示価格の不当表示に直結する。よって SoT は Shopify の
 * selling plan だけとし、本モジュールが `Product` から表示文字列を導出する。
 *
 * ## どのプランの価格を出すのか
 *
 * 「毎月お届け」プランを**プラン名ではなく配送間隔** (`deliveryPolicy.interval = MONTH`
 * かつ `intervalCount = 1`) で特定する。プラン名は店舗側で自由に変えられるので
 * 表示値の導出根拠にできない。該当プランが無ければ `null` を返す (推測しない)。
 *
 * 該当が **2 件以上** あるとどれの価格を出すかを配送間隔だけでは決められない。
 * 表示は出現順の先頭で据え置き (画面を空にする方が損失が大きい) にしつつ、
 * Sentry へ warning を上げて曖昧さを可視化する。無警告で先頭を採ると、店舗側が
 * 毎月プランを増やした瞬間に「意図しないプランの価格が出ている」ことに誰も
 * 気づけない (表示価格の不当表示に直結する)。
 *
 * ## 初回価格と継続価格
 *
 * Shopify の `sellingPlanAllocations.priceAdjustments` は請求サイクルごとの調整の
 * 配列で、初回特別価格が設定されている商品では
 * `[0] = 初回` / `[末尾] = 2 回目以降 (継続)` になる。LP の「月額」は毎月払い続ける
 * 金額なので**継続価格**を出す。初回価格も併せて返し、両者が異なる事実を
 * 呼び出し側が扱えるようにしている (安い初回価格だけを月額として出すと誤認になる)。
 *
 * @see docs/placeholders.md 「差し替え一覧」#2
 */

import * as Sentry from "@sentry/nextjs";

import type { Money, Product } from "@/lib/shopify/types";

/** 毎月お届けと見なす配送間隔。 */
const MONTHLY_INTERVAL = "MONTH";
const MONTHLY_INTERVAL_COUNT = 1;

export type MonthlyPlanPricing = {
  /** 対象 selling plan の gid。 */
  readonly sellingPlanId: string;
  /** 初回請求分の 1 回あたり価格。 */
  readonly firstDeliveryPrice: Money;
  /** 2 回目以降 (継続) の 1 回あたり価格。初回特別価格が無ければ初回と同額。 */
  readonly recurringPrice: Money;
};

type ProductLike = Pick<Product, "sellingPlanGroups" | "variants">;

/**
 * 毎月お届けと見なせるプランの id を、出現順ですべて返す。
 *
 * 単発購入プラン (`deliveryPolicy` が固定日ポリシー) は `interval` を持たないため
 * 自然に除外される。
 *
 * 「先頭 1 件」ではなく全件を返すのは、該当が複数あるという事実を
 * {@link findMonthlySellingPlanId} が検知して警告できるようにするため。
 */
export function findMonthlySellingPlanIds(
  groups: ProductLike["sellingPlanGroups"]
): string[] {
  const ids: string[] = [];
  for (const group of groups) {
    for (const plan of group.sellingPlans) {
      const policy = plan.deliveryPolicy;
      if (!policy) continue;
      if (policy.interval === MONTHLY_INTERVAL && policy.intervalCount === MONTHLY_INTERVAL_COUNT) {
        ids.push(plan.id);
      }
    }
  }
  return ids;
}

/**
 * 毎月お届けプランの id。該当が無ければ `null`。
 *
 * 該当が複数あるときは**出現順の先頭**を返す (表示を止めない)。同時に Sentry へ
 * warning を上げ、「配送間隔だけではプランを一意に決められない状態」を運用側が
 * 検知できるようにする。ここで黙って先頭を採ると、店舗が毎月プランを増やしたときに
 * 意図しないプランの価格が表示され続けても誰も気づけない。
 */
export function findMonthlySellingPlanId(
  groups: ProductLike["sellingPlanGroups"]
): string | null {
  const ids = findMonthlySellingPlanIds(groups);
  if (ids.length === 0) return null;
  if (ids.length > 1) reportAmbiguousMonthlyPlans(ids);
  return ids[0];
}

/**
 * 毎月プランが複数該当したことを記録する。価格表示は変えない (観測だけ足す)。
 *
 * 意図的に de-dup していない。曖昧な状態が続く限り毎回上がるのが正しく、
 * 抑制すると「直ったのか、抑制されているだけか」が区別できなくなる。
 */
function reportAmbiguousMonthlyPlans(ids: readonly string[]): void {
  console.warn(
    `[subscription-pricing] 毎月お届けプランが ${ids.length} 件該当しました。先頭を採用します:`,
    ids
  );
  Sentry.captureMessage("Multiple monthly selling plans matched; first one was used", {
    level: "warning",
    tags: { module: "subscription-pricing" },
    extra: { matchedSellingPlanIds: [...ids], usedSellingPlanId: ids[0] },
  });
}

/**
 * 毎月お届けプランの初回 / 継続価格を Shopify の実データから導出する。
 *
 * 導出できない条件 (いずれも `null`):
 * - 毎月お届けプランが無い
 * - どの variant にも当該プランの allocation が無い
 * - allocation の価格調整が空
 */
export function resolveMonthlyPlanPricing(
  product: ProductLike | null | undefined
): MonthlyPlanPricing | null {
  if (!product) return null;

  const sellingPlanId = findMonthlySellingPlanId(product.sellingPlanGroups);
  if (!sellingPlanId) return null;

  for (const variant of product.variants) {
    const allocation = variant.sellingPlanAllocations.find(
      (candidate) => candidate.sellingPlan.id === sellingPlanId
    );
    if (!allocation) continue;

    const adjustments = allocation.priceAdjustments;
    if (adjustments.length === 0) continue;

    const first = adjustments[0].perDeliveryPrice;
    const recurring = adjustments[adjustments.length - 1].perDeliveryPrice;
    if (!first || !recurring) continue;

    return { sellingPlanId, firstDeliveryPrice: first, recurringPrice: recurring };
  }

  return null;
}

/**
 * 金額を日本語表記の文字列にする。JPY は「1,880円」、他通貨は通貨記号つき。
 *
 * 金額が数値として読めないときは `null` (壊れた文字列を画面に出さない)。
 */
export function formatMoneyJa(money: Money | null | undefined): string | null {
  if (!money) return null;
  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return null;

  if (money.currencyCode === "JPY") {
    // JPY は補助単位を持たないので整数に丸めて「円」を付ける。
    return `${Math.round(amount).toLocaleString("ja-JP")}円`;
  }

  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: money.currencyCode,
  }).format(amount);
}

/**
 * LP の「月額」に出す文字列。導出できないときは `null`。
 *
 * 返すのは**継続価格**。初回特別価格を月額として出すと、2 回目以降の請求額と
 * 表示が食い違う。
 */
export function monthlyPriceLabel(product: ProductLike | null | undefined): string | null {
  const pricing = resolveMonthlyPlanPricing(product);
  if (!pricing) return null;
  return formatMoneyJa(pricing.recurringPrice);
}

/**
 * 初回だけ価格が違うか (初回特別価格が設定されているか)。
 *
 * 表示上の注記を出すかどうかの判断に使う。
 */
export function hasFirstDeliveryDiscount(pricing: MonthlyPlanPricing | null): boolean {
  if (!pricing) return false;
  const first = Number(pricing.firstDeliveryPrice.amount);
  const recurring = Number(pricing.recurringPrice.amount);
  if (!Number.isFinite(first) || !Number.isFinite(recurring)) return false;
  return first !== recurring;
}

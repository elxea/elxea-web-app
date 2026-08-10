import type {
  AdminSellingPlanGroup,
  SellingPlanInterval,
} from "@/lib/shopify/admin-types";
import type { SubscriptionContract } from "@/lib/shopify/customer";

/**
 * 定期便管理【R2: 確定版】(Figma 6717:14526) の描画モデル。
 *
 * ここには **表示の決めごとだけ** を置く。Shopify への読み書き・所有者照合・
 * mutation は `lib/shopify/subscription-actions.ts` (C5-0 で確定) が持ち、
 * 本ファイルからは呼ばない。純粋関数だけなので単体テストできる。
 */

/** 画面が区別する 3 状態。Figma のカードもこの 3 種類 (契約中 / 一時停止中 / 解約済み)。 */
export type SubscriptionStatusKind = "active" | "paused" | "cancelled" | "other";

/**
 * Shopify の `SubscriptionContractSubscriptionStatus` を画面の 3 状態に畳む。
 *
 * Shopify 側は ACTIVE / PAUSED / CANCELLED / EXPIRED / FAILED / STALE を返す。
 * 確定版は「終わっている」ものを 1 種類 (解約済み) として扱うので、EXPIRED は
 * cancelled 側に寄せる。FAILED / STALE は「終わった」とも「動いている」とも
 * 断定できないため `other` にして操作ボタンを出さない (勝手に停止扱いしない)。
 */
export function subscriptionStatusKind(status: string): SubscriptionStatusKind {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "paused";
    case "CANCELLED":
    case "CANCELED":
    case "EXPIRED":
      return "cancelled";
    default:
      return "other";
  }
}

/** 状態バッジの i18n キー (messages の account.*)。 */
export function subscriptionStatusLabelKey(kind: SubscriptionStatusKind): string {
  switch (kind) {
    case "active":
      return "subscriptionActive";
    case "paused":
      return "subscriptionPaused";
    case "cancelled":
      return "subscriptionCancelled";
    default:
      return "subscriptionStatusUnknown";
  }
}

/** カード末尾の注記の i18n キー (Figma 6718:14905 / 6718:14920 ほか)。 */
export function subscriptionNoteKey(kind: SubscriptionStatusKind): string {
  switch (kind) {
    case "paused":
      return "subscriptionNotePaused";
    case "cancelled":
      return "subscriptionNoteCancelled";
    case "active":
      return "subscriptionNoteActive";
    default:
      return "subscriptionNoteUnknown";
  }
}

/** お届け頻度の単位キー。Shopify の interval は DAY / WEEK / MONTH / YEAR。 */
export function intervalLabelKey(interval: string): string {
  switch (interval.toUpperCase()) {
    case "WEEK":
      return "intervalWeek";
    case "DAY":
      return "intervalDay";
    case "YEAR":
      return "intervalYear";
    case "MONTH":
    default:
      return "intervalMonth";
  }
}

/**
 * 頻度変更の選択肢。
 *
 * 中身は **Shopify に実在する selling plan から導出** する
 * (`lib/subscription-frequencies.server.ts`)。画面側に並べる頻度をハードコード
 * すると、実在しないプラン (以前並んでいた毎週 / 隔週) を顧客に見せてしまい、
 * 選んだ時点で必ず失敗する経路ができるため、ここには「導出の仕組み」だけを置く。
 *
 * Figma 6719:14708 の chips は 5 個描かれているが、これは当時の想定で、
 * ストアの実プランは 3 個 (毎月 / 2ヶ月ごと / 3ヶ月ごと)。実データを正とする。
 */
export type FrequencyOption = {
  /** messages のキー (account.*)。 */
  labelKey: string;
  /** labelKey が {count} を取る汎用キーのときだけ渡す値。 */
  labelValues?: { count: number };
  interval: SellingPlanInterval;
  intervalCount: number;
};

/**
 * 実在プランに対して用意してある固有の訳文。ここに無い頻度 (Shopify に新しい
 * プランが増えたとき) は `intervalLabelKey` の汎用キー + {count} で描く。
 */
const CURATED_FREQUENCY_LABEL_KEYS: Record<string, string> = {
  "WEEK-1": "frequencyEveryWeek",
  "WEEK-2": "frequencyEvery2Weeks",
  "MONTH-1": "frequencyEveryMonth",
  "MONTH-2": "frequencyEvery2Months",
  "MONTH-3": "frequencyEvery3Months",
};

/** 選択肢の一意キー。labelKey は汎用キーだと重複しうるので描画 key には使わない。 */
export function frequencyOptionKey(option: {
  interval: string;
  intervalCount: number;
}): string {
  return `${option.interval}-${option.intervalCount}`;
}

/** interval + count 1 組を、訳文キー付きの選択肢に変換する。 */
export function toFrequencyOption(
  interval: SellingPlanInterval,
  intervalCount: number
): FrequencyOption {
  const curated = CURATED_FREQUENCY_LABEL_KEYS[`${interval}-${intervalCount}`];
  if (curated) return { labelKey: curated, interval, intervalCount };
  return {
    labelKey: intervalLabelKey(interval),
    labelValues: { count: intervalCount },
    interval,
    intervalCount,
  };
}

/**
 * Shopify に実在する 3 プラン。Admin API が読めないとき
 * (認証情報の無いローカル / preview ビルド / 一時的な失敗) のフォールバックで、
 * `__tests__/subscription-view.test.ts` が実プランに固定している。
 * プランが増減したらテストが落ち、ここを直すまで通らない。
 */
export const FALLBACK_FREQUENCY_OPTIONS: readonly FrequencyOption[] = [
  toFrequencyOption("MONTH", 1),
  toFrequencyOption("MONTH", 2),
  toFrequencyOption("MONTH", 3),
] as const;

const INTERVAL_ORDER: Record<SellingPlanInterval, number> = {
  DAY: 0,
  WEEK: 1,
  MONTH: 2,
  YEAR: 3,
};

/**
 * selling plan group から、重複を除いた「実在する頻度」を短い順に取り出す。
 * 純粋関数なので Shopify を叩かずに単体テストできる。
 */
export function deriveFrequencyOptions(
  groups: AdminSellingPlanGroup[]
): FrequencyOption[] {
  const seen = new Map<string, FrequencyOption>();

  for (const group of groups) {
    for (const plan of group.sellingPlans ?? []) {
      const policy = plan.deliveryPolicy;
      // 単発購入プランには recurring な deliveryPolicy が無い。
      if (!policy?.interval || typeof policy.intervalCount !== "number") continue;
      if (!Number.isInteger(policy.intervalCount) || policy.intervalCount < 1) continue;
      if (!(policy.interval in INTERVAL_ORDER)) continue;

      const option = toFrequencyOption(policy.interval, policy.intervalCount);
      const key = frequencyOptionKey(option);
      if (!seen.has(key)) seen.set(key, option);
    }
  }

  return [...seen.values()].sort(
    (a, b) =>
      INTERVAL_ORDER[a.interval] - INTERVAL_ORDER[b.interval] ||
      a.intervalCount - b.intervalCount
  );
}

/** いま契約している頻度と同じ選択肢か。大文字小文字の揺れを吸収する。 */
export function isSameFrequency(
  option: FrequencyOption,
  interval: string | undefined,
  intervalCount: number | undefined
): boolean {
  if (!interval || intervalCount === undefined) return false;
  return (
    option.interval === interval.toUpperCase() && option.intervalCount === intervalCount
  );
}

/**
 * 操作 (スキップ / 停止 / 再開 / 解約 / 頻度変更) を出してよい状態か。
 * 解約済みと判定不能 (other) では出さない。
 */
export function canManageSubscription(kind: SubscriptionStatusKind): boolean {
  return kind === "active" || kind === "paused";
}

/** 1 行分の商品表示 (Figma 6718:14894 / 6723:14801)。 */
export type SubscriptionLineView = {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: { amount: string; currencyCode: string };
  imageUrl: string | null;
  imageAlt: string | null;
};

/** 契約 1 件分の表示モデル。 */
export type SubscriptionCardView = {
  id: string;
  kind: SubscriptionStatusKind;
  rawStatus: string;
  nextBillingDate: string | null;
  interval: string;
  intervalCount: number;
  lines: SubscriptionLineView[];
};

/**
 * Shopify の契約を表示モデルに畳む。GraphQL の edges/node をここで剥がして、
 * 画面側 (server component / client component) はどちらも同じ形だけを見る。
 */
export function toSubscriptionCardView(
  contract: SubscriptionContract
): SubscriptionCardView {
  return {
    id: contract.id,
    kind: subscriptionStatusKind(contract.status),
    rawStatus: contract.status,
    nextBillingDate: contract.nextBillingDate,
    interval: contract.deliveryPolicy.interval,
    intervalCount: contract.deliveryPolicy.intervalCount.count,
    lines: (contract.lines?.edges ?? []).map(({ node }) => ({
      id: node.id,
      title: node.title,
      variantTitle: node.variantTitle,
      quantity: node.quantity,
      price: node.currentPrice,
      imageUrl: node.variantImage?.url ?? null,
      imageAlt: node.variantImage?.altText ?? null,
    })),
  };
}

/**
 * 一覧の並び。確定版は「動いているもの → 止まっているもの → 終わったもの」の順
 * (Figma 6717:14572 が 契約中 → 一時停止中 → 解約済み で並んでいる)。
 * 同じ状態のなかでは次回お届け日が近い順、日付が無いものは後ろ。
 */
const KIND_ORDER: Record<SubscriptionStatusKind, number> = {
  active: 0,
  paused: 1,
  other: 2,
  cancelled: 3,
};

export function sortSubscriptionCards(
  cards: SubscriptionCardView[]
): SubscriptionCardView[] {
  return [...cards].sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    if (a.nextBillingDate && b.nextBillingDate) {
      return a.nextBillingDate.localeCompare(b.nextBillingDate);
    }
    if (a.nextBillingDate) return -1;
    if (b.nextBillingDate) return 1;
    return 0;
  });
}

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
 * 頻度変更の選択肢 (Figma 6719:14708 の chips 5 個と同じ順序・同じ内容)。
 * 毎週 / 隔週 / 毎月 / 隔月 / 3ヶ月ごと。
 */
export type FrequencyOption = {
  /** messages のキー (account.frequency*)。 */
  labelKey: string;
  interval: "WEEK" | "MONTH";
  intervalCount: number;
};

export const FREQUENCY_OPTIONS: readonly FrequencyOption[] = [
  { labelKey: "frequencyEveryWeek", interval: "WEEK", intervalCount: 1 },
  { labelKey: "frequencyEvery2Weeks", interval: "WEEK", intervalCount: 2 },
  { labelKey: "frequencyEveryMonth", interval: "MONTH", intervalCount: 1 },
  { labelKey: "frequencyEvery2Months", interval: "MONTH", intervalCount: 2 },
  { labelKey: "frequencyEvery3Months", interval: "MONTH", intervalCount: 3 },
] as const;

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

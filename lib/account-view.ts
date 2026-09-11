/**
 * マイページ (/ja/account) の描画モデル。
 *
 * 【R2: 確定版】マイページ (トップ) — Figma 親 8095:731 / PC 8095:733 / SP 8095:792。
 * 確定版の節は「これから」「続き」「これまで」「お支払い方法」の 4 つで、いずれも
 * 「日付 → 見出し → 補足」または「写真 → ラベル → 見出し」の 1 カード型に揃っている。
 * ここでは各節に入れるカードの**素材**だけを作り、文言の組み立て (「{date} お届け」等)
 * と体裁はページ側 (next-intl + DS 部品) に任せる。
 *
 * 出どころ:
 * - これから  … Shopify の定期便契約 (nextBillingDate) + Firestore のイベント申込 (未来分)
 * - 続き      … Firestore のお気に入り (記事 / 商品)
 * - これまで  … Shopify の注文履歴 (Customer Account API の orders)
 * - お支払い方法 … 現時点では取得経路が無い (アプリ権限
 *   `read_customer_payment_methods` が未付与)。よって常に null を返し、ページ側は
 *   カードを描かず外部リンクだけを残す。権限が付いたらここに取得を足す。
 */

import { type FavoriteInput, type FavoriteKind } from "@/lib/account-favorites";

export type AccountRecordKind = "subscription" | "event" | "order";

/** 「これから」「これまで」に並ぶ 1 枚 (写真なしカード = Figma RecordCard)。 */
export type AccountRecord = {
  id: string;
  kind: AccountRecordKind;
  /** ISO8601。日付が無い記録は末尾に回す。 */
  date: string | null;
  title: string;
  /** 内部リンク (locale 抜きのパス)。無ければカードは非リンク。 */
  href?: string;
  /** 注文金額など、カード 3 行目に出す値の素材。 */
  amount?: { value: string; currencyCode: string };
};

/**
 * 「続き」に並ぶ 1 枚 (写真つきカード = Figma ExpCard)。
 *
 * `kind` は種類 (商品 / 読みもの) をそのまま持つ。画面はこれを見てカードの
 * 種類ラベルを出す — 以前は全部「お気に入り」と書いていたので、並んだカードの
 * どれが商品でどれが読みものか、押すまで分からなかった (Setaka 指摘 2026-08-25)。
 * 種類の正本は `lib/account-favorites.ts`。
 */
export type AccountMediaItem = {
  id: string;
  kind: FavoriteKind;
  title: string;
  imageUrl: string | null;
  href?: string;
};

export type AccountPaymentMethod = { brand: string; last4: string };

export type AccountView = {
  displayName: string | null;
  email: string | null;
  upcoming: AccountRecord[];
  past: AccountRecord[];
  paymentMethod: AccountPaymentMethod | null;
  /** プレビュー用の見本データで描いているか (production では常に false)。 */
  seeded: boolean;
};

/** 節ごとの最大枚数。Figma の 1 行分 (PC これから 3 / これまで 3)。 */
export const ACCOUNT_UPCOMING_LIMIT = 3;
export const ACCOUNT_PAST_LIMIT = 3;

/* -------------------------------------------------------------------------- */
/* 入力の最小形 (Shopify / Firestore の実データから必要な欄だけを受ける)         */
/* -------------------------------------------------------------------------- */

export type AccountCustomerInput = {
  firstName?: string | null;
  lastName?: string | null;
  emailAddress?: { emailAddress?: string | null } | null;
  orders?: {
    edges?: {
      node?: {
        id?: string | null;
        name?: string | null;
        processedAt?: string | null;
        totalPrice?: { amount?: string | null; currencyCode?: string | null } | null;
      } | null;
    }[];
  } | null;
};

export type AccountSubscriptionInput = {
  id?: string | null;
  status?: string | null;
  nextBillingDate?: string | null;
  lines?: { edges?: { node?: { title?: string | null } | null }[] } | null;
};

/** Firestore のドキュメントは `...doc.data()` で緩いので受け側で絞る。 */
export type AccountEventInput = {
  id?: string;
  eventSlug?: unknown;
  eventTitle?: unknown;
  eventDate?: unknown;
};

/**
 * お気に入りの生ドキュメント。形の正本は `lib/account-favorites.ts` の
 * `FavoriteInput` で、ここは既存の呼び出し側のための別名 (二重定義しない)。
 */
export type AccountFavoriteInput = FavoriteInput;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 日付昇順。日付が無いものは末尾。 */
function byDateAsc(a: AccountRecord, b: AccountRecord): number {
  if (!a.date) return b.date ? 1 : 0;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
}

/** 日付降順。日付が無いものは末尾。 */
function byDateDesc(a: AccountRecord, b: AccountRecord): number {
  if (!a.date) return b.date ? 1 : 0;
  if (!b.date) return -1;
  return b.date.localeCompare(a.date);
}

export function accountDisplayName(customer: AccountCustomerInput): string | null {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

/**
 * 「これから」= 次回の定期便 + これから開催のイベント申込。
 * 解約済み / 次回請求日が無い契約は予定が立たないので出さない。
 */
export function buildUpcoming({
  subscriptions,
  events,
  now = new Date(),
}: {
  subscriptions: AccountSubscriptionInput[];
  events: AccountEventInput[];
  now?: Date;
}): AccountRecord[] {
  const nowIso = now.toISOString();

  const fromSubscriptions: AccountRecord[] = subscriptions
    .filter((s) => str(s.nextBillingDate) !== null)
    .filter((s) => (str(s.status) ?? "").toUpperCase() !== "CANCELLED")
    .filter((s) => (str(s.nextBillingDate) as string) >= nowIso)
    .map((s, i) => ({
      id: str(s.id) ?? `subscription-${i}`,
      kind: "subscription" as const,
      date: str(s.nextBillingDate),
      title: str(s.lines?.edges?.[0]?.node?.title) ?? "",
      href: "/account/subscriptions",
    }));

  const fromEvents: AccountRecord[] = events
    .map((e, i) => ({
      id: str(e.id) ?? `event-${i}`,
      kind: "event" as const,
      date: str(e.eventDate),
      title: str(e.eventTitle) ?? "",
      href: str(e.eventSlug) ? `/events/${str(e.eventSlug)}` : undefined,
    }))
    .filter((e) => e.title !== "" && e.date !== null && (e.date as string) >= nowIso);

  return [...fromSubscriptions, ...fromEvents].sort(byDateAsc).slice(0, ACCOUNT_UPCOMING_LIMIT);
}


/** 「これまで」= 注文履歴 (新しい順)。 */
export function buildPast(customer: AccountCustomerInput): AccountRecord[] {
  const orders = customer.orders?.edges ?? [];

  return orders
    .map((edge, i): AccountRecord | null => {
      const node = edge?.node;
      if (!node) return null;
      const name = str(node.name);
      if (name === null) return null;
      const amountValue = str(node.totalPrice?.amount);
      const currency = str(node.totalPrice?.currencyCode);
      return {
        id: str(node.id) ?? `order-${i}`,
        kind: "order" as const,
        date: str(node.processedAt),
        title: name,
        amount: amountValue && currency ? { value: amountValue, currencyCode: currency } : undefined,
      } satisfies AccountRecord;
    })
    .filter((o): o is AccountRecord => o !== null)
    .sort(byDateDesc)
    .slice(0, ACCOUNT_PAST_LIMIT);
}

/**
 * 実データからマイページの描画モデルを組む。
 *
 * `paymentMethod` は常に null。Shopify アプリ権限
 * `read_customer_payment_methods` が未付与で、登録カードを読む経路が無い
 * (Research: https://app.notion.com/p/3b670c9d064c81739054f6456050f7dc)。
 * 「たぶん VISA」のような推測は出さない。
 */
export function buildAccountView({
  customer,
  subscriptions = [],
  events = [],
  now,
}: {
  customer: AccountCustomerInput;
  subscriptions?: AccountSubscriptionInput[];
  events?: AccountEventInput[];
  now?: Date;
}): AccountView {
  return {
    displayName: accountDisplayName(customer),
    email: str(customer.emailAddress?.emailAddress),
    upcoming: buildUpcoming({ subscriptions, events, now }),
    past: buildPast(customer),
    paymentMethod: null,
    seeded: false,
  };
}

/** 「8月20日(木)」。Figma 確定版のカード 1 行目と同じ形。 */
export function formatRecordDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

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
  /**
   * 注文の入金状態 (注文だけが持つ)。**金額と対で出すために要る**。
   *
   * Customer Account API の `totalPrice` は「いま請求されている額」なので、
   * 全額返金・無効化された注文では 0 になる。金額だけを出すと過去の注文が
   * すべて「¥0」に見え、買った覚えのある人の信頼を損なう (実測 2026-08-25:
   * #1027 / #1028 / #1030 はいずれも全額返金済みで ¥0 表示)。
   * 数字を偽らず、返金済みなら金額の代わりに状態を言う。
   */
  status?: AccountOrderStatus;
};

/** カードに出す注文状態。判定できない / 通常の入金済みは `null`。 */
export type AccountOrderStatus = "refunded" | "voided" | "partiallyRefunded" | null;

/** Shopify の `financialStatus` を、画面に出す状態へ畳む。 */
export function orderStatusOf(financialStatus: string | null | undefined): AccountOrderStatus {
  switch ((financialStatus ?? "").toUpperCase()) {
    case "REFUNDED":
      return "refunded";
    case "VOIDED":
    case "EXPIRED":
      return "voided";
    case "PARTIALLY_REFUNDED":
      return "partiallyRefunded";
    default:
      return null;
  }
}

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
        financialStatus?: string | null;
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

/**
 * 送信専用アドレス (no-reply@…) — **本人のメールではない**。
 *
 * LINE だけで入った人にも Shopify 顧客レコードを作る都合で、メール欄に
 * 送信専用アドレスが入っていることがある。これをそのまま
 * 「no-reply@elxea.com としてログイン中」と出すと、本人の識別子として
 * 読めてしまう (実測 2026-08-25)。本人が名乗ったアドレスではないので、
 * 識別子としては **無い** ものとして扱う。
 *
 * 判定はローカル部だけを見る (ドメインは自社とは限らない)。
 *
 * ## なぜ「6 語の完全一致」では足りないのか (QA 指摘 2026-08-25)
 *
 * 最初の実装は `no-reply` / `noreply` / `no_reply` / `donotreply` /
 * `do-not-reply` / `do_not_reply` の **6 語との完全一致**だった。これは
 * 「今この目で見た 1 つの綴り」を書き写しただけで、区切りの流儀 (`no.reply`)・
 * 連番 (`noreply2`)・タグ (`noreply+line`) のどれか 1 つでも付いた瞬間に
 * すり抜ける。すり抜けると「no-reply@… としてログイン中」が本人の識別子の
 * ように出る — つまり **落ち方が静かで、間違った情報を自信満々に出す**。
 *
 * そこで綴りを列挙するのをやめ、**正規化してから語で照合する**:
 *
 *   1. `+tag` を落とす (配送上は同じ宛先。判定は本体で行う)
 *   2. 区切り (`.` `-` `_`) を畳む → `no-reply` / `no_reply` / `no.reply` が 1 語に
 *   3. 末尾の連番を落とす → `noreply2` / `no-reply-01` が 1 語に
 *
 * 正規化した語が送信専用の語彙と**完全に一致**したときだけ真にする。前方一致に
 * しないのは `noreplytea@…` (実在しうる屋号) を巻き込まないため。
 *
 * 加えて、**到達しないと規格で決まっているドメイン** (RFC 2606 / RFC 6761 の
 * 予約 TLD) も本人のアドレスではない。ローカル部が何であっても届かないので、
 * 語彙に載っているかに関わらず落とす。`example.com` は「予約されたドメイン」で
 * あって予約 TLD ではないので**対象外** — 手元やテストで人のアドレスとして
 * 普通に使われており、落とすと本人のメールが消える。
 */
const PLACEHOLDER_EMAIL_LOCAL_WORDS = new Set([
  "noreply",
  "donotreply",
  "nonreply",
  "noemail",
  "nomail",
  "mailerdaemon",
  "postmaster",
  "bounce",
  "bounces",
  "unknown",
  "none",
  "null",
  "placeholder",
]);

/** 到達しないと規格で決まっている TLD (RFC 2606 / RFC 6761)。 */
const UNROUTABLE_TLDS = new Set(["invalid", "test", "localhost", "local"]);

/** 区切り・タグ・連番を落として 1 語に畳む。 */
function canonicalEmailLocalPart(local: string): string {
  const withoutTag = local.split("+")[0] ?? "";
  return withoutTag
    .trim()
    .toLowerCase()
    .replace(/[.\-_]/g, "")
    .replace(/\d+$/, "");
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;

  const tld = trimmed.slice(at + 1).toLowerCase().split(".").pop() ?? "";
  if (UNROUTABLE_TLDS.has(tld)) return true;

  return PLACEHOLDER_EMAIL_LOCAL_WORDS.has(canonicalEmailLocalPart(trimmed.slice(0, at)));
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
        status: orderStatusOf(node.financialStatus),
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
  const rawEmail = str(customer.emailAddress?.emailAddress);

  return {
    displayName: accountDisplayName(customer),
    /* 送信専用アドレスは識別子ではないので持たせない (画面は表示名に落ちる)。 */
    email: isPlaceholderEmail(rawEmail) ? null : rawEmail,
    upcoming: buildUpcoming({ subscriptions, events, now }),
    past: buildPast(customer),
    paymentMethod: null,
    seeded: false,
  };
}

/**
 * 「2024年3月21日(木)」。Figma 確定版のカード 1 行目に **年を足した**形。
 *
 * ## なぜ Figma (「8月20日(木)」) から外すのか
 *
 * 注文履歴は何年でも遡る。年を落とすと 2 年前の注文が今年の注文に見える
 * (実測 2026-08-25: 2024-03-21 の注文 3 件が「3月21日(木)」と並び、直近の
 * 買い物と区別が付かなかった)。「これから」の予定側も同じ書式に揃える —
 * 予定と記録で日付の読み方が変わるほうが混乱する。
 */
export function formatRecordDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

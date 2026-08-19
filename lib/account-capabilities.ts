/**
 * マイページに並ぶ「項目」の定義 — ここが唯一の正本。
 *
 * かつてマイページは、メール (Shopify) でログインした人向けの画面と、LINE だけで
 * ログインした人向けの画面という **別々の 2 コンポーネント** に分かれていた
 * (`app/[locale]/account/page.tsx` が LINE セッションを見て `LineAccountView` を
 * return して打ち切っていた)。同じ「マイページ」を 2 箇所に書いていたので、
 * 片方に足した項目がもう片方から抜ける。実際「フォロー中の農家」は LINE 側に
 * しか無かった。
 *
 * そこで項目の一覧と「どの認証状態で使えるか」を本ファイルに集め、画面側は
 * これを読んで並べるだけにした。項目を増やすときは **このファイルだけ** を触る。
 *
 * ## 何が LINE だけでは使えないのか (技術的な理由)
 *
 * 注文履歴・定期便・お支払い方法は Shopify の顧客トークンが無いと引けない。
 * LINE ログインではそのトークンが発行されない (外部 IdP から Shopify セッションを
 * 作る正規手段は Multipass だけで、Plus プラン + legacy 会員に限られる)。
 * つまり「権限を絞っている」のではなく **構造上取れない**。ここは変えない。
 *
 * 逆に、お気に入り・フォロー・イベント申込は Firestore 側にあり、
 * `resolveIdentity()` が LINE の識別子でも解決するので両方の経路で使える。
 *
 * 設計レビュー: https://www.notion.so/3c170c9d064c81029b17d29d86739c21
 */

/** ログイン経路。両方連携済みなら両方 true になる。 */
export type AccountAuth = {
  /** Shopify の顧客セッション (= メールアドレスで入っている) がある。 */
  shopify: boolean;
  /** LINE セッション (`line_session` cookie) がある。 */
  line: boolean;
};

/**
 * 項目が要求する認証状態。
 * - `signed-in` … どちらか一方でログインしていれば使える
 * - `shopify`   … Shopify の顧客トークンが要る (LINE 単独では構造上取れない)
 */
export type AccountRequirement = "signed-in" | "shopify";

/** マイページの節。並び順は `ACCOUNT_SECTION_ORDER`。 */
export type AccountSectionId = "upcoming" | "continue" | "follows" | "past" | "payment";

export type AccountItemId =
  | "subscriptions"
  | "events"
  | "favorites"
  | "follows"
  | "orders"
  | "payment";

export type AccountItem = {
  id: AccountItemId;
  /** この項目が載る節。 */
  section: AccountSectionId;
  requires: AccountRequirement;
  /**
   * 使えないときに枠の中へ出す見出し (`messages/*.json` の `account.*` キー)。
   * 項目を消さずグレーで残し、その場に理由と次の行動を出すため。
   */
  lockedTitleKey: string;
  /** 使えない理由。なぜ出せないのかを、その場で言う。 */
  lockedReasonKey: string;
  /**
   * 次の行動のラベル。`null` なら行動リンクを出さない。
   * 現状はすべて「メールアドレスを連携する」に収束する。
   */
  lockedActionKey: string | null;
};

/**
 * 項目カタログ。**画面に出る項目はすべてここにある**。
 *
 * 文言はキーだけを持ち、実文は `messages/ja.json` (と en.json) に置く。
 * 実装内に文言を直書きしない。
 */
export const ACCOUNT_ITEMS = [
  {
    id: "subscriptions",
    section: "upcoming",
    requires: "shopify",
    lockedTitleKey: "featureSubscriptions",
    lockedReasonKey: "emailRequiredReason",
    lockedActionKey: "connectShopifyButton",
  },
  {
    id: "events",
    section: "upcoming",
    requires: "signed-in",
    lockedTitleKey: "registeredEvents",
    lockedReasonKey: "signInRequiredReason",
    lockedActionKey: null,
  },
  {
    id: "favorites",
    section: "continue",
    requires: "signed-in",
    lockedTitleKey: "favorites",
    lockedReasonKey: "signInRequiredReason",
    lockedActionKey: null,
  },
  {
    id: "follows",
    section: "follows",
    requires: "signed-in",
    lockedTitleKey: "followingFarmers",
    lockedReasonKey: "signInRequiredReason",
    lockedActionKey: null,
  },
  {
    id: "orders",
    section: "past",
    requires: "shopify",
    lockedTitleKey: "featureOrders",
    lockedReasonKey: "emailRequiredReason",
    lockedActionKey: "connectShopifyButton",
  },
  {
    id: "payment",
    section: "payment",
    requires: "shopify",
    lockedTitleKey: "featurePayment",
    lockedReasonKey: "emailRequiredReason",
    lockedActionKey: "connectShopifyButton",
  },
] as const satisfies readonly AccountItem[];

/** 節の並び順 (確定版 Figma 8095:731 の順)。 */
export const ACCOUNT_SECTION_ORDER = [
  "upcoming",
  "continue",
  "follows",
  "past",
  "payment",
] as const satisfies readonly AccountSectionId[];

/** ログインしているか (経路は問わない)。 */
export function isSignedIn(auth: AccountAuth): boolean {
  return auth.shopify || auth.line;
}

/** その項目を今の認証状態で使えるか。 */
export function isItemAvailable(item: AccountItem, auth: AccountAuth): boolean {
  return item.requires === "shopify" ? auth.shopify : isSignedIn(auth);
}

/** 節に載る項目 (定義順)。 */
export function itemsInSection(section: AccountSectionId): AccountItem[] {
  return ACCOUNT_ITEMS.filter((item) => item.section === section);
}

/**
 * 節を「使える項目」と「使えない項目」に分ける。
 * 画面側は available を描き、locked をその節の中にグレーで並べる。
 */
export function splitSectionItems(
  section: AccountSectionId,
  auth: AccountAuth
): { available: AccountItem[]; locked: AccountItem[] } {
  const items = itemsInSection(section);
  return {
    available: items.filter((item) => isItemAvailable(item, auth)),
    locked: items.filter((item) => !isItemAvailable(item, auth)),
  };
}

/** その項目 id が今使えるか (画面側から id 直指定で引くとき用)。 */
export function isAvailable(id: AccountItemId, auth: AccountAuth): boolean {
  const item = ACCOUNT_ITEMS.find((candidate) => candidate.id === id);
  if (!item) return false;
  return isItemAvailable(item, auth);
}

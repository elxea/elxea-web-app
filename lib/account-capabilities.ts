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
 * 逆に、お気に入り・イベント申込は Firestore 側にあり、
 * `resolveIdentity()` が LINE の識別子でも解決するので両方の経路で使える。
 *
 * ## 「フォロー中の農家」の節はもう無い (J-5 決裁)
 *
 * 農家は「お気に入り」の 4 分類目になったので、独立した節を持たない。以前の
 * `follows` 節は、農家をフォローする入口が失われたまま枠だけが残っており、
 * しかもこの節だけ `splitSectionItems` を通らず無条件に描かれていた
 * (カタログ側の `follows` 項目はどこからも参照されない死んだ設定だった)。
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

/**
 * 「次の行動」の行き先。**ラベルと行き先を必ず一緒に持つ**ための識別子。
 *
 * 以前はカタログがラベルのキー (`lockedActionKey`) だけを持ち、行き先は画面側で
 * `/api/auth/login?locale=...` に直書きされていた。ラベルが何であってもログインへ
 * 送るので、カタログに別の行き先の項目を足した瞬間に「ラベルと行き先が食い違う」
 * (as-is D-18)。行き先もカタログ側に置き、画面は解決するだけにする。
 *
 * - `shopify-login` … Shopify (メールアドレス) のログインへ送る
 */
export type AccountActionTarget = "shopify-login";

/** 使えない項目に添える「次の行動」。ラベルのキーと行き先は必ず対で持つ。 */
export type AccountLockedAction = {
  /** ラベル (`messages/*.json` の `account.*` キー)。 */
  labelKey: string;
  target: AccountActionTarget;
};

/**
 * 行き先を実 URL にする。**ここが唯一の変換口**。
 *
 * 画面側 (`app/[locale]/account/page.tsx` / `.../subscriptions/page.tsx`) が
 * それぞれ URL を組み立てていたのをやめ、1 箇所に集めた。
 */
export function accountActionHref(target: AccountActionTarget, locale: string): string {
  switch (target) {
    case "shopify-login":
      return `/api/auth/login?locale=${encodeURIComponent(locale)}`;
  }
}

/** マイページの節。並び順は `ACCOUNT_SECTION_ORDER`。 */
export type AccountSectionId = "upcoming" | "favorites" | "past" | "payment";

export type AccountItemId =
  | "subscriptions"
  | "events"
  | "favorites"
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
   * 次の行動。`null` なら行動リンクを出さない。
   *
   * 現状はすべて `shopify-login` (メールアドレスでのログイン) に収束する。
   * **「連携」ではなく「ログイン」である** — この導線が実際に起こすのは Shopify の
   * ログインだけで、LINE との連携は起きない。連携はログイン後にマイページの
   * 「LINEと連携する」で行う 2 段階 (再設計 J-1 案B)。
   *
   * ## これを読むのは**項目専用ページだけ** (F16)
   *
   * マイページ本体 (`/account`) はこの値を読まない。あちらは Shopify が要る 3 項目が
   * 同時に locked になる画面なので、項目ごとに行動を出すと **同じ導線が 3 本並ぶ**。
   * 実測で画面末尾の `LineLinkageEntry` と合わせて 4 本あった (Setaka 実機指摘
   * 2026-08-25)。連携・ログインの入口はあの画面に 1 つだけ置き、locked カードは
   * 理由だけを言う。
   *
   * 一方、項目専用ページ (`/account/subscriptions`) は 1 画面 1 項目で重複が起きず、
   * そこで行動を出さないと行き止まりになる。だからこの値は残っている。
   * 読み口は `lockedActionFor()` の 1 つだけ。
   */
  lockedAction: AccountLockedAction | null;
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
    lockedAction: { labelKey: "connectShopifyButton", target: "shopify-login" },
  },
  {
    id: "events",
    section: "upcoming",
    requires: "signed-in",
    lockedTitleKey: "registeredEvents",
    lockedReasonKey: "signInRequiredReason",
    lockedAction: null,
  },
  {
    id: "favorites",
    section: "favorites",
    requires: "signed-in",
    lockedTitleKey: "favorites",
    lockedReasonKey: "signInRequiredReason",
    lockedAction: null,
  },
  {
    id: "orders",
    section: "past",
    requires: "shopify",
    lockedTitleKey: "featureOrders",
    lockedReasonKey: "emailRequiredReason",
    lockedAction: { labelKey: "connectShopifyButton", target: "shopify-login" },
  },
  {
    id: "payment",
    section: "payment",
    requires: "shopify",
    lockedTitleKey: "featurePayment",
    lockedReasonKey: "emailRequiredReason",
    lockedAction: { labelKey: "connectShopifyButton", target: "shopify-login" },
  },
] as const satisfies readonly AccountItem[];

/** 節の並び順 (確定版 Figma 8095:731 の順)。 */
export const ACCOUNT_SECTION_ORDER = [
  "upcoming",
  "favorites",
  "past",
  "payment",
] as const satisfies readonly AccountSectionId[];

/** ログインしているか (経路は問わない)。 */
export function isSignedIn(auth: AccountAuth): boolean {
  return auth.shopify || auth.line;
}

/**
 * マイページの **骨格を描き始めてよいか**。cookie の有無だけで決まる。
 *
 * 中身 (`AccountBody`) は Shopify / Firestore / cx-agent への往復を待つので
 * `<Suspense>` の内側に置いてある。その外側で「そもそもマイページを出す画面か、
 * ログインを促す画面か」を決めるのがこの判定で、`middleware.ts` の /account
 * ガードと **同じ cookie・同じ条件** を見る (認証を緩めるものではない)。
 *
 * `line` を落としてはいけない: LINE だけでログインしている人は `shop_at` /
 * `shop_rt` を構造上持たないので、Shopify の cookie だけで判定すると
 * middleware は通すのに画面だけ「ログインが必要です」に落ちる。
 *
 * `previewSeed` は計測用の見本表示 (PREVIEW_SEED=1)。実セッションを持たないので
 * cookie が 1 つも無くても骨格を出す必要がある。
 */
export function canRenderAccountShell(input: {
  hasShopifySession: boolean;
  hasLineSession: boolean;
  previewSeed: boolean;
}): boolean {
  return input.hasShopifySession || input.hasLineSession || input.previewSeed;
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

/**
 * その項目の「次の行動」。項目専用の画面 (例: /account/subscriptions) が
 * 自前でラベルと行き先を持たないようにするための引き口。
 */
export function lockedActionFor(id: AccountItemId): AccountLockedAction | null {
  return ACCOUNT_ITEMS.find((candidate) => candidate.id === id)?.lockedAction ?? null;
}

/** その項目 id が今使えるか (画面側から id 直指定で引くとき用)。 */
export function isAvailable(id: AccountItemId, auth: AccountAuth): boolean {
  const item = ACCOUNT_ITEMS.find((candidate) => candidate.id === id);
  if (!item) return false;
  return isItemAvailable(item, auth);
}

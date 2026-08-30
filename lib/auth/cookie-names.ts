/**
 * @sot cookie-name-registry
 *
 * このアプリが発行する cookie の名前・グループ・scope・secure 規則の正本。
 *
 * ## なぜ `lib/auth/cookies.ts` から切り出してあるのか
 *
 * 名前を使いたい場所には**ブラウザで動く画面**が含まれる
 * (`components/ui/sidebar.tsx` / `lib/consent.ts` など)。
 * ところが `lib/auth/cookies.ts` は読み込まれた瞬間に
 * `validateApex(env("AUTH_COOKIE_APEX"))` を実行する。`AUTH_COOKIE_APEX` は
 * `NEXT_PUBLIC_` が付かないサーバ専用の設定なので、クライアント束では値が
 * 取れず **`validateApex` が空文字で throw して画面が落ちる**。
 *
 * つまり「名前をレジストリ経由にする」ことと「クライアントから読める」ことは、
 * 分けない限り両立しない。ここは env も `next/server` も読まない葉モジュールに
 * してあり、Domain の決定・削除・発行オプションは従来どおり
 * `lib/auth/cookies.ts` が持つ (そちらは `@sot cookie-name-registry` を参照する側)。
 *
 * 生の cookie 名文字列は `elxea-tokens/cookie-name-through-registry` が
 * lint で止める。逃げ道はこのファイルへの追記だけで、差分に必ず現れる。
 */

// --- registry ---------------------------------------------------------------

/**
 * `host-only` — no Domain attribute; readable only on the exact issuing host.
 * `shared-domain` — Domain-scoped to the apex so `elxea.com` and `www.elxea.com`
 * share one jar. The LINE flow needs this because the init POST can land on
 * either host while the callback always returns to one.
 */
export type CookieScope = "host-only" | "shared-domain";

/**
 * `prod-only` — `secure` mirrors `NODE_ENV === "production"`. This is what lets
 * the flow be exercised over plain http locally and in Ring 2.
 * `always` — `secure` is unconditionally true.
 */
export type CookieSecureRule = "prod-only" | "always";

export type CookieGroup =
  | "shopify-session"
  | "line-session"
  | "chat-session"
  | "transient"
  | "not-auth";

export type CookieSpec = {
  readonly name: string;
  readonly group: CookieGroup;
  readonly scope: CookieScope;
  readonly secure: CookieSecureRule;
};

/**
 * Every cookie this application sets, with the scope it is actually issued at.
 *
 * The scopes are NOT uniform, and that is the crux of the bug this registry
 * closes: a single Domain rule cannot be applied to all of them. Emitting
 * `Domain=.elxea.com` for the Shopify session cookies would fail to clear the
 * host-only ones they are actually issued at, which is a *new* defect — logout
 * that leaves the Shopify session intact.
 */
export const COOKIE_REGISTRY: readonly CookieSpec[] = [
  // Shopify session — issued host-only by auth/callback and lib/shopify/auth.
  { name: "shop_at", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_rt", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_exp", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_it", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_cid", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_auth", group: "shopify-session", scope: "host-only", secure: "prod-only" },

  // LINE session — issued Domain-scoped by line-callback.
  { name: "line_user", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_auth", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_uid", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_session", group: "line-session", scope: "shared-domain", secure: "prod-only" },

  // Short-lived flow state.
  { name: "shop_cv", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_state", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_nonce", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_locale", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_return_to", group: "transient", scope: "host-only", secure: "prod-only" },
  /* 進行中の Shopify ログインを **まとめて** 持つ入れ物（`lib/shopify/oauth-state.ts`）。
   * 上の 5 本と同じ値を、state ごとに最大 5 件まで抱える。
   *
   * 別 cookie を足しているのは、上の 5 本が 1 個ずつしか無いせいで **ログイン開始が
   * 2 回走ると先行する試行が壊れる** から（2026-08-25 の「エラーなのにログインできて
   * いる」障害）。scope / secure は上の 5 本と同一 — 同じ往復で使い捨てる同じ性質の
   * 値なので、ここだけ規則を変える理由が無い。 */
  { name: "shop_oauth", group: "transient", scope: "host-only", secure: "prod-only" },
  /* Shared-domain for the same reason as the LINE session: the init POST may
   * land on apex or www, and the callback returns to whichever host is pinned. A
   * host-only state cookie misses the opposite host and the CSRF check fails —
   * this was seen in production as "session expired" on login. */
  /* `secure` is prod-only, not `always`, for the same reason the LINE session
   * cookies are: a Secure cookie is not stored over plain http, so with `always`
   * the CSRF state issued by /api/line-login/init never reaches the browser in
   * any http environment and the callback always fails the state check. That
   * makes the LINE login flow impossible to exercise outside production —
   * including in Ring 2, which must run against `next dev` over http. In
   * production `NODE_ENV === "production"`, so the emitted attribute is
   * unchanged. */
  { name: "line_oauth_state", group: "transient", scope: "shared-domain", secure: "prod-only" },
  /* LINE Login の OIDC `nonce`（D11）。`line_oauth_state` と同じ scope / secure 規則で発行し、
   * 同じ往復で使い捨てる。**別 cookie にしてある**のは役割が違うため: state は認可応答を
   * このブラウザに束縛し、nonce は戻ってきた id_token をこの認可要求に束縛する。値を共有すると
   * URL に出る state から nonce が観測でき、id_token 側の束縛が名ばかりになる。 */
  { name: "line_oauth_nonce", group: "transient", scope: "shared-domain", secure: "prod-only" },
  /* Web 発 LINE 連携 (P2) の state。`line_oauth_state` と同じ理由で shared-domain /
   * prod-only だが、**別 cookie にしてある**。ログインと連携は別のチャネル・別の意図で、
   * 片方の往復がもう片方の state を踏み潰すと、途中まで進んでいたほうが静かに壊れる。
   * 中身は暗号文 (顧客 ID を封じるため。lib/line/link-flow.ts)。 */
  { name: "line_link_state", group: "transient", scope: "shared-domain", secure: "prod-only" },
  /* ワンタップ連携の「意思」（J-1 案A）。押した瞬間だけ立ち、10 分で切れ、
     1 度使えば消える。中身は押したときの LINE userId で、帰ってきたときの
     line_uid と一致しなければ開かない（lib/auth/link-intent.ts）。 */
  { name: "line_link_intent", group: "transient", scope: "shared-domain", secure: "prod-only" },
  /* Name verified against lib/line/account-link.ts:22 — it is `acct_link_tk`,
   * not the longer form the design assumed. */
  { name: "acct_link_tk", group: "transient", scope: "host-only", secure: "prod-only" },

  /* チャットの会話 ID。**サーバ (route handler) だけが発行する** httpOnly cookie で、
   * 中身は `<uuid>.<HMAC 署名>` (`lib/chat/session-token.ts`)。
   *
   * ## なぜ独立したグループなのか
   *
   * - `transient` ではない。寿命は 30 日で、往復 1 回で使い捨てる値ではない
   *   (前身の `chat_session_id` は 300 秒の受け渡し用で、性質が違う)。
   * - かといって `shopify-session` / `line-session` にも入れられない。この 2 群は
   *   `AUTH_COOKIE_GROUPS` = 「認証状態を運ぶ cookie」であり、`middleware.ts` の
   *   `/account` 判定と logout の一括削除がここを見る。会話 ID を混ぜると
   *   **会話を持っているだけでログイン済みとみなされる**という新しい欠陥になる。
   * - `not-auth` (カート ID / サイドバー状態) でもない。この cookie を持っていると
   *   その会話の履歴が読めるので、認証ではないが**資格情報ではある**。
   *
   * よって自分のグループを持つ。ログアウト時の扱いは一括削除ではなく、ログイン状態が
   * 変わった時点で画面側が `/api/chat/session?rotate=1` を叩いて振り直す
   * (`components/chat/chat-provider.tsx`)。
   *
   * `secure` は prod-only。他の cookie と同じ理由 — `always` にすると平文 http の
   * 環境 (Ring 2 / LAN 実機) でブラウザが黙って捨て、チャットが無言で壊れる。
   * `host-only`: 発行するのは自サーバの route handler だけで、往復で別ホストに
   * 着地する LINE の state 系とは事情が違う。 */
  { name: "chat_sid", group: "chat-session", scope: "host-only", secure: "prod-only" },

  // Not auth state; listed so the registry is a complete map of what we set.
  { name: "site_auth", group: "not-auth", scope: "host-only", secure: "prod-only" },
  { name: "shopify_cart_id", group: "not-auth", scope: "host-only", secure: "prod-only" },
  { name: "sidebar_state", group: "not-auth", scope: "host-only", secure: "prod-only" },
  /* Written from the browser by `buildConsentCookie` (`lib/consent.ts`), not
   * through this module's helpers. It is listed because the registry is a map of
   * every cookie we set, not only the ones set here — the scanner in
   * `__tests__/auth-cookie-registry.test.ts` now follows cookie-builder calls and
   * would otherwise report it as an unknown name.
   *
   * `shared-domain`: `consentCookieDomain` sets a `domain=` attribute.
   * `prod-only`: `Secure` is added only when the page is served over https. */
  { name: "cookie_consent", group: "not-auth", scope: "shared-domain", secure: "prod-only" },
] as const;

/**
 * Cookies set by third-party libraries, where no `set` call exists in our source
 * for a scanner to find.
 *
 * This list exists so that "unknown cookie name" can be a hard failure. Without
 * it the registry check would have to tolerate anything it did not recognise,
 * which is the same as not checking.
 */
export const EXTERNAL_LIBRARY_COOKIES: readonly string[] = [
  "NEXT_LOCALE", // next-intl
] as const;

/**
 * Named handles for the cookies referenced from code, so call sites read as
 * `COOKIE_NAME.shopAccessToken` rather than repeating a bare string literal.
 *
 * These are `as const` string literals, not computed lookups, so the registry
 * scanner in `__tests__/auth-cookie-registry.test.ts` can still resolve every
 * `cookies.set(...)` argument statically. A scanner that cannot resolve a name
 * has to either guess or ignore, and both defeat the point of the check.
 *
 * ## 全件そろっていることが条件 (憲章 R8)
 *
 * Wave 4 以前、この表は 13 名しか持っていなかった。残り 13 本
 * (`shop_cv` `shop_state` `shop_nonce` `shop_locale` `shop_return_to`
 * `shop_oauth` `line_oauth_nonce` `line_link_intent` `chat_session_id` (廃止済み)
 * `site_auth` `shopify_cart_id` `sidebar_state` `cookie_consent`) は
 * 呼び出し側に生文字列のまま散っていて、`__tests__/auth-cookie-registry.test.ts`
 * は「知らない名前が無いか」しか見ていないのでそれを通していた。
 *
 * 装置 (レジストリ) はあるのに移行が半分、という状態は憲章 R8 の指す失敗型
 * そのものなので、**登録済みの cookie は全件ここに名前を持つ**。
 * `__tests__/cookie-name-registry.test.ts` が
 * 「COOKIE_REGISTRY の全 name が COOKIE_NAME の値に現れる」ことを固定している。
 */
export const COOKIE_NAME = {
  shopAccessToken: "shop_at",
  shopRefreshToken: "shop_rt",
  shopExpiresAt: "shop_exp",
  shopIdToken: "shop_it",
  shopCustomerId: "shop_cid",
  shopAuthFlag: "shop_auth",
  lineUser: "line_user",
  lineAuth: "line_auth",
  lineUid: "line_uid",
  lineSession: "line_session",
  lineOauthState: "line_oauth_state",
  lineOauthNonce: "line_oauth_nonce",
  lineLinkState: "line_link_state",
  lineLinkIntent: "line_link_intent",
  accountLinkToken: "acct_link_tk",
  shopCodeVerifier: "shop_cv",
  shopState: "shop_state",
  shopNonce: "shop_nonce",
  shopLocale: "shop_locale",
  shopReturnTo: "shop_return_to",
  shopPendingOauth: "shop_oauth",
  chatSession: "chat_sid",
  siteAuth: "site_auth",
  shopifyCartId: "shopify_cart_id",
  sidebarState: "sidebar_state",
  cookieConsent: "cookie_consent",
} as const;

const BY_NAME = new Map(COOKIE_REGISTRY.map((s) => [s.name, s]));

export function getCookieSpec(name: string): CookieSpec | undefined {
  return BY_NAME.get(name);
}

export function cookieNamesInGroup(group: CookieGroup): readonly string[] {
  return COOKIE_REGISTRY.filter((s) => s.group === group).map((s) => s.name);
}

/** Names of every cookie that carries authentication state. */
export const AUTH_COOKIE_GROUPS: readonly CookieGroup[] = [
  "shopify-session",
  "line-session",
] as const;

export const SHOPIFY_SESSION_COOKIES = cookieNamesInGroup("shopify-session");
export const LINE_SESSION_COOKIES = cookieNamesInGroup("line-session");

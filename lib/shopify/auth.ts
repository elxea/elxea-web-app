import { cache } from "react";
import { cookies } from "next/headers";

import {
  COOKIE_NAME,
  getCookieSpec,
  hasShopifySessionCookies,
  isSecure,
} from "@/lib/auth/cookies";

import { buildSessionCookieWrites } from "./session-cookies";
import {
  decryptToken,
  refreshAccessToken,
  encryptToken,
  getCustomer,
  getSubscriptionContracts,
  type Customer,
  type SubscriptionContract,
  type MembershipTier,
} from "./customer";

/* Cookie names come from the registry rather than being re-declared here.
 * They used to be four local string literals, which is how the codebase ended up
 * with the same names spelled out at six call sites and no single place that
 * knew the full set. Keeping them as module-level consts initialised from the
 * registry also keeps them statically resolvable, which the registry scanner in
 * `__tests__/auth-cookie-registry.test.ts` relies on. */
const ACCESS_TOKEN_COOKIE = COOKIE_NAME.shopAccessToken;
const REFRESH_TOKEN_COOKIE = COOKIE_NAME.shopRefreshToken;
const EXPIRES_AT_COOKIE = COOKIE_NAME.shopExpiresAt;
const AUTH_FLAG_COOKIE = COOKIE_NAME.shopAuthFlag; // non-httpOnly, for client-side UI checks

type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/**
 * 今のセッション。生きているかどうかを決めるのは **`shop_rt` だけ**。
 *
 * ## 直している割れ方 (as-is D-1)
 *
 * 以前はここが `shop_at` / `shop_rt` / `shop_exp` の **3 つ全部**を要求していた。
 * `shop_at` と `shop_exp` はアクセストークンの寿命を maxAge に持っていたので、
 * 数時間でブラウザから消える。消えた瞬間にこの関数は `null` を返し、**30 日の
 * `shop_rt` は原理的に一度も使われなかった**。`:50` のリフレッシュ分岐も
 * 「期限 60 秒前」という一瞬の窓でしか到達しない死んだ分岐だった。
 *
 * いまは cookie の寿命を全部 30 日に揃え (`lib/shopify/session-cookies.ts`)、
 * **期限判定は `shop_exp` の中身**で行う。アクセストークンが切れていれば
 * リフレッシュして続きをやる。これが「セッション寿命を鍵の寿命から切り離す」の実体。
 *
 * ## 書き戻し
 *
 * リフレッシュ結果は `setSessionCookies()` で書き戻す。**書き戻し口はここ 1 本**。
 * Server Component では `cookies().set()` が例外を投げるので、その場合は黙って
 * 諦めてメモリ上の新しいトークンだけを返す (画面は正しく描ける)。次に Route
 * Handler / Server Action を通ったときに永続化される。
 *
 * ⚠ 書き戻せないと、リフレッシュのたびに新しい refresh token が捨てられる。
 *   Shopify はリフレッシュのたびに新しい refresh token を返すため、書き戻しが
 *   ずっと失敗し続ける構成にしてはいけない (だから middleware ではなく、cookie を
 *   実際に書ける経路で必ず 1 回は通るようにしてある)。
 *
 * ## 1 リクエスト 1 回に畳んである (`React.cache`)
 *
 * マイページ 1 枚を描くだけで、この関数は **3 回**呼ばれていた
 * (`getCustomerFromSession` / `getSubscriptionsFromSession` / `resolveIdentity`)。
 * cookie を読むだけなら安いが、access token が切れている描画では **3 回とも
 * リフレッシュ分岐に入る** — Shopify への往復が 3 本走り、しかも Shopify は
 * リフレッシュのたびに refresh token を回すので、**同じ refresh token を 3 本が
 * 同時に使う競合**になる (先に着いた 1 本以外が無効なトークンを掴む)。
 *
 * `React.cache` はリクエスト単位のメモ化なので、同じ描画の中では最初の 1 回だけが
 * 実体を走らせ、残りはその結果を共有する。リクエストの外 (テスト・スクリプト) では
 * メモ化されず素通しになるため、呼び出し側の意味は変わらない。
 */
export const getSession: () => Promise<Session | null> = cache(loadSession);

async function loadSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const atEnc = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const rtEnc = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  const expStr = cookieStore.get(EXPIRES_AT_COOKIE)?.value;

  /* 生存判定は refresh token ただ 1 つ。access token が無い / 期限切れなのは
     「ログインが切れた」ではなく「取り直せばよい」状態。 */
  if (!rtEnc) return null;
  const refreshToken = decryptToken(rtEnc);
  if (!refreshToken) return null;

  const accessToken = atEnc ? decryptToken(atEnc) : null;
  /* `shop_exp` が読めないときは「切れている」に倒す。推測で使い回さない
     (壊れた値を無限の有効期限として扱わないため `NaN` も同じ扱いにする)。 */
  const parsedExpiresAt = expStr ? parseInt(expStr, 10) : NaN;
  const expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : 0;

  const needsRefresh = !accessToken || Date.now() >= expiresAt - 60_000;
  if (!needsRefresh) {
    return { accessToken: accessToken!, refreshToken, expiresAt };
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    const session: Session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await persistSession(tokens.access_token, tokens.refresh_token, tokens.expires_in);
    return session;
  } catch {
    /* refresh token も通らない = 本当にログインが切れている。 */
    return null;
  }
}

/**
 * リフレッシュ結果を cookie に書き戻す (best-effort)。
 *
 * Server Component から呼ばれると `cookies().set()` が例外を投げる。それは
 * 「書けない場所から呼ばれた」というだけで、セッション自体は生きているので
 * **握り潰して続行する**。cookie の寿命は 30 日あるので、次に Route Handler /
 * Server Action を通ったときに書き戻される。
 */
async function persistSession(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  try {
    await setSessionCookies(accessToken, refreshToken, expiresIn);
  } catch {
    /* Server Component からの呼び出し。次の書ける経路に任せる。 */
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

/**
 * ログイン中の顧客。**1 リクエスト 1 回に畳んである** (`getSession` と同じ理由)。
 *
 * 顧客の取得は Shopify Customer Account API への往復なので、1 枚の画面で 2 回呼ぶと
 * そのまま 2 往復になる。値はリクエストの中で変わらないため、共有して差し支えない。
 */
export const getCustomerFromSession: () => Promise<Customer | null> =
  cache(loadCustomerFromSession);

async function loadCustomerFromSession(): Promise<Customer | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    return await getCustomer(session.accessToken);
  } catch (e) {
    console.error("getCustomerFromSession error:", e);
    return null;
  }
}

/** 定期便契約。理由は `getCustomerFromSession` と同じ (1 リクエスト 1 往復)。 */
export const getSubscriptionsFromSession: () => Promise<SubscriptionContract[]> =
  cache(loadSubscriptionsFromSession);

async function loadSubscriptionsFromSession(): Promise<SubscriptionContract[]> {
  try {
    const session = await getSession();
    if (!session) return [];
    return await getSubscriptionContracts(session.accessToken);
  } catch (e) {
    console.error("getSubscriptionsFromSession error:", e);
    return [];
  }
}

/**
 * Determine membership tier from customer tags or active subscription contracts.
 * Priority: tags (explicit) > subscription status (implicit).
 * Tags: "member-premium" → premium, "member-standard" or "member" → standard.
 * Fallback: any active subscription contract → standard.
 */
export async function getMembershipTier(): Promise<MembershipTier> {
  try {
    const session = await getSession();
    if (!session) return "none";

    const [customer, contracts] = await Promise.all([
      getCustomer(session.accessToken),
      getSubscriptionContracts(session.accessToken),
    ]);

    // Check tags first (set by Shopify Flow)
    if (customer?.tags) {
      if (customer.tags.includes("member-premium")) return "premium";
      if (customer.tags.includes("member-standard") || customer.tags.includes("member")) return "standard";
    }

    // Fallback: check active subscription contracts
    const hasActiveContract = contracts.some((c) => c.status === "ACTIVE");
    if (hasActiveContract) return "standard";

    return "none";
  } catch (e) {
    console.error("getMembershipTier error:", e);
    return "none";
  }
}

/**
 * セッション cookie を cookie store 側に書く。**リフレッシュ結果の書き戻し口**。
 *
 * 以前は呼び出し元ゼロの死にコードで、`auth.ts` のコメントだけが「middleware か
 * 次の route handler が cookie を更新する」と約束していた (実装は無かった)。
 * `getSession()` のリフレッシュ経路をここに繋いで、約束を実装にした。
 *
 * 書く中身と寿命は `buildSessionCookieWrites` が正本。ログイン直後の
 * `app/api/auth/callback/route.ts` (NextResponse 側) と同じ定義を共有するので、
 * 「ログインでは 30 日、リフレッシュでは数時間」のようなずれが起きない。
 *
 * ⚠ Server Component から呼ぶと Next が例外を投げる。呼び出し側 (`persistSession`)
 *   がそれを受けるので、ここでは握り潰さない (書けたかどうかを嘘にしない)。
 */
export async function setSessionCookies(
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<void> {
  const cookieStore = await cookies();
  const writes = buildSessionCookieWrites({
    accessToken,
    refreshToken,
    expiresIn,
    encrypt: encryptToken,
  });

  const shared = { sameSite: "lax" as const, path: "/" };

  /* 名前は定数を直に渡す (動的にすると auth-cookie-registry の静的スキャナが
     解決できなくなる)。値と寿命だけを共有の正本から取る。 */
  cookieStore.set(ACCESS_TOKEN_COOKIE, writes.accessToken.value, {
    ...shared,
    httpOnly: true,
    secure: isSecure(getCookieSpec(ACCESS_TOKEN_COOKIE)!),
    maxAge: writes.accessToken.maxAge,
  });
  cookieStore.set(REFRESH_TOKEN_COOKIE, writes.refreshToken.value, {
    ...shared,
    httpOnly: true,
    secure: isSecure(getCookieSpec(REFRESH_TOKEN_COOKIE)!),
    maxAge: writes.refreshToken.maxAge,
  });
  cookieStore.set(EXPIRES_AT_COOKIE, writes.expiresAt.value, {
    ...shared,
    httpOnly: true,
    secure: isSecure(getCookieSpec(EXPIRES_AT_COOKIE)!),
    maxAge: writes.expiresAt.maxAge,
  });
  cookieStore.set(AUTH_FLAG_COOKIE, writes.authFlag.value, {
    ...shared,
    httpOnly: false,
    secure: isSecure(getCookieSpec(AUTH_FLAG_COOKIE)!),
    maxAge: writes.authFlag.maxAge,
  });
}

/* `clearSession()` was removed here.
 *
 * It was a FOURTH implementation of "delete the auth cookies", with zero callers,
 * and it deleted host-only only — so anything that started calling it would have
 * reproduced the exact bug this change fixes. Deletion now lives solely in
 * `clearAuthCookies()` (lib/auth/cookies.ts), which emits both scopes. A
 * store-based variant can be reintroduced there if a Server Action ever needs
 * one; it must not come back as a private copy.
 */

/**
 * 復号せずにセッションの有無だけ見る軽い判定 (Edge / middleware 用)。
 *
 * 実体は `lib/auth/cookies.ts` の `hasShopifySessionCookies`。ここは互換のための
 * 再 export で、判定そのものは持たない。
 *
 * ## なぜ移したか (as-is D-1)
 *
 * この関数は**完全な死にコード**で、middleware は同じ判定を
 * `cookies.has("shop_at") && cookies.has("shop_rt")` と自前で書いていた。
 * 実装が 2 つある状態で `shop_at` は数時間で消えるようになっていたので、
 * 「30 日ログインが続く」ように直しても middleware だけが `/account` を
 * ログイン画面へ弾き続ける。判定を 1 か所にして両方が同時に直るようにした。
 *
 * この module は node crypto を持つ `./customer` を読むので middleware からは
 * import できない。だから判定の実体は Edge でも読める `lib/auth/cookies.ts` に置く。
 */
export const hasSessionCookie = hasShopifySessionCookies;

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
  loadFailed,
  loaded,
  reportLoadFailure,
  type LoadResult,
} from "./load-result";
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
export const getSession: () => Promise<Session | null> = cache(async () => {
  const result = await getSessionResult();
  return result.ok ? result.data : null;
});

/**
 * `getSession()` と同じ解決を行い、**「セッションが無い」と「判定できなかった」を
 * 分けて**返す (設計憲章 R1)。
 *
 * `getSession()` は `Session | null` のままにしてある。呼び出し側の大半 (Server
 * Action の `getAccessToken()` など) にとって両者の扱いは同じ ——「続行できない」——
 * なので、そこに分岐を増やしても嘘が減らないからである。分ける意味があるのは
 * **画面に状態を出す経路**だけで、それが下の 2 つのローダーにあたる。
 *
 * メモ化はこちら側に置く。`getSession()` はこれを呼ぶだけなので、どちらの入口から
 * 何回呼んでも実体は 1 リクエスト 1 回のまま
 * (`__tests__/session-request-dedup.test.ts` が守っている契約は保たれる)。
 */
export const getSessionResult: () => Promise<LoadResult<Session | null>> =
  cache(loadSessionResult);

async function loadSessionResult(): Promise<LoadResult<Session | null>> {
  const cookieStore = await cookies();
  const atEnc = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const rtEnc = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  const expStr = cookieStore.get(EXPIRES_AT_COOKIE)?.value;

  /* 生存判定は refresh token ただ 1 つ。access token が無い / 期限切れなのは
     「ログインが切れた」ではなく「取り直せばよい」状態。 */
  if (!rtEnc) return loaded(null);

  const refreshToken = decryptToken(rtEnc);
  if (!refreshToken) {
    /* cookie はあるのに復号できない。顧客にとっての結末は「ログインし直し」で
       変わらないが、**原因はこちら側にある** — SESSION_SECRET のローテーション、
       あるいは暗号文の破損。まとまった数が出たら事故なので、静かに
       ログアウト扱いにせず必ず記録に残す。 */
    reportLoadFailure("getSession:decrypt", new Error("refresh token decrypt failed"), {
      impact: "顧客は再ログインを求められる (セッション自体は生きていた可能性がある)",
    });
    return loadFailed("credentials-unreadable");
  }

  const accessToken = atEnc ? decryptToken(atEnc) : null;
  /* `shop_exp` が読めないときは「切れている」に倒す。推測で使い回さない
     (壊れた値を無限の有効期限として扱わないため `NaN` も同じ扱いにする)。 */
  const parsedExpiresAt = expStr ? parseInt(expStr, 10) : NaN;
  const expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : 0;

  const needsRefresh = !accessToken || Date.now() >= expiresAt - 60_000;
  if (!needsRefresh) {
    return loaded({ accessToken: accessToken!, refreshToken, expiresAt });
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    await persistSession(tokens.access_token, tokens.refresh_token, tokens.expires_in);
    return loaded({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
  } catch (e) {
    /* ここが**最も高くつく取り違え**だった。
     *
     * 以前はこの catch が黙って `null` を返し、コメントは「refresh token も
     * 通らない = 本当にログインが切れている」と断定していた。実際にはここには
     * 2 つの事実が流れ込む:
     *
     *   - refresh token が本当に失効した (= ログアウトが正しい)
     *   - Shopify のトークンエンドポイントが落ちている / タイムアウトした
     *
     * 後者を前者として扱うと、**Shopify の一時障害が全顧客の一斉ログアウトに
     * 化ける**。しかも 30 日有効な refresh token は cookie に残ったままなので、
     * 障害が明ければそのまま通る — つまり顧客を追い出す必要は最初から無かった。
     *
     * `getSession()` (互換の入口) は従来どおり `null` を返すので、続行できない
     * 経路の挙動は 1 ミリも変えていない。変えたのは「なぜ続行できないか」を
     * 画面と Sentry に渡せるようにしたことだけ。 */
    reportLoadFailure("getSession:refresh", e, {
      impact: "以前は「ログアウト」として描画されていた (アラートなし)",
    });
    return loadFailed("upstream-unavailable");
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
 *
 * ## 返り値が 3 値なのはなぜか (設計憲章 R1)
 *
 * 以前は `Customer | null` で、`null` が **「ログインしていない」と「Shopify から
 * 答えが返らなかった」の両方**を意味していた。しかも catch は `console.error` を
 * 1 行吐くだけで、アラートには一切繋がっていなかった。結果として Shopify の
 * 一時障害は「顧客が黙ってログアウトさせられる」という形で表に出て、こちらは気付けない。
 *
 *   - `{ ok: true, data: null }`     … 確定的に未ログイン。ログイン導線を出してよい
 *   - `{ ok: true, data: Customer }` … ログイン中
 *   - `{ ok: false, reason }`        … **判定できなかった**。ログイン導線を出しては
 *                                       いけない (ログイン済みの人を追い出すため)
 */
export const getCustomerFromSession: () => Promise<LoadResult<Customer | null>> =
  cache(loadCustomerFromSession);

async function loadCustomerFromSession(): Promise<LoadResult<Customer | null>> {
  const session = await getSessionResult();
  /* 判定不能はそのまま素通しする。原因は `getSessionResult` 側で記録済みなので、
     ここで二重に Sentry へ送らない。 */
  if (!session.ok) return session;
  if (!session.data) return loaded(null);

  try {
    return loaded(await getCustomer(session.data.accessToken));
  } catch (e) {
    reportLoadFailure("getCustomerFromSession", e, {
      impact: "以前は「未ログイン」として描画されていた (アラートなし)",
    });
    return loadFailed("upstream-unavailable");
  }
}

/**
 * 定期便契約。理由は `getCustomerFromSession` と同じ (1 リクエスト 1 往復・3 値)。
 *
 * ここでの `[]` の取り違えは顧客への影響が特に大きい。**「定期便を契約していない」と
 * 「契約は引けなかった」が同じ空配列**だったので、Shopify が詰まった日には
 * 契約中の顧客に「まだ定期便のご契約はありません」と表示していた。
 */
export const getSubscriptionsFromSession: () => Promise<
  LoadResult<SubscriptionContract[]>
> = cache(loadSubscriptionsFromSession);

async function loadSubscriptionsFromSession(): Promise<
  LoadResult<SubscriptionContract[]>
> {
  const session = await getSessionResult();
  if (!session.ok) return session;
  if (!session.data) return loaded([]);

  try {
    return loaded(await getSubscriptionContracts(session.data.accessToken));
  } catch (e) {
    reportLoadFailure("getSubscriptionsFromSession", e, {
      impact: "以前は「契約 0 件」として描画されていた (アラートなし)",
    });
    return loadFailed("upstream-unavailable");
  }
}

/**
 * Determine membership tier from customer tags or active subscription contracts.
 * Priority: tags (explicit) > subscription status (implicit).
 * Tags: "member-premium" → premium, "member-standard" or "member" → standard.
 * Fallback: any active subscription contract → standard.
 *
 * ## ここは 3 値化していない (意図的・Wave 0 の範囲外)
 *
 * 失敗時に `"none"` を返すのは、**会員限定コンテンツを守る側に倒している** ——
 * 判定できないときに開けてしまうと、有料コンテンツをそのまま配ることになる。
 * 逆に言えば Shopify が落ちている間、会費を払っている人が締め出される。
 * どちらに倒すかは商品判断であって実装判断ではないので、**挙動は変えない**。
 *
 * 変えたのは可視性だけ: 以前は `console.error` 1 行で、締め出しが起きても
 * 誰にも分からなかった。いまは Sentry に上がるので「障害中に何人が会員扱いを
 * 失ったか」を数えられる。3 値化して画面を出し分けるかどうかは、その数字を
 * 見てから決める (呼び出し側は `journal/[slug]` と `events/[slug]` の 2 か所)。
 */
export async function getMembershipTier(): Promise<MembershipTier> {
  try {
    const session = await getSessionResult();
    if (!session.ok) {
      /* 判定不能。原因は `getSessionResult` 側で記録済み。ここでは「会員資格を
         判定できないまま none に倒した」という**別の事実**を残す — 上の記録は
         セッションの話で、こちらは会員限定コンテンツが閉じた話。 */
      reportLoadFailure("getMembershipTier:session", new Error(session.reason), {
        impact: "会員限定コンテンツが閉じた (課金中の会員が締め出された可能性)",
      });
      return "none";
    }
    if (!session.data) return "none";
    const { accessToken } = session.data;

    const [customer, contracts] = await Promise.all([
      getCustomer(accessToken),
      getSubscriptionContracts(accessToken),
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
    reportLoadFailure("getMembershipTier", e, {
      impact: "会員限定コンテンツが閉じた (課金中の会員が締め出された可能性)",
    });
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

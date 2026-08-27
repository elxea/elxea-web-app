import { NextRequest, NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  buildAuthorizeUrl,
} from "@/lib/shopify/customer";
import { isProduction } from "@/lib/config";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { getRequestHostname, getRequestOrigin, isTrustedAuthHost } from "@/lib/base-url";
import {
  PENDING_AUTH_COOKIE,
  PENDING_AUTH_TTL_MS,
  addPendingAuth,
  parsePendingAuths,
  serializePendingAuths,
} from "@/lib/shopify/oauth-state";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";

export async function GET(request: NextRequest) {
  /* Refuse to start an OAuth round trip we know cannot come back.
   *
   * `redirect_uri` is matched by Shopify against a registered allow-list by exact
   * string, so on an unregistered host the user is sent to Shopify only to be
   * rejected there — an opaque third-party error instead of a legible one from
   * us. This gate turns that into a local, explainable response.
   *
   * 503 rather than a 4xx: the host is not wrong, it is not configured yet, and
   * that is a server-side condition an operator fixes by registering it.
   *
   * `isTrustedAuthHost` is fail-CLOSED: it accepts a host only at or under our
   * own apex, or one named explicitly in `LINE_ALLOWED_CALLBACK_HOSTS`. Production
   * and www therefore pass with no configuration at all, while a preview
   * deployment is refused rather than silently authenticating against production
   * — which is what used to happen, because `NEXTAUTH_URL` is unset in preview
   * while Vercel injects `VERCEL_PROJECT_PRODUCTION_URL` everywhere. */
  const hostname = getRequestHostname(request);
  if (!isTrustedAuthHost(hostname)) {
    return NextResponse.json(
      { error: "auth_host_not_registered", host: hostname },
      { status: 503 },
    );
  }

  const origin = getRequestOrigin(request);
  const redirectUri = `${origin}/api/auth/callback`;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const nonce = generateNonce();

  const authorizeUrl = buildAuthorizeUrl({
    redirectUri,
    state,
    nonce,
    codeChallenge,
    /* `prompt` は付けない。
     *
     * ここには「共有 PC / アカウント切り替えのために毎回ログイン画面を出す」意図で
     * `prompt=login` が入っていた (2026-04-13, 08821a5)。**Shopify Customer Account
     * API はその値を持たない**。同 API の authorize が定義している prompt は `none`
     * だけで、意味も逆 (ログイン画面を出さない) である。
     *   https://shopify.dev/docs/api/customer/2025-07 — "prompt … Value `none`"
     *
     * 2026-08-25 の本番ログが、この 1 個のパラメータで説明できる:
     *
     *   21:50:10 / 21:51:09  /api/auth/logout        (Shopify 側 SSO も落とす)
     *   21:51:14.522         /api/auth/login         (勝手に 2 回叩かれている)
     *   21:51:15.753         /api/auth/login
     *   ── ここから 2 分半、`/api/auth/callback` へのリクエストが 1 件も無い ──
     *   21:53:45.969         /api/auth/login
     *   21:53:46.961         /api/auth/callback      ← 992 ミリ秒後
     *
     * 利用者はこの 2 分半のあいだ、Shopify のコード入力画面で受信したコードを
     * 繰り返し入れ、そのたびにエラーを見ていた。**それが一度もこちらに戻って来て
     * いない** = 失敗は Shopify の authorize の中で起きており、こちらの callback は
     * そもそも呼ばれていない。ログイン画面もコードのメールも出ている以上、弾かれた
     * のは認証の後段 (code を発行する段) である。
     *
     * そして 21:53:45→46 の 992 ミリ秒は、人がログイン画面を操作できる時間ではない。
     * つまり **同じ `prompt=login` を付けたまま、Shopify はセッションがあれば無言で
     * code を返している** — 「毎回ログイン画面を出す」という当初の狙いは最初から
     * 効いていない。セッションが有る時は素通り、無い時は落ちる。これは `none` の
     * 挙動であって `login` の挙動ではない。
     *
     * よって「共有 PC の担保が失われる」という理由でこれを残すことはできない。
     * その担保は元々ここには無く、`/api/auth/logout` の RP-initiated logout
     * (id_token_hint 付きで Shopify 側 SSO を落とす) が実際に果たしている。そちらは
     * 一切変えていない。 */
  });

  const response = NextResponse.redirect(authorizeUrl);

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: PENDING_AUTH_TTL_MS / 1000, // 10 minutes
  };

  // Preserve the locale for post-login redirect
  const locale = request.nextUrl.searchParams.get("locale") || "ja";

  // Preserve an in-site return path so flows that need a round trip through
  // login (e.g. LINE account linking at /{locale}/link) can resume where they
  // left off. Only same-site relative paths survive `sanitizeReturnTo`, so a
  // crafted `?returnTo=https://evil.example` cannot turn this login route into
  // an open redirect. Absent/rejected values simply fall back to /{locale}/account.
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  /* この試行を「進行中のログイン」として **追記** する (上書きしない)。
   *
   * ここは以前 `shop_cv` / `shop_state` / `shop_nonce` / `shop_locale` /
   * `shop_return_to` という **1 個ずつしかないクッキー** に毎回上書きしていた。
   * つまりログイン開始が 2 回走ると、1 回目の試行に必要な値が消える。
   *
   * メール (ワンタイムコード) ログインは「開始 → メールを見に行く → 戻ってコードを
   * 入れる」という往復があり、その最中に利用者がもう一度ボタンを押す・別タブを開く
   * ことが普通に起きる。実測でも `/api/auth/login` は **1.23 秒差で 2 回** 叩かれて
   * いた (2026-08-25 21:51:14.522 / 21:51:15.753 JST)。
   *
   * 上書きが起きた状態でコード入力が終わると、callback 側は
   *   - state 不一致 → `invalid_state` (当時ログを 1 行も残さない経路だった)
   *   - nonce 不一致 → id_token 棄却 (token 交換は **成功済み**)
   * のどちらかで弾く。Shopify 側のログインは成立しているので、直後の再試行は通る。
   * これが「エラーが出たのに、マイページを見たらログインできている」の作られ方。
   *
   * state をキーに複数保持することで、同時に走った試行がどれも成立する。 */
  const pending = addPendingAuth(
    parsePendingAuths(request.cookies.get(PENDING_AUTH_COOKIE)?.value),
    { state, verifier: codeVerifier, nonce, locale, returnTo, createdAt: Date.now() },
  );
  response.cookies.set(PENDING_AUTH_COOKIE, serializePendingAuths(pending), cookieOptions);

  /* 旧クッキーも当面は書く。**デプロイをまたいで進行中のログイン**（旧 build の
   * /api/auth/login で始まり、新 build の callback に戻ってくる往復）を落とさない
   * ため。callback は新クッキーを先に見て、無いときだけこちらに落ちる。
   * 単独の試行しか無ければ両者は同じ値を指すので、挙動は変わらない。 */
  response.cookies.set(COOKIE_NAME.shopCodeVerifier, codeVerifier, cookieOptions);
  response.cookies.set(COOKIE_NAME.shopState, state, cookieOptions);
  response.cookies.set(COOKIE_NAME.shopNonce, nonce, cookieOptions);
  response.cookies.set(COOKIE_NAME.shopLocale, locale, cookieOptions);
  if (returnTo) {
    response.cookies.set(COOKIE_NAME.shopReturnTo, returnTo, cookieOptions);
  }

  return response;
}

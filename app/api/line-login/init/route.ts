import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getBaseUrl, getRequestHostname, isTrustedAuthHost } from "@/lib/base-url";
import { getCookieSpec, isSecure, resolveCookieDomain } from "@/lib/auth/cookies";
import { wantsAutoLoginDisabled } from "@/lib/line/auto-login";
import { lineAuthBaseUrl } from "@/lib/line/endpoints";
import {
  loginBotPrompt,
  loginScopeParam,
  resolveLoginChannelId,
} from "@/lib/line/login-channel";
import { reportChannelNamespace } from "@/lib/line/login-channel-report";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";

/**
 * LINE Login state initialization endpoint.
 *
 * POST /api/line-login/init → { authUrl }
 *
 * Why this exists (do not remove without understanding):
 *
 * Chrome iOS does not trigger LINE's Universal Link when the tap lands on an
 * elxea-owned URL that then server-redirects (302) to access.line.me. The
 * Universal Link is only honored when the browser follows an `<a href>` whose
 * destination host is already access.line.me at tap time. Safari iOS is more
 * forgiving and will follow the redirect, but Chrome iOS is not.
 *
 * Fix: assemble the authorize URL client-side and render
 * `<a href="https://access.line.me/oauth2/v2.1/authorize?...">` directly. To
 * keep the CSRF state HttpOnly, the client POSTs here first; this endpoint
 * generates + sets the state cookie and returns the fully-formed authUrl.
 *
 * The legacy GET /api/line-login (server redirect) remains for back-compat
 * and is safe to remove once all clients ship the new button.
 */
export async function POST(request: NextRequest) {

  /* Fail closed on a host that is not ours.
   *
   * This is the fix for "login from a preview lands on the production top page".
   * `NEXTAUTH_URL` is not set in the preview environment (verified 2026-08-18 by
   * listing variable names only), while Vercel injects
   * `VERCEL_PROJECT_PRODUCTION_URL` into every environment — so `getBaseUrl()`
   * resolved to the PRODUCTION origin on previews, and the LINE round trip
   * quietly delivered the user to production instead of the deployment they were
   * testing. Silently sending someone to a different deployment is worse than
   * refusing, so an untrusted host now gets a legible 503 instead.
   *
   * `isTrustedAuthHost` is satisfied by any host at or under our apex, so
   * production and www are unaffected without any configuration. */
  const hostname = getRequestHostname(request);
  if (!isTrustedAuthHost(hostname)) {
    return NextResponse.json(
      { error: "auth_host_not_registered", host: hostname },
      { status: 503 },
    );
  }
  /* 読み方は `resolveLoginChannelId()` に寄せる (生の `process.env.AUTH_LINE_ID` は
   * 読まない)。理由の本体は `/api/line-login/route.ts` の同じ箇所と
   * `lib/line/login-channel.ts` の `resolveLoginChannelId` に書いてある —
   * 要するに trim の有無で認可 URL と token 交換が別の値を使い、しかも
   * ヘルスチェックは緑のままになる。
   *
   * ⚠ ログイン用の `AUTH_LINE_ID` と、連携 (LIFF) 用の `LINE_LIFF_CHANNEL_ID` は
   *   別のチャネルを指す別の env。ここを後者に置き換えてはならない。 */
  const channelId = resolveLoginChannelId();
  if (!channelId) {
    /* 503, not 500. The channel is not broken, it is not configured for this
     * deployment — a preview without LINE credentials is an expected state, not
     * an internal error. The login button reads this and stays disabled with a
     * specific reason instead of offering a control that cannot work. */
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const state = crypto.randomBytes(32).toString("hex");
  /* OIDC `nonce`（D11）。state とは別に発行する — state は認可応答をこのブラウザに束縛し、
   * nonce は戻ってきた id_token をこの認可要求に束縛する（OIDC Core §3.1.3.7 step 11）。
   * 同じ値を使い回すと、URL に露出する state から nonce も知れてしまう。 */
  const nonce = crypto.randomBytes(32).toString("hex");

  /* The cookie must be readable on both elxea.com and www.elxea.com. This POST
   * may land on either host (whichever the user opened), but the callback always
   * returns to the one host pinned in env. A host-only cookie would miss the
   * opposite host and the CSRF state check would fail — seen in production as
   * "セッションの有効期限が切れました".
   *
   * The Domain is derived from the REQUEST, not from `getBaseUrl()`. Deriving it
   * from env meant the issuing Domain and the deleting Domain came from different
   * inputs, and under Next 16 the env-derived host is unrelated to the host the
   * request actually arrived on. */
  const baseUrl = getBaseUrl(request);
  const cookieDomain = resolveCookieDomain(request);
  const stateSpec = getCookieSpec(COOKIE_NAME.lineOauthState)!;

  const nonceSpec = getCookieSpec(COOKIE_NAME.lineOauthNonce)!;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME.lineOauthState, state, {
    httpOnly: true,
    secure: isSecure(stateSpec),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  /* nonce cookie は state cookie と同じ scope・同じ寿命で出す。片方だけが届く状態
   * （= 検証できない状態）を作らないため、条件分岐なしで必ず両方を出す。 */
  cookieStore.set(COOKIE_NAME.lineOauthNonce, nonce, {
    httpOnly: true,
    secure: isSecure(nonceSpec),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const redirectUri = `${baseUrl}/api/line-callback`;

  /* No `prompt` parameter.
   *
   * This used to send `prompt: "consent"`, with a comment claiming it was needed
   * "to ensure fresh token exchange". That is not what it does. LINE's own
   * documentation states that `prompt=consent` forces the consent screen even
   * when the user has already granted every requested permission — so returning
   * users were made to re-consent on every single login. Token exchange is
   * established by `code` + `state` + `code_verifier` and is unaffected by this
   * parameter, so the stated reason did not hold.
   *
   * The Shopify authorize URL keeps its `prompt=login` — that one is deliberate
   * (shared devices / account switching) and is a different parameter on a
   * different IdP. `__tests__/authorize-url-prompt.test.ts` asserts both facts
   * together so that removing one is never mistaken for licence to remove the
   * other.
   *
   * Not sending `prompt` is also half of what makes the phone open the LINE app
   * instead of the access.line.me email/QR screen: `prompt=login` disables LINE's
   * auto login, and auto login is the only documented path into the app. The
   * other half is that the button navigates on a real `<a>` tap. There is no
   * parameter that forces the app hand-off, so those two omissions ARE the
   * feature. See `lib/line/auto-login.ts` for the sources and for the retry that
   * catches the case where the OS refuses to honour the Universal Link. */
  /* 名前空間ガード（M-0）。詳細は lib/line/login-channel-report.ts。 */
  reportChannelNamespace("line-login-init");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    nonce,
    scope: loginScopeParam(),
  });
  /* `bot_prompt` は 2026-08-25 に復活（新チャネル 2011239425 が本番 OA `@307tzhkw` を
   * 紐付け済みになったため）。判断の中身は `lib/line/login-channel.ts`。
   * ⚠ `prompt` とは別のパラメータである。上の長い注記が禁じているのは `prompt` の方で、
   * `bot_prompt` は auto login を無効化しない。 */
  const botPrompt = loginBotPrompt();
  if (botPrompt) params.set("bot_prompt", botPrompt);

  if (wantsAutoLoginDisabled(request)) {
    params.set("disable_auto_login", "true");
  }

  const authUrl = `${lineAuthBaseUrl()}/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.json({ authUrl });
}

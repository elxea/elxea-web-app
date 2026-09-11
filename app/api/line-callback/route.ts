import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBaseUrl, getRequestOrigin } from "@/lib/base-url";
import { encryptToken } from "@/lib/shopify/customer";
import {
  clearFlowCookie,
  getCookieSpec,
  isSecure,
  resolveCookieDomain,
} from "@/lib/auth/cookies";
import {
  AUTO_LOGIN_FAILED_PARAM,
  AUTO_LOGIN_FAILED_VALUE,
} from "@/lib/line/auto-login";
import { verifyLineIdToken } from "@/lib/line/verify-liff-token";
import { lineApiBaseUrl } from "@/lib/line/endpoints";
import {
  resolveLoginChannelId,
  resolveLoginChannelSecret,
} from "@/lib/line/login-channel";
import {
  classifyTokenExchangeError,
  reportMisconfiguredChannel,
} from "@/lib/line/token-error";

/**
 * LINE Login OAuth 2.0 callback endpoint.
 *
 * GET /api/line-callback?code=xxx&state=xxx
 *
 * Exchanges authorization code for tokens, gets user profile,
 * links LINE userId to cx-agent, and redirects to login complete page.
 */

/**
 * I4: Resolve locale from cookie or accept-language header, defaulting to "ja".
 */
function resolveLocale(request: NextRequest): string {
  // Check NEXT_LOCALE cookie first (set by next-intl)
  const localeCookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (localeCookie && /^[a-z]{2}$/.test(localeCookie)) {
    return localeCookie;
  }
  // Fall back to accept-language header
  const acceptLang = request.headers.get("accept-language") ?? "";
  if (acceptLang.startsWith("en")) return "en";
  return "ja";
}

export async function GET(request: NextRequest) {
  /* Redirect targets are built from the origin the USER addressed, not from
   * `request.url`.
   *
   * `request.url` / `nextUrl` report the origin the server is bound to. On Vercel
   * that coincides with the request host, which is why this route appeared to
   * work; anywhere else — a dev server, anything behind a proxy — it does not,
   * and the callback bounced the user to the server's own origin. Landing on a
   * different origin also means the apex-scoped session cookies just issued do
   * not apply there, so the user arrives logged out.
   *
   * `getRequestOrigin` is fail-closed: an unrecognised Host falls back to
   * `nextUrl.origin`, so a spoofed header cannot turn this into an open
   * redirect. */
  const requestOrigin = getRequestOrigin(request);
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const locale = resolveLocale(request);

  /* Expire the one-shot state cookie at BOTH scopes, on whatever response we end
   * up returning.
   *
   * It cannot be done through `cookieStore.delete()`: that store is keyed by
   * cookie name and can hold only one directive per name, so it can express one
   * scope, never two. And one scope is not enough here — `/api/line-login/init`
   * issued this cookie Domain-scoped while the legacy `/api/line-login` issued it
   * host-only, so after this deploys both shapes exist in real browsers. The old
   * code additionally derived the Domain from `getBaseUrl()` (env) rather than
   * from the request, which is a different input from the one used at issue time;
   * that mismatch is what made the delete a silent no-op.
   *
   * ## なぜ handler の先頭で定義するのか (2026-08-25 に塞いだ穴)
   *
   * 以前これは state 照合のあとで定義されており、その結果 **`if (error)` の枝だけが
   * 掃除を通らなかった**。LINE 側でユーザーが「キャンセル」を押すと、この route は
   * `?error=...` で呼ばれてそのまま login へ戻す — `line_oauth_state` と
   * `line_oauth_nonce` を残したまま。使い捨てのはずの値が自然失効 (10 分) まで
   * ブラウザに残り、次の往復がその古い値と突き合わせられる状態が生まれていた。
   * 「往復が終わったら必ず落とす」を守れる唯一の書き方は、**掃除の定義を、途中で
   * return しうるどの分岐よりも前に置く**こと。 */
  const clearState = <T extends NextResponse>(res: T): T => {
    clearFlowCookie(res, "line_oauth_state");
    /* nonce も同じ往復の使い捨て値。state だけ消して nonce を残すと、次の試行が
     * 前回の nonce と突き合わせられる状態が生まれる。必ず一緒に落とす。 */
    clearFlowCookie(res, "line_oauth_nonce");
    return res;
  };

  // Handle LINE auth errors
  if (error) {
    console.error("[line-callback] LINE auth error:", error);
    /* この往復はここで終わり。使い捨ての state / nonce を残さない。 */
    return clearState(
      NextResponse.redirect(new URL(`/${locale}/login?error=LineAuthFailed`, requestOrigin)),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=MissingParams`, requestOrigin));
  }

  // Verify state (CSRF protection)
  const cookieStore = await cookies();
  const savedState = cookieStore.get("line_oauth_state")?.value;

  if (!savedState || savedState !== state) {
    /* A mismatch has two possible causes and LINE says they are indistinguishable:
     * a CSRF attempt, or an auto login that failed (LINE still redirects here,
     * but with an unusable `code` and a `state` that does not match). We keep
     * treating it as a hard failure — nothing below this point runs — and only
     * add a hint to the redirect so the login screen can offer a retry with
     * `disable_auto_login=true`. Without it the user re-enters the same failing
     * auto login and loops.
     *
     * The hint carries no authority: it never relaxes a check, it only changes
     * which authorize URL the next attempt builds.
     * https://developers.line.biz/en/docs/line-login/how-to-handle-auto-login-failure/ */
    console.error("[line-callback] State mismatch");
    const retryUrl = new URL(`/${locale}/login?error=StateMismatch`, requestOrigin);
    retryUrl.searchParams.set(AUTO_LOGIN_FAILED_PARAM, AUTO_LOGIN_FAILED_VALUE);
    return NextResponse.redirect(retryUrl);
  }

  const baseUrl = getBaseUrl(request);
  const stateDomain = resolveCookieDomain(request);

  /* 生の `process.env` を読まない。`vercel env add` に標準入力で値を流し込むと
     末尾の改行まで保存され、Channel Secret なら「32 文字 + 見えない 1 文字」に
     なる — ダッシュボードでは正しく見え、LINE の `400 invalid_client` でしか
     気づけない。連携側は 2026-08-22 にこれで壊れて trim 済みだったが、ログイン側
     だけ生読みが残っていた。`lib/line/login-channel.ts` の doc を読むこと。 */
  const channelId = resolveLoginChannelId();
  const channelSecret = resolveLoginChannelSecret();

  if (!channelId || !channelSecret) {
    return clearState(NextResponse.redirect(new URL(`/${locale}/login?error=NotConfigured`, requestOrigin)));
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(`${lineApiBaseUrl()}/oauth2/v2.1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${baseUrl}/api/line-callback`,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[line-callback] Token exchange failed:", err);

      /* 「もう一度お試しください」と言ってよい失敗と、言ってはいけない失敗を分ける。
       *
       * LINE は token 交換の失敗をほぼ全て 400 に畳むが、`invalid_client` だけは
       * 意味が違う: **こちらのチャネル設定が壊れている**ので、何度やり直しても
       * 必ず同じところで落ちる。2026-08-22 / 2026-08-25 の本番障害はどちらもこれで、
       * 画面はその間ずっと「もう一度お試しください」と案内し続けた。直らないものを
       * 直るかのように見せて、利用者に無意味な再試行をさせていた。
       *
       * 分けたうえで Sentry に即時で上げる。ログだけだと、このプロジェクトの
       * Runtime Logs 保持 (1 時間) を越えた区間は永久に消える。 */
      const { kind, code } = classifyTokenExchangeError(tokenRes.status, err);
      if (kind === "misconfigured-channel") {
        reportMisconfiguredChannel({
          source: "line-callback",
          channel: "login",
          code,
        });
        return clearState(
          NextResponse.redirect(
            new URL(`/${locale}/login?error=MisconfiguredChannel`, requestOrigin),
          ),
        );
      }

      return clearState(NextResponse.redirect(new URL(`/${locale}/login?error=TokenFailed`, requestOrigin)));
    }

    const tokens = await tokenRes.json();

    // Get user profile
    const profileRes = await fetch(`${lineApiBaseUrl()}/v2/profile`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      console.error("[line-callback] Profile fetch failed");
      return clearState(NextResponse.redirect(new URL(`/${locale}/login?error=ProfileFailed`, requestOrigin)));
    }

    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName;

    /* Verify the id_token, and bind it to THIS authorization request (D11).
     *
     * What changed and why it is now fatal:
     *
     * The previous shape asked LINE to verify the token, then used the result only
     * to read `email` — and on any failure it fell through with `email = null` and
     * carried on logging the user in. That made the verification decorative: a
     * token that failed every check produced the same session as one that passed.
     * Worse, nothing checked `nonce` at all, so an id_token minted for a different
     * authorization request could be presented here and the flow would not notice
     * (OIDC Core §3.1.3.7 step 11 — the gap the design doc tracks as D11).
     *
     * It is now a gate. `verifyLineIdToken` checks signature-equivalent validity
     * via LINE's verify endpoint plus aud / iss / exp / **nonce** locally, and a
     * failure aborts the login before any session cookie is written. The cost of
     * fail-closed here is one retry for a user; the cost of fail-open is a session
     * established from a token we never established the provenance of.
     *
     * A missing `line_oauth_nonce` cookie is a failure, not a reason to skip the
     * check — anything an attacker can supply, they can also omit. Both init
     * routes issue the cookie alongside `line_oauth_state`, which has the same
     * 10-minute lifetime, so the only users who meet this are ones mid-flight
     * across the deploy; they land on the login screen and start again. */
    const rejectIdToken = (reason: string) => {
      console.warn(`[line-callback] id_token rejected: ${reason}`);
      return clearState(
        NextResponse.redirect(new URL(`/${locale}/login?error=InvalidIdToken`, requestOrigin)),
      );
    };

    const savedNonce = cookieStore.get("line_oauth_nonce")?.value;
    if (!savedNonce) return rejectIdToken("no nonce cookie for this round trip");

    const verified = await verifyLineIdToken(tokens.id_token, channelId, {
      expectedNonce: savedNonce,
    });
    if (!verified.ok) return rejectIdToken(verified.reason);

    /* Cross-check the two sources of "who is this". `lineUserId` came from the
     * profile API (authenticated by the access token); `sub` came from the
     * id_token we just verified. They describe the same LINE user and must agree.
     * They are separate values from separate calls, so a disagreement means one of
     * the two responses does not belong to this exchange — which is precisely the
     * confusion an attacker would need to engineer. Cheap check, and it fails
     * closed. */
    if (lineUserId !== verified.payload.sub) {
      return rejectIdToken("profile userId does not match id_token sub");
    }

    const email: string | null = verified.email;

    // Link LINE userId to cx-agent identity
    const chatApiBase = (
      process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
    ).replace(/\/api\/chat\/?$/, "");

    const chatSessionId = cookieStore.get("chat_session_id")?.value;

    // C1: Include X-API-Key for identity linking. In production, never call the worker without it
    // (avoids silently sending unauthenticated requests).
    const syncApiSecret = process.env.SYNC_API_SECRET;
    const isProd = process.env.NODE_ENV === "production";
    const shouldLinkIdentity = !isProd || Boolean(syncApiSecret);

    if (isProd && !syncApiSecret) {
      console.error(
        "[line-callback] SYNC_API_SECRET not set; skipping identity link (set in production)",
      );
    }

    if (shouldLinkIdentity) {
      try {
        const linkHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (syncApiSecret) {
          linkHeaders["X-API-Key"] = syncApiSecret;
        }
        await fetch(`${chatApiBase}/api/identity/link-line`, {
          method: "POST",
          headers: linkHeaders,
          body: JSON.stringify({
            line_user_id: lineUserId,
            email,
            display_name: displayName,
            session_id: chatSessionId ?? null,
          }),
        });
      } catch (e) {
        console.error("[line-callback] Identity link failed:", e);
        // Don't block login on link failure
      }
    }

    // I5: Store only displayName in cookie (userId stays server-side only)
    const lineUserCookie = JSON.stringify({
      displayName,
    });

    const response = NextResponse.redirect(new URL(`/${locale}/login/complete?linked=true`, requestOrigin));

    /* Scope session cookies to the apex so the user stays logged in whether they
     * browse `elxea.com` or `www.elxea.com`. See the init route for context.
     *
     * `secure` now follows the registry's prod-only rule instead of being pinned
     * to `true`. In production the value is identical (`NODE_ENV === "production"`),
     * so behaviour there is unchanged; the difference is that the flow becomes
     * observable over plain http locally and in Ring 2, where a Secure cookie is
     * simply not stored and the Domain-scoped deletion under test could never be
     * verified. */
    const lineSessionSecure = isSecure(getCookieSpec("line_session")!);
    const sharedCookieOpts = {
      ...(stateDomain ? { domain: stateDomain } : {}),
      secure: lineSessionSecure,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    };

    response.cookies.set("line_user", lineUserCookie, {
      ...sharedCookieOpts,
      httpOnly: false, // readable by client
    });

    // Phase 1/2: dedicated client-visible flag so header / favorite-button /
    // follow-button etc. can recognize LINE-authenticated users without
    // masquerading as a Shopify session. We intentionally DO NOT set
    // `shop_auth` here — that cookie is reserved for genuine Shopify
    // sessions so that identity resolution (auth-guard) stays unambiguous.
    response.cookies.set("line_auth", "1", {
      ...sharedCookieOpts,
      httpOnly: false,
    });

    // Phase 1/2: encrypted LINE user id. Used by `resolveIdentity()` to derive
    // `userKey = "line:" + lineUserId` for Firestore subcollection lookups,
    // and by the Shopify OAuth callback to merge LINE-only data into the
    // Shopify user key after account linking.
    response.cookies.set("line_uid", encryptToken(lineUserId), {
      ...sharedCookieOpts,
      httpOnly: true,
    });

    // P1-fix: Set line_session=1 (httpOnly) so middleware can recognize LINE-authenticated users
    // for /account route protection without requiring Shopify tokens.
    response.cookies.set("line_session", "1", {
      ...sharedCookieOpts,
      httpOnly: true,
    });

    // Redirect to login complete page
    return clearState(response);
  } catch (err) {
    console.error("[line-callback] Unexpected error:", err);
    return clearState(NextResponse.redirect(new URL(`/${locale}/login?error=Unexpected`, requestOrigin)));
  }
}

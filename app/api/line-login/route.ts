import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getBaseUrl, getRequestHostname, isTrustedAuthHost } from "@/lib/base-url";
import { getCookieSpec, isSecure, resolveCookieDomain } from "@/lib/auth/cookies";
import { wantsAutoLoginDisabled } from "@/lib/line/auto-login";

/**
 * Direct LINE Login OAuth 2.0 redirect endpoint.
 *
 * GET /api/line-login → 302 redirect to access.line.me
 *
 * This route is kept at /api/line-login (outside /api/auth/)
 * for clarity, separating LINE OAuth from Shopify OAuth routes.
 *
 * Uses <a href="/api/line-login"> for Universal Links to work:
 * - Mobile: LINE app opens directly via Universal Links
 * - Desktop: LINE shows QR code login page
 *
 * After LINE auth, callback goes to /api/line-callback
 */
export async function GET(request: NextRequest) {

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
  const channelId = process.env.AUTH_LINE_ID;
  if (!channelId) {
    // Same rationale as /api/line-login/init: unconfigured, not broken.
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString("hex");
  /* OIDC nonce (D11). Issued here too, not only in /init: the callback verifies the
   * id_token's nonce unconditionally, so a login started through this legacy
   * redirect would fail closed if it did not carry one. Same value rules as /init
   * — a separate random value from `state`, same cookie scope and lifetime. */
  const nonce = crypto.randomBytes(32).toString("hex");

  /* Store state in a cookie for verification in the callback.
   *
   * This route previously set the state cookie with NO Domain while
   * /api/line-login/init set the same cookie Domain-scoped to the apex. Two
   * routes issuing one cookie at two different scopes means the callback's
   * single-scope delete can only ever match one of them, and a state cookie
   * issued here was invisible to a callback arriving on the sibling host.
   * Both routes now go through the same registry-driven scope. */
  const cookieStore = await cookies();
  const stateSpec = getCookieSpec("line_oauth_state")!;
  const cookieDomain = resolveCookieDomain(request);
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure: isSecure(stateSpec),
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  const nonceSpec = getCookieSpec("line_oauth_nonce")!;
  cookieStore.set("line_oauth_nonce", nonce, {
    httpOnly: true,
    secure: isSecure(nonceSpec),
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const baseUrl = getBaseUrl(request);

  const redirectUri = `${baseUrl}/api/line-callback`;

  // Note: bot_prompt=aggressive removed 2026-04-13. The production LINE Official
  // Account (@307tzhkw) is owned under a different LINE Developers Console
  // provider (channel 2008324925, 404 from setaka-on@elxea.com). Linked OA on
  // the elxea provider's LINE Login channel can only point to the test OA
  // (@426vlcyb), which is wrong for production users. Until the channel
  // ownership is reconciled, login proceeds without the friend-add prompt.
  // Restore bot_prompt: "aggressive" once the production OA's channel can be
  // linked to this LINE Login channel.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state: state,
    nonce,
    scope: "profile openid email",
  });

  // Same auto-login-failure escape hatch as the init route; see lib/line/auto-login.ts.
  if (wantsAutoLoginDisabled(request)) {
    params.set("disable_auto_login", "true");
  }

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}

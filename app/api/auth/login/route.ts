import { NextRequest, NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  buildAuthorizeUrl,
} from "@/lib/shopify/customer";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { getRequestHostname, getRequestOrigin, isRegisteredAuthHost } from "@/lib/base-url";

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
   * `isRegisteredAuthHost` is fail-open while `LINE_ALLOWED_CALLBACK_HOSTS` is
   * unset — which it currently is in production (verified 2026-08-18 by listing
   * variable names only). So this is inert until somebody deliberately turns it
   * on, and turning it off again is a single env deletion with no deploy. */
  const hostname = getRequestHostname(request);
  if (!isRegisteredAuthHost(hostname)) {
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
    // Force Shopify to show its login form every time instead of silently
    // re-authenticating via its SSO cookie. This is required for shared
    // devices and account switching: without prompt=login, a user who
    // logged out of elxea but still has a Shopify SSO cookie would be
    // instantly logged back in as the previous account.
    prompt: "login",
  });

  const response = NextResponse.redirect(authorizeUrl);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  };

  response.cookies.set("shop_cv", codeVerifier, cookieOptions);
  response.cookies.set("shop_state", state, cookieOptions);
  response.cookies.set("shop_nonce", nonce, cookieOptions);

  // Preserve the locale for post-login redirect
  const locale = request.nextUrl.searchParams.get("locale") || "ja";
  response.cookies.set("shop_locale", locale, cookieOptions);

  // Preserve an in-site return path so flows that need a round trip through
  // login (e.g. LINE account linking at /{locale}/link) can resume where they
  // left off. Only same-site relative paths survive `sanitizeReturnTo`, so a
  // crafted `?returnTo=https://evil.example` cannot turn this login route into
  // an open redirect. Absent/rejected values simply fall back to /{locale}/account.
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  if (returnTo) {
    response.cookies.set("shop_return_to", returnTo, cookieOptions);
  }

  return response;
}

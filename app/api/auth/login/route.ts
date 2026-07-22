import { NextRequest, NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  buildAuthorizeUrl,
} from "@/lib/shopify/customer";
import { sanitizeReturnTo } from "@/lib/auth/return-to";

export async function GET(request: NextRequest) {
  // NEXT_PUBLIC_APP_URL allows overriding the redirect URI base (e.g. for tunnels in local dev)
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
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

import { NextRequest, NextResponse } from "next/server";
import { buildLogoutUrl, decryptToken } from "@/lib/shopify/customer";

/**
 * Logout endpoint.
 *
 * Flow:
 *   1. Client cookies are cleared on *this* response.
 *   2. We redirect the user to Shopify's RP-initiated logout endpoint with
 *      `id_token_hint` so Shopify also drops its SSO cookie.
 *   3. Shopify then redirects back to `post_logout_redirect_uri` (locale home).
 *
 * Without step 2, the next call to /api/auth/login would silently
 * re-authenticate the previous user via Shopify's SSO cookie — a critical
 * account-switching / shared-PC security issue.
 *
 * Ref: OpenID Connect RP-Initiated Logout 1.0
 *   https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") || "ja";
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const postLogoutRedirectUri = `${origin}/${locale}`;

  // Decrypt id_token (if present) to use as id_token_hint for Shopify logout.
  const encryptedIdToken = request.cookies.get("shop_it")?.value;
  const idTokenHint = encryptedIdToken ? decryptToken(encryptedIdToken) ?? undefined : undefined;

  const shopifyLogoutUrl = buildLogoutUrl({
    idTokenHint,
    postLogoutRedirectUri,
  });

  // Redirect first to Shopify's logout endpoint; Shopify then bounces the
  // user back to postLogoutRedirectUri. Cookies are cleared on this redirect
  // response so the browser has no local auth state during the round-trip.
  const response = NextResponse.redirect(shopifyLogoutUrl);

  // Clear ALL auth-related cookies (Shopify + LINE) with explicit path.
  const deleteOptions = { path: "/", maxAge: 0 } as const;
  // Shopify cookies
  response.cookies.set("shop_at", "", deleteOptions);
  response.cookies.set("shop_rt", "", deleteOptions);
  response.cookies.set("shop_exp", "", deleteOptions);
  response.cookies.set("shop_auth", "", deleteOptions);
  response.cookies.set("shop_cid", "", deleteOptions);
  response.cookies.set("shop_it", "", deleteOptions);
  // LINE cookies
  response.cookies.set("line_user", "", deleteOptions);
  response.cookies.set("line_session", "", deleteOptions);
  response.cookies.set("line_auth", "", deleteOptions);
  response.cookies.set("line_uid", "", deleteOptions);

  return response;
}

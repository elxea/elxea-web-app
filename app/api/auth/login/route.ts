import { NextRequest, NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  buildAuthorizeUrl,
} from "@/lib/shopify/customer";

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

  return response;
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getBaseUrl } from "@/lib/base-url";

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
export async function GET() {
  const channelId = process.env.AUTH_LINE_ID;
  if (!channelId) {
    return NextResponse.json(
      { error: "LINE Login not configured" },
      { status: 500 }
    );
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString("hex");

  // Store state in cookie for verification in callback
  const cookieStore = await cookies();
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const baseUrl = getBaseUrl();

  const redirectUri = `${baseUrl}/api/line-callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state: state,
    scope: "profile openid email",
    bot_prompt: "aggressive",
    prompt: "consent", // Always show consent screen to ensure fresh token exchange
  });

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}

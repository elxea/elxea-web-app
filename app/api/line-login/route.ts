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
    scope: "profile openid email",
    prompt: "consent", // Always show consent screen to ensure fresh token exchange
  });

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}

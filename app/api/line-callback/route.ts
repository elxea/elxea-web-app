import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * LINE Login OAuth 2.0 callback endpoint.
 *
 * GET /api/line-callback?code=xxx&state=xxx
 *
 * Exchanges authorization code for tokens, gets user profile,
 * links LINE userId to cx-agent, and redirects to login complete page.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle LINE auth errors
  if (error) {
    console.error("[line-callback] LINE auth error:", error);
    return NextResponse.redirect(new URL("/ja/login?error=LineAuthFailed", request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/ja/login?error=MissingParams", request.url));
  }

  // Verify state (CSRF protection)
  const cookieStore = await cookies();
  const savedState = cookieStore.get("line_oauth_state")?.value;

  if (!savedState || savedState !== state) {
    console.error("[line-callback] State mismatch");
    return NextResponse.redirect(new URL("/ja/login?error=StateMismatch", request.url));
  }

  // Clear state cookie
  cookieStore.delete("line_oauth_state");

  const channelId = process.env.AUTH_LINE_ID;
  const channelSecret = process.env.AUTH_LINE_SECRET;

  if (!channelId || !channelSecret) {
    return NextResponse.redirect(new URL("/ja/login?error=NotConfigured", request.url));
  }

  const baseUrl = process.env.NEXTAUTH_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
    || (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
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
      return NextResponse.redirect(new URL("/ja/login?error=TokenFailed", request.url));
    }

    const tokens = await tokenRes.json();

    // Get user profile
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      console.error("[line-callback] Profile fetch failed");
      return NextResponse.redirect(new URL("/ja/login?error=ProfileFailed", request.url));
    }

    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName;

    // Get email from id_token if available
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        // Decode JWT payload (LINE uses HS256)
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()
        );
        email = payload.email || null;
      } catch {
        // id_token decode failed, continue without email
      }
    }

    // Link LINE userId to cx-agent identity
    const chatApiBase = (
      process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
    ).replace(/\/api\/chat\/?$/, "");

    const chatSessionId = cookieStore.get("chat_session_id")?.value;

    try {
      await fetch(`${chatApiBase}/api/identity/link-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    // Store LINE user info in cookie for client-side access
    const lineUserCookie = JSON.stringify({
      userId: lineUserId,
      displayName,
    });

    cookieStore.set("line_user", lineUserCookie, {
      httpOnly: false, // readable by client
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // Redirect to login complete page
    return NextResponse.redirect(new URL("/ja/login/complete?linked=true", request.url));
  } catch (err) {
    console.error("[line-callback] Unexpected error:", err);
    return NextResponse.redirect(new URL("/ja/login?error=Unexpected", request.url));
  }
}

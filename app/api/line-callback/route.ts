import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBaseUrl } from "@/lib/base-url";

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
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const locale = resolveLocale(request);

  // Handle LINE auth errors
  if (error) {
    console.error("[line-callback] LINE auth error:", error);
    return NextResponse.redirect(new URL(`/${locale}/login?error=LineAuthFailed`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=MissingParams`, request.url));
  }

  // Verify state (CSRF protection)
  const cookieStore = await cookies();
  const savedState = cookieStore.get("line_oauth_state")?.value;

  if (!savedState || savedState !== state) {
    console.error("[line-callback] State mismatch");
    return NextResponse.redirect(new URL(`/${locale}/login?error=StateMismatch`, request.url));
  }

  // Clear state cookie
  cookieStore.delete("line_oauth_state");

  const channelId = process.env.AUTH_LINE_ID;
  const channelSecret = process.env.AUTH_LINE_SECRET;

  if (!channelId || !channelSecret) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=NotConfigured`, request.url));
  }

  const baseUrl = getBaseUrl();

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
      return NextResponse.redirect(new URL(`/${locale}/login?error=TokenFailed`, request.url));
    }

    const tokens = await tokenRes.json();

    // Get user profile
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      console.error("[line-callback] Profile fetch failed");
      return NextResponse.redirect(new URL(`/${locale}/login?error=ProfileFailed`, request.url));
    }

    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName;

    // I1: Verify id_token via LINE verify API before extracting claims
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            id_token: tokens.id_token,
            client_id: channelId,
          }),
        });
        if (verifyRes.ok) {
          const verified = await verifyRes.json();
          email = verified.email || null;
        } else {
          console.warn("[line-callback] id_token verification failed:", await verifyRes.text());
        }
      } catch {
        // id_token verification failed, continue without email
      }
    }

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

    const response = NextResponse.redirect(new URL(`/${locale}/login/complete?linked=true`, request.url));

    response.cookies.set("line_user", lineUserCookie, {
      httpOnly: false, // readable by client
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // P1-fix: Set shop_auth=1 so client-side UI components recognize LINE users as logged in.
    // This non-httpOnly flag is checked by header, favorite-button, follow-button, etc.
    response.cookies.set("shop_auth", "1", {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // P1-fix: Set line_session=1 (httpOnly) so middleware can recognize LINE-authenticated users
    // for /account route protection without requiring Shopify tokens.
    response.cookies.set("line_session", "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // Redirect to login complete page
    return response;
  } catch (err) {
    console.error("[line-callback] Unexpected error:", err);
    return NextResponse.redirect(new URL(`/${locale}/login?error=Unexpected`, request.url));
  }
}

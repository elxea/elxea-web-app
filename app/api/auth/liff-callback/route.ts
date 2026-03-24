/**
 * LIFF Login callback API route.
 *
 * After LIFF SDK authentication, the client sends the LINE user profile
 * and session info here. This route:
 * 1. Verifies the LIFF access token with LINE's API
 * 2. Calls cx-agent /api/identity/link-line to register the identity
 * 3. Returns success so the client can redirect to the complete page
 *
 * This is used for the mobile LIFF login flow as an alternative to
 * Auth.js LINE Provider, which doesn't trigger LINE app direct launch.
 */
import { NextRequest, NextResponse } from "next/server";

const CHAT_API_BASE = (
  process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
)
  .trim()
  .replace(/\/api\/chat\/?$/, "");

const LINE_CHANNEL_ID = process.env.AUTH_LINE_ID;

/**
 * Verify a LINE access token by calling LINE's token verification API.
 * Returns the user ID if valid, null if invalid.
 */
async function verifyLineAccessToken(
  accessToken: string
): Promise<{ client_id: string; expires_in: number; scope: string } | null> {
  try {
    const res = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Get LINE user profile using the access token.
 */
async function getLineProfile(
  accessToken: string
): Promise<{ userId: string; displayName: string } | null> {
  try {
    const res = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, id_token, session_id } = body as {
      access_token?: string;
      id_token?: string;
      session_id?: string;
    };

    if (!access_token) {
      return NextResponse.json(
        { error: "access_token is required" },
        { status: 400 }
      );
    }

    // Step 1: Verify the access token with LINE API
    const tokenInfo = await verifyLineAccessToken(access_token);
    if (!tokenInfo) {
      return NextResponse.json(
        { error: "Invalid access token" },
        { status: 401 }
      );
    }

    // Verify the token belongs to our LINE Login channel
    if (LINE_CHANNEL_ID && tokenInfo.client_id !== LINE_CHANNEL_ID) {
      console.error(
        "[liff-callback] Channel ID mismatch:",
        tokenInfo.client_id,
        "!==",
        LINE_CHANNEL_ID
      );
      return NextResponse.json(
        { error: "Token channel mismatch" },
        { status: 401 }
      );
    }

    // Step 2: Get the user's LINE profile
    const profile = await getLineProfile(access_token);
    if (!profile) {
      return NextResponse.json(
        { error: "Failed to get LINE profile" },
        { status: 500 }
      );
    }

    // Step 3: Call cx-agent identity link API
    try {
      await fetch(`${CHAT_API_BASE}/api/identity/link-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: profile.userId,
          display_name: profile.displayName,
          session_id: session_id ?? null,
          email: null,
        }),
      });
    } catch (e) {
      console.error("[liff-callback] Identity link failed:", e);
      // Do not block login on link failure
    }

    return NextResponse.json({
      success: true,
      line_user_id: profile.userId,
      display_name: profile.displayName,
    });
  } catch (error) {
    console.error("[liff-callback] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

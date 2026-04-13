import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getBaseUrl } from "@/lib/base-url";

/**
 * LINE Login state initialization endpoint.
 *
 * POST /api/line-login/init → { authUrl }
 *
 * Why this exists (do not remove without understanding):
 *
 * Chrome iOS does not trigger LINE's Universal Link when the tap lands on an
 * elxea-owned URL that then server-redirects (302) to access.line.me. The
 * Universal Link is only honored when the browser follows an `<a href>` whose
 * destination host is already access.line.me at tap time. Safari iOS is more
 * forgiving and will follow the redirect, but Chrome iOS is not.
 *
 * Fix: assemble the authorize URL client-side and render
 * `<a href="https://access.line.me/oauth2/v2.1/authorize?...">` directly. To
 * keep the CSRF state HttpOnly, the client POSTs here first; this endpoint
 * generates + sets the state cookie and returns the fully-formed authUrl.
 *
 * The legacy GET /api/line-login (server redirect) remains for back-compat
 * and is safe to remove once all clients ship the new button.
 */
export async function POST() {
  const channelId = process.env.AUTH_LINE_ID;
  if (!channelId) {
    return NextResponse.json(
      { error: "LINE Login not configured" },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(32).toString("hex");

  // Cookie must be readable on both elxea.com and www.elxea.com. The init POST
  // may land on either host (depending on which one the user opened), but the
  // callback always comes back to NEXTAUTH_URL, which is pinned to one host.
  // A host-only cookie would miss the opposite host and the CSRF state check
  // would fail (seen as "セッションの有効期限が切れました" in production).
  // Scope to `.elxea.com` so both hosts share the same cookie jar. On
  // localhost / preview deployments we fall back to host-only.
  const baseUrl = getBaseUrl();
  const hostname = new URL(baseUrl).hostname;
  const cookieDomain =
    hostname === "elxea.com" || hostname.endsWith(".elxea.com")
      ? ".elxea.com"
      : undefined;

  const cookieStore = await cookies();
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const redirectUri = `${baseUrl}/api/line-callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid email",
    prompt: "consent",
  });

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.json({ authUrl });
}

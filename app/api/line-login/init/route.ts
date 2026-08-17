import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getBaseUrl } from "@/lib/base-url";
import { getCookieSpec, isSecure, resolveCookieDomain } from "@/lib/auth/cookies";

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
export async function POST(request: NextRequest) {
  const channelId = process.env.AUTH_LINE_ID;
  if (!channelId) {
    /* 503, not 500. The channel is not broken, it is not configured for this
     * deployment — a preview without LINE credentials is an expected state, not
     * an internal error. The login button reads this and stays disabled with a
     * specific reason instead of offering a control that cannot work. */
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const state = crypto.randomBytes(32).toString("hex");

  /* The cookie must be readable on both elxea.com and www.elxea.com. This POST
   * may land on either host (whichever the user opened), but the callback always
   * returns to the one host pinned in env. A host-only cookie would miss the
   * opposite host and the CSRF state check would fail — seen in production as
   * "セッションの有効期限が切れました".
   *
   * The Domain is derived from the REQUEST, not from `getBaseUrl()`. Deriving it
   * from env meant the issuing Domain and the deleting Domain came from different
   * inputs, and under Next 16 the env-derived host is unrelated to the host the
   * request actually arrived on. */
  const baseUrl = getBaseUrl(request);
  const cookieDomain = resolveCookieDomain(request);
  const stateSpec = getCookieSpec("line_oauth_state")!;

  const cookieStore = await cookies();
  cookieStore.set("line_oauth_state", state, {
    httpOnly: true,
    secure: isSecure(stateSpec),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const redirectUri = `${baseUrl}/api/line-callback`;

  /* No `prompt` parameter.
   *
   * This used to send `prompt: "consent"`, with a comment claiming it was needed
   * "to ensure fresh token exchange". That is not what it does. LINE's own
   * documentation states that `prompt=consent` forces the consent screen even
   * when the user has already granted every requested permission — so returning
   * users were made to re-consent on every single login. Token exchange is
   * established by `code` + `state` + `code_verifier` and is unaffected by this
   * parameter, so the stated reason did not hold.
   *
   * The Shopify authorize URL keeps its `prompt=login` — that one is deliberate
   * (shared devices / account switching) and is a different parameter on a
   * different IdP. `__tests__/authorize-url-prompt.test.ts` asserts both facts
   * together so that removing one is never mistaken for licence to remove the
   * other. */
  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid email",
  });

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

  return NextResponse.json({ authUrl });
}

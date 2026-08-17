import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { buildLogoutUrl, decryptToken } from "@/lib/shopify/customer";
import { getBaseUrl, getRequestHostname, isRegisteredAuthHost } from "@/lib/base-url";

/**
 * Logout endpoint.
 *
 * Flow:
 *   1. Client cookies are cleared on *this* response, whichever branch we take.
 *   2. If — and only if — we hold a usable Shopify `id_token`, we redirect to
 *      Shopify's RP-initiated logout endpoint with `id_token_hint` so Shopify
 *      also drops its SSO cookie.
 *   3. Shopify then redirects back to `post_logout_redirect_uri` (locale home).
 *
 * Without step 2, the next call to /api/auth/login would silently
 * re-authenticate the previous user via Shopify's SSO cookie — a critical
 * account-switching / shared-PC security issue.
 *
 * ## Why step 2 is conditional (defect 1)
 *
 * It used to be unconditional, with `id_token_hint` simply omitted when we had
 * no token. Shopify answers that with `400 invalid_request` (measured against
 * the real endpoint 2026-08-18; see docs/release-gates/gate0-e7121ae.md). A
 * LINE-only user never holds a Shopify `id_token`, so their first-ever logout
 * always failed. Sending a user to a third party to be shown a 400 is worse
 * than not going: there is no Shopify session to end in that case, so local
 * logout is both sufficient and correct.
 *
 * The residual risk — a Shopify SSO cookie surviving when we cannot decrypt our
 * own `shop_it` — is closed on the login side, which sends `prompt=login` on
 * every authorize request and therefore forces re-authentication regardless.
 * `__tests__/authorize-url-prompt.test.ts` pins that.
 *
 * Ref: OpenID Connect RP-Initiated Logout 1.0
 *   https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") || "ja";
  const origin = getBaseUrl(request);
  const localeHome = `${origin}/${locale}`;

  /* Three distinct states, deliberately not collapsed into two.
   *
   * The previous code was `decryptToken(enc) ?? undefined`, which folded
   * "there was no cookie" and "there was a cookie and we could not read it"
   * into one silent case. The second is a real signal — a rotated or corrupted
   * SESSION_SECRET, or tampering — and it should be visible rather than
   * indistinguishable from a normal LINE-only logout. */
  const encryptedIdToken = request.cookies.get("shop_it")?.value;
  let idTokenHint: string | undefined;
  if (encryptedIdToken) {
    const decrypted = decryptToken(encryptedIdToken);
    if (decrypted) {
      idTokenHint = decrypted;
    } else {
      Sentry.captureMessage("logout: shop_it present but could not be decrypted", {
        level: "warning",
        tags: { subsystem: "auth-logout" },
        extra: {
          /* No token material, no host, no cookie value — just the fact and the
           * shape, so this stays safe to ship to an external service. */
          reason: "decrypt_failed",
          encryptedLength: encryptedIdToken.length,
        },
      });
    }
  }

  /* The host gate: `post_logout_redirect_uri` is compared by Shopify against a
   * registered allow-list by exact match. Handing it an origin Shopify does not
   * know produces another IdP-side error, so an unregistered host completes
   * logout locally too. `isRegisteredAuthHost` is fail-open when
   * LINE_ALLOWED_CALLBACK_HOSTS is unset, so this changes nothing until the env
   * var is deliberately set. */
  const hostRegistered = isRegisteredAuthHost(getRequestHostname(request));

  const response =
    idTokenHint && hostRegistered
      ? NextResponse.redirect(
          buildLogoutUrl({ idTokenHint, postLogoutRedirectUri: localeHome }),
        )
      : NextResponse.redirect(localeHome);

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

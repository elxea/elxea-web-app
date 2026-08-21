import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  exchangeToken,
  encryptToken,
  decryptToken,
  getCustomer,
} from "@/lib/shopify/customer";
import { verifyShopifyIdToken } from "@/lib/shopify/id-token";
import { sendWelcomeEmail } from "@/lib/email/welcome";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { getRequestOrigin } from "@/lib/base-url";
import { mergeLineIdentityIntoShopify } from "@/lib/auth/identity-merge";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  /* Was `process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin`. Measured
   * 2026-08-18: that variable is not set in production, so the expression always
   * evaluated to the request origin there — the dead branch is dropped without
   * changing behaviour. See `getRequestOrigin` for why these routes keep the
   * request origin rather than moving to the env chain. */
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const codeVerifier = request.cookies.get("shop_cv")?.value;
  const savedState = request.cookies.get("shop_state")?.value;
  const savedNonce = request.cookies.get("shop_nonce")?.value;
  const locale = request.cookies.get("shop_locale")?.value || "ja";

  // Validate state
  if (!code || !state || !codeVerifier || state !== savedState) {
    return NextResponse.redirect(
      `${origin}/${locale}/account?error=invalid_state`
    );
  }

  try {
    const redirectUri = `${origin}/api/auth/callback`;
    const tokens = await exchangeToken(code, codeVerifier, redirectUri);

    /* Verify the id_token itself — signature, issuer, audience, expiry, and the
     * nonce that binds it to THIS login attempt (QA audit D1 + D11 / 設計書 1-0b).
     *
     * Two separate gaps were closed here, and they are not the same gap:
     *
     *   - **nonce** (#90): `/api/auth/login` generated a nonce, sent it to
     *     Shopify, and stored it in `shop_nonce` — and this route used to delete
     *     that cookie without ever comparing it. `state` binds the authorization
     *     *response* to this browser; only the nonce binds the *id_token* to the
     *     request we made.
     *   - **signature**: even with the nonce compared, the token was being
     *     opened with a plain Base64 decode. The claim that "the back-channel
     *     TLS call already proves the origin" holds for the exchange itself, but
     *     the value read out of it then travels much further — `shop_cid`
     *     decides the Firestore user key the LINE merge writes into, and
     *     `shop_it` comes back at logout as `id_token_hint`. OIDC Core §3.1.3.7
     *     asks for the token to be verified, not the pipe it arrived through.
     *
     * `verifyShopifyIdToken` does both, plus iss/aud/exp, against Shopify's
     * published JWKS (discovered, not hard-coded). Fail-closed and BEFORE any
     * session cookie is written: a rejected token must not leave a
     * half-established session behind. A missing cookie or a missing claim are
     * failures, never reasons to skip a check. */
    const verified = await verifyShopifyIdToken(tokens.id_token, {
      expectedNonce: savedNonce,
    });
    if (!verified.ok) {
      console.warn(`[Auth Callback] id_token rejected: ${verified.reason}`);
      Sentry.captureMessage("Shopify id_token verification failed", {
        level: "warning",
        tags: { subsystem: "shopify-oauth" },
        extra: { reason: verified.reason },
      });
      /* The query value stays `invalid_nonce` for every rejection reason. The
       * account page already maps it to a "start over" message, and telling the
       * outside world *which* of signature / iss / aud / exp / nonce failed hands
       * an attacker a free oracle. The precise reason goes to the log and Sentry. */
      const rejected = NextResponse.redirect(
        `${origin}/${locale}/account?error=invalid_nonce`,
      );
      // One-shot values: a rejected attempt must not leave anything reusable.
      for (const name of ["shop_cv", "shop_state", "shop_nonce", "shop_locale", "shop_return_to"]) {
        rejected.cookies.delete(name);
      }
      return rejected;
    }

    // Post-login destination. Defaults to /{locale}/account (previous fixed
    // behaviour); a flow that needs to resume after login (LINE account linking
    // at /{locale}/link) sets `shop_return_to` when it sends the user to
    // /api/auth/login?returnTo=...
    //
    // `sanitizeReturnTo` only lets same-site relative paths through, so this
    // cannot be abused as an open redirect even if the cookie is tampered with.
    const returnTo = sanitizeReturnTo(request.cookies.get("shop_return_to")?.value);
    const response = NextResponse.redirect(
      new URL(returnTo ?? `/${locale}/account`, origin),
    );

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    };

    // Set session cookies directly on the response
    response.cookies.set("shop_at", encryptToken(tokens.access_token), {
      ...cookieOptions,
      maxAge: tokens.expires_in,
    });
    response.cookies.set("shop_rt", encryptToken(tokens.refresh_token), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    response.cookies.set(
      "shop_exp",
      String(Date.now() + tokens.expires_in * 1000),
      { ...cookieOptions, maxAge: tokens.expires_in }
    );
    response.cookies.set("shop_auth", "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: tokens.expires_in,
    });

    // Preserve the id_token so we can pass it as `id_token_hint` to the
    // Shopify logout endpoint at sign-out time. Without this, RP-initiated
    // logout cannot identify the session to terminate and Shopify SSO
    // cookies are left in place (causing silent re-login on shared PCs).
    response.cookies.set("shop_it", encryptToken(tokens.id_token), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30, // 30 days (must outlive access token)
    });

    /* Cache the Shopify Customer ID. It comes from the **verified** claims above
     * (`sub` = `gid://shopify/Customer/<id>`), not from a second unchecked decode
     * of the same string — so `shop_cid` can only ever hold an id that survived
     * signature + nonce verification. Saves a Customer API call per request. */
    const customerId = verified.customerId;
    response.cookies.set("shop_cid", encryptToken(customerId), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30, // 30 days (same as refresh token)
    });

    // Clean up PKCE cookies
    response.cookies.delete("shop_cv");
    response.cookies.delete("shop_state");
    response.cookies.delete("shop_nonce");
    response.cookies.delete("shop_locale");
    // One-shot: the return path is consumed by this redirect and must not leak
    // into the next login.
    response.cookies.delete("shop_return_to");

    /* Phase 1/2: if this user completed Shopify OAuth while already holding a
     * LINE session, merge their LINE-only Firestore data into the Shopify
     * userKey.
     *
     * Still non-blocking — a merge problem must not cost the user their login —
     * but no longer silent. `mergeLineIdentityIntoShopify` reports its own
     * partial failures (see `lib/auth/identity-merge.ts`) and leaves anything it
     * could not confirm in place, so a later login retries it. The catch here
     * now only covers a hard throw (e.g. Firestore unreachable), and that is
     * logged as an error rather than dropped. */
    const lineUidEnc = request.cookies.get("line_uid")?.value;
    if (lineUidEnc && customerId) {
      const lineUserId = decryptToken(lineUidEnc);
      if (lineUserId) {
        try {
          await mergeLineIdentityIntoShopify(lineUserId, customerId);
        } catch (mergeErr) {
          console.error("[Auth Callback] Identity merge failed:", mergeErr);
          Sentry.captureException(mergeErr, {
            tags: { subsystem: "identity-merge" },
          });
        }
      }
      // Drop the LINE pointer cookies now that this browser is attached to
      // the Shopify session. The client-visible `line_auth` flag is cleared
      // too so the header flips to the Shopify-logged-in state cleanly.
      /* Clear the LINE session at BOTH scopes.
       *
       * This block used to compute the shared Domain itself, from
       * `new URL(origin).hostname` — and only emitted the Domain-scoped delete
       * when that host happened to look like the apex, emitting exactly ONE of
       * the two scopes in either case. Under Next 16 `origin` derives from
       * `nextUrl.origin`, which reports the server's own origin and ignores the
       * request Host, so on any non-apex origin the Domain-scoped LINE cookies
       * were never cleared here at all. Delegated to the single source of truth,
       * which always emits both. */
      clearAuthCookies(response, "line");
    }

    // Send welcome email for new members (no order history = first registration)
    // Run async without blocking the redirect
    void (async () => {
      try {
        const customer = await getCustomer(tokens.access_token);
        if (customer) {
          const isNewMember = customer.orders.edges.length === 0;
          if (isNewMember) {
            const customerName =
              [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
              "Guest";
            const customerEmail = customer.emailAddress?.emailAddress;
            if (customerEmail) {
              await sendWelcomeEmail({
                customerEmail,
                customerName,
                locale: locale as "ja" | "en",
              });
            }
          }
        }
      } catch (err) {
        // Non-blocking: welcome email failure should not affect login
        console.error("[Auth Callback] Welcome email error:", err);
      }
    })();

    return response;
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${origin}/${locale}/account?error=auth_failed`
    );
  }
}

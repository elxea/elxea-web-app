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
import { completeLineLinkage } from "@/lib/auth/identity-link";

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
      /* Send the user somewhere that can actually TELL them what happened.
       *
       * This used to redirect to `/{locale}/account?error=invalid_nonce`, which
       * showed nothing at all: no code reads `error` on the account page, and the
       * rejection has just cleared the session cookies — so `middleware.ts` sees an
       * unauthenticated `/account` request and redirects to `/{locale}/login`
       * **without carrying the query string**. The parameter was dropped one hop
       * before anything could have read it. A user whose login was refused landed
       * on a bare login form with no explanation, which is indistinguishable from
       * having mis-tapped.
       *
       * `/{locale}/login` is where `AuthErrorBanner` lives, and it resolves
       * `?error=<key>` through its own map — so the key has to be one of ITS keys,
       * not a snake_case string invented here.
       *
       * Two buckets, deliberately:
       *
       *   - `VerificationUnavailable` — we could not perform the check at all
       *     (JWKS unreachable, client id not configured). Server-side conditions,
       *     not attacker-controlled, so naming them leaks nothing and "try again
       *     shortly" is the honest advice.
       *   - `InvalidIdToken` — everything about the token itself: signature, nonce,
       *     iss, aud, exp, sub. These stay **indistinguishable from each other**.
       *     Telling the outside world which one failed hands an attacker a free
       *     oracle for probing the verifier. The precise reason goes to the log and
       *     to Sentry, where only we can read it. */
      const userFacingKey =
        verified.reason === "jwks_unavailable" || verified.reason === "client_id_not_configured"
          ? "VerificationUnavailable"
          : "InvalidIdToken";
      const rejected = NextResponse.redirect(
        `${origin}/${locale}/login?error=${userFacingKey}`,
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

    /* Cache the Shopify Customer ID. It comes from the **verified** claims above,
     * not from a second unchecked decode of the same string — so `shop_cid` can
     * only ever hold an id that survived signature + nonce verification. Saves a
     * Customer API call per request.
     *
     * It is OPTIONAL. When `sub` does not carry an id we recognise, the cookie is
     * simply not written and `requireAuth` falls back to its Customer API path —
     * a slower request, not a failed login. Making this mandatory is what broke
     * every email login in production on 2026-08-22 (`sub_missing`); see
     * `extractCustomerId` in `lib/shopify/id-token.ts`. */
    const customerId = verified.customerId;
    if (customerId) {
      response.cookies.set("shop_cid", encryptToken(customerId), {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 30, // 30 days (same as refresh token)
      });
    }

    // Clean up PKCE cookies
    response.cookies.delete("shop_cv");
    response.cookies.delete("shop_state");
    response.cookies.delete("shop_nonce");
    response.cookies.delete("shop_locale");
    // One-shot: the return path is consumed by this redirect and must not leak
    // into the next login.
    response.cookies.delete("shop_return_to");

    /* このブラウザが LINE セッションも持ったまま Shopify OAuth を終えた。
     * **連携済みの人なら**、まだ `users/line:<id>/` に残っている分をここで
     * 顧客の棚へ引き取る。
     *
     * ## cookie の同居だけでは動かない（挙動を変えた箇所）
     *
     * 以前はここが `line_uid` cookie の**存在だけ**を条件に合体していた。
     * その LINE と、いまログインした顧客が同じ人かは確かめていない。共用端末に
     * 前の人の LINE セッションが残っていれば、その人のお気に入りが次の人の棚へ
     * 移る（PR #100 の B5 が現状として固定していた挙動）。
     *
     * いまは `completeLineLinkage` を通す。連携台帳に「この LINE ↔ この顧客」の
     * 行があるときだけ合体する。連携していない人はここで何も起きない — 合体は
     * 連携の 3 経路（連携ボタン / LIFF / ここ）が共有する 1 か所に寄せてあり、
     * 台帳が意思の記録である以上、その行を持たない人のデータを動かす理由が無い。
     *
     * 連携済みの人にとって、ここは**取りこぼしの再試行**になる。合体は失敗した
     * 分を必ず元の場所に残し、かつ冪等なので、ログインのたびに安全に通せる。
     *
     * ログインは決して失敗させない。`completeLineLinkage` は throw せず、
     * 起きたことを自分で記録する。 */
    const lineUidEnc = request.cookies.get("line_uid")?.value;
    if (lineUidEnc && customerId) {
      const lineUserId = decryptToken(lineUidEnc);
      if (lineUserId) {
        await completeLineLinkage({
          lineUserId,
          shopifyCustomerId: customerId,
          source: "auth-callback",
        });
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

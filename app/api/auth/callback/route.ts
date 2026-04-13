import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  exchangeToken,
  encryptToken,
  decryptToken,
  getCustomer,
  extractCustomerIdFromIdToken,
} from "@/lib/shopify/customer";
import { sendWelcomeEmail } from "@/lib/email/welcome";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  favoritesCol,
  followsCol,
  eventRegistrationsCol,
} from "@/lib/firebase/collections";

/**
 * Phase 1/2 identity merge.
 *
 * If the user already interacted with the site while authenticated via LINE
 * only (collecting favorites / follows / event registrations under
 * `users/line:{userId}/`), move that data under the Shopify `userKey`
 * (`users/{shopifyNumericId}/`) at the moment they finish Shopify OAuth.
 *
 * Dedupe rules mirror the corresponding `addFavorite` / `followFarmer` /
 * `registerForEvent` helpers so a user who already favorited the same item
 * on both sides does not end up with duplicates.
 *
 * This is best-effort and MUST NOT block login: any failure is swallowed
 * after logging to console + Sentry.
 */
async function mergeLineIdentityIntoShopify(
  lineUserId: string,
  shopifyCustomerId: string,
): Promise<void> {
  const lineUserKey = `line:${lineUserId}`;
  if (lineUserKey === shopifyCustomerId) return;

  const db = getAdminFirestore();

  const merged = { favorites: 0, follows: 0, eventRegistrations: 0 };

  // Favorites — dedupe by (type, targetId).
  {
    const srcPath = favoritesCol(lineUserKey);
    const dstPath = favoritesCol(shopifyCustomerId);
    const srcSnap = await db.collection(srcPath).get();
    for (const doc of srcSnap.docs) {
      const data = doc.data();
      const type = data.type as string | undefined;
      const targetId = data.targetId as string | undefined;
      if (type && targetId) {
        const dupe = await db
          .collection(dstPath)
          .where("type", "==", type)
          .where("targetId", "==", targetId)
          .limit(1)
          .get();
        if (dupe.empty) {
          await db.collection(dstPath).add(data);
          merged.favorites += 1;
        }
      }
      await doc.ref.delete();
    }
  }

  // Follows — dedupe by farmerSlug.
  {
    const srcPath = followsCol(lineUserKey);
    const dstPath = followsCol(shopifyCustomerId);
    const srcSnap = await db.collection(srcPath).get();
    for (const doc of srcSnap.docs) {
      const data = doc.data();
      const farmerSlug = data.farmerSlug as string | undefined;
      if (farmerSlug) {
        const dupe = await db
          .collection(dstPath)
          .where("farmerSlug", "==", farmerSlug)
          .limit(1)
          .get();
        if (dupe.empty) {
          await db.collection(dstPath).add(data);
          merged.follows += 1;
        }
      }
      await doc.ref.delete();
    }
  }

  // Event registrations — dedupe by eventSlug.
  {
    const srcPath = eventRegistrationsCol(lineUserKey);
    const dstPath = eventRegistrationsCol(shopifyCustomerId);
    const srcSnap = await db.collection(srcPath).get();
    for (const doc of srcSnap.docs) {
      const data = doc.data();
      const eventSlug = data.eventSlug as string | undefined;
      if (eventSlug) {
        const dupe = await db
          .collection(dstPath)
          .where("eventSlug", "==", eventSlug)
          .limit(1)
          .get();
        if (dupe.empty) {
          await db.collection(dstPath).add(data);
          merged.eventRegistrations += 1;
        }
      }
      await doc.ref.delete();
    }
  }

  Sentry.addBreadcrumb({
    category: "identity-merge",
    level: "info",
    message: "Merged LINE identity into Shopify user",
    data: {
      subsystem: "identity-merge",
      lineUserKey,
      shopifyCustomerId,
      ...merged,
    },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // NEXT_PUBLIC_APP_URL allows overriding the app base URL (e.g. for tunnels in local dev)
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const codeVerifier = request.cookies.get("shop_cv")?.value;
  const savedState = request.cookies.get("shop_state")?.value;
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

    const response = NextResponse.redirect(`${origin}/${locale}/account`);

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

    // Cache the Shopify Customer ID extracted from the id_token JWT.
    // This avoids an extra Shopify Customer API call on every authenticated request.
    // The numeric customer ID (e.g. "7654321") is encrypted and stored as shop_cid.
    const customerId = extractCustomerIdFromIdToken(tokens.id_token);
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

    // Phase 1/2: if this user completed Shopify OAuth while already holding a
    // LINE session, merge their LINE-only Firestore data into the Shopify
    // userKey. Non-blocking: never fails the login flow.
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
      // LINE cookies were set with `domain=.elxea.com` in production, so we
      // must clear them against the same scope (and a host-only delete for
      // dev / preview). Setting maxAge:0 is the portable way to do this.
      const hostname = new URL(origin).hostname;
      const sharedCookieDomain =
        hostname === "elxea.com" || hostname.endsWith(".elxea.com")
          ? ".elxea.com"
          : undefined;
      const clearLineOpts = {
        path: "/",
        maxAge: 0,
        ...(sharedCookieDomain ? { domain: sharedCookieDomain } : {}),
      } as const;
      response.cookies.set("line_uid", "", clearLineOpts);
      response.cookies.set("line_auth", "", clearLineOpts);
      response.cookies.set("line_session", "", clearLineOpts);
      response.cookies.set("line_user", "", clearLineOpts);
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

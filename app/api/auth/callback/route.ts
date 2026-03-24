import { NextRequest, NextResponse } from "next/server";
import {
  exchangeToken,
  encryptToken,
  getCustomer,
  extractCustomerIdFromIdToken,
} from "@/lib/shopify/customer";
import { sendWelcomeEmail } from "@/lib/email/welcome";

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

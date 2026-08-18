import { cookies } from "next/headers";

import { COOKIE_NAME, getCookieSpec, isSecure } from "@/lib/auth/cookies";
import {
  decryptToken,
  refreshAccessToken,
  encryptToken,
  getCustomer,
  getSubscriptionContracts,
  type Customer,
  type SubscriptionContract,
  type MembershipTier,
} from "./customer";

/* Cookie names come from the registry rather than being re-declared here.
 * They used to be four local string literals, which is how the codebase ended up
 * with the same names spelled out at six call sites and no single place that
 * knew the full set. Keeping them as module-level consts initialised from the
 * registry also keeps them statically resolvable, which the registry scanner in
 * `__tests__/auth-cookie-registry.test.ts` relies on. */
const ACCESS_TOKEN_COOKIE = COOKIE_NAME.shopAccessToken;
const REFRESH_TOKEN_COOKIE = COOKIE_NAME.shopRefreshToken;
const EXPIRES_AT_COOKIE = COOKIE_NAME.shopExpiresAt;
const AUTH_FLAG_COOKIE = COOKIE_NAME.shopAuthFlag; // non-httpOnly, for client-side UI checks

type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const atEnc = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const rtEnc = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  const expStr = cookieStore.get(EXPIRES_AT_COOKIE)?.value;

  if (!atEnc || !rtEnc || !expStr) return null;

  const accessToken = decryptToken(atEnc);
  const refreshToken = decryptToken(rtEnc);
  if (!accessToken || !refreshToken) return null;

  const expiresAt = parseInt(expStr, 10);

  // If token is expired or about to expire (within 60s), refresh it
  // Note: cookies().set() throws in Server Components, so we only refresh
  // the token in memory without updating cookies. The middleware or next
  // route handler call will handle cookie updates.
  if (Date.now() >= expiresAt - 60_000) {
    try {
      const tokens = await refreshAccessToken(refreshToken);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };
    } catch {
      return null;
    }
  }

  return { accessToken, refreshToken, expiresAt };
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

export async function getCustomerFromSession(): Promise<Customer | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    return await getCustomer(session.accessToken);
  } catch (e) {
    console.error("getCustomerFromSession error:", e);
    return null;
  }
}

export async function getSubscriptionsFromSession(): Promise<SubscriptionContract[]> {
  try {
    const session = await getSession();
    if (!session) return [];
    return await getSubscriptionContracts(session.accessToken);
  } catch (e) {
    console.error("getSubscriptionsFromSession error:", e);
    return [];
  }
}

/**
 * Determine membership tier from customer tags or active subscription contracts.
 * Priority: tags (explicit) > subscription status (implicit).
 * Tags: "member-premium" → premium, "member-standard" or "member" → standard.
 * Fallback: any active subscription contract → standard.
 */
export async function getMembershipTier(): Promise<MembershipTier> {
  try {
    const session = await getSession();
    if (!session) return "none";

    const [customer, contracts] = await Promise.all([
      getCustomer(session.accessToken),
      getSubscriptionContracts(session.accessToken),
    ]);

    // Check tags first (set by Shopify Flow)
    if (customer?.tags) {
      if (customer.tags.includes("member-premium")) return "premium";
      if (customer.tags.includes("member-standard") || customer.tags.includes("member")) return "standard";
    }

    // Fallback: check active subscription contracts
    const hasActiveContract = contracts.some((c) => c.status === "ACTIVE");
    if (hasActiveContract) return "standard";

    return "none";
  } catch (e) {
    console.error("getMembershipTier error:", e);
    return "none";
  }
}

export async function setSessionCookies(
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): Promise<void> {
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: isSecure(getCookieSpec(ACCESS_TOKEN_COOKIE)!),
    sameSite: "lax" as const,
    path: "/",
  };

  cookieStore.set(ACCESS_TOKEN_COOKIE, encryptToken(accessToken), {
    ...cookieOptions,
    maxAge: expiresIn,
  });
  cookieStore.set(REFRESH_TOKEN_COOKIE, encryptToken(refreshToken), {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  cookieStore.set(EXPIRES_AT_COOKIE, String(Date.now() + expiresIn * 1000), {
    ...cookieOptions,
    maxAge: expiresIn,
  });

  // Non-httpOnly flag for client-side UI (login/account label toggle)
  cookieStore.set(AUTH_FLAG_COOKIE, "1", {
    httpOnly: false,
    secure: isSecure(getCookieSpec(AUTH_FLAG_COOKIE)!),
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  });
}

/* `clearSession()` was removed here.
 *
 * It was a FOURTH implementation of "delete the auth cookies", with zero callers,
 * and it deleted host-only only — so anything that started calling it would have
 * reproduced the exact bug this change fixes. Deletion now lives solely in
 * `clearAuthCookies()` (lib/auth/cookies.ts), which emits both scopes. A
 * store-based variant can be reintroduced there if a Server Action ever needs
 * one; it must not come back as a private copy.
 */

/**
 * Lightweight check for middleware — only checks if cookies exist (no decryption).
 * For use in Edge Runtime where crypto is limited.
 */
export function hasSessionCookie(
  cookieGetter: (name: string) => string | undefined
): boolean {
  return !!(
    cookieGetter(ACCESS_TOKEN_COOKIE) &&
    cookieGetter(REFRESH_TOKEN_COOKIE)
  );
}

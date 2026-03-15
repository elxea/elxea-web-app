import { cookies } from "next/headers";
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

const ACCESS_TOKEN_COOKIE = "shop_at";
const REFRESH_TOKEN_COOKIE = "shop_rt";
const EXPIRES_AT_COOKIE = "shop_exp";
const AUTH_FLAG_COOKIE = "shop_auth"; // non-httpOnly, for client-side UI checks

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
    secure: process.env.NODE_ENV === "production",
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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
  cookieStore.delete(EXPIRES_AT_COOKIE);
  cookieStore.delete(AUTH_FLAG_COOKIE);
}

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

/**
 * Authentication guard for Firestore API routes.
 * Validates the Shopify session and extracts the customer ID.
 *
 * Performance optimization: if shop_cid cookie is present (set at login),
 * the Shopify Customer API call is skipped entirely. This reduces p50 latency
 * for authenticated API routes from ~400ms to ~5ms.
 */
import { cookies } from "next/headers";
import { getSession } from "@/lib/shopify/auth";
import { getCustomer, decryptToken } from "@/lib/shopify/customer";
import { extractCustomerId } from "./types";

type AuthResult =
  | { authenticated: true; customerId: string; customerName: string }
  | { authenticated: false; error: string; status: number };

/**
 * Identity resolution result for Firestore API routes.
 *
 * `userKey` is the Firestore collection key abstraction that unifies Shopify
 * and LINE users:
 *   - Shopify users: `userKey = shopifyNumericId` (e.g. "7654321"),
 *     matching the existing Firestore layout — no migration required.
 *   - LINE users:    `userKey = "line:" + lineUserId` (e.g. "line:Uxxxx"),
 *     a disjoint namespace so the two providers never collide.
 */
export type Identity =
  | {
      authenticated: true;
      userKey: string;
      provider: "shopify" | "line";
      displayName: string;
      shopifyCustomerId: string | null;
      lineUserId: string | null;
    }
  | { authenticated: false; error: string; status: number };

/**
 * Validate the current session and return the customer's Firestore ID.
 * Returns the numeric portion of the Shopify customer GID.
 *
 * Fast path: reads customerId from encrypted shop_cid cookie (set at login via id_token).
 * Slow path: falls back to Shopify Customer API if cookie is absent or invalid.
 */
export async function requireAuth(): Promise<AuthResult> {
  try {
    // Verify that a valid session exists (checks shop_at + shop_rt cookies)
    const session = await getSession();
    if (!session) {
      return { authenticated: false, error: "Not authenticated", status: 401 };
    }

    // Fast path: use cached customer ID from id_token (set at login)
    const cookieStore = await cookies();
    const cidEnc = cookieStore.get("shop_cid")?.value;
    if (cidEnc) {
      const customerId = decryptToken(cidEnc);
      if (customerId) {
        return { authenticated: true, customerId, customerName: "Customer" };
      }
    }

    // Slow path: fetch customer from Shopify API (first login after deploy, or missing cookie)
    const customer = await getCustomer(session.accessToken);
    if (!customer) {
      return { authenticated: false, error: "Customer not found", status: 401 };
    }

    const customerId = extractCustomerId(customer.id);
    const customerName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ") || "Anonymous";

    return { authenticated: true, customerId, customerName };
  } catch {
    return { authenticated: false, error: "Authentication failed", status: 401 };
  }
}

/**
 * Resolve the current caller's identity across Shopify and LINE providers.
 *
 * Resolution order:
 *   1. Shopify session (shop_at + shop_rt) — preferred; provider = "shopify"
 *      and `userKey` is the numeric Shopify customer ID. Existing Firestore
 *      documents under `users/{numericId}` continue to work unchanged.
 *   2. LINE session (line_session + line_uid) — provider = "line" and
 *      `userKey = "line:" + lineUserId`.
 *   3. Otherwise unauthenticated.
 *
 * The two key namespaces are disjoint (LINE keys always carry the "line:"
 * prefix), so no data migration is required. When a LINE-only user later
 * completes Shopify OAuth, the callback route is responsible for merging
 * `users/line:<id>/*` into `users/<shopifyNumericId>/*`.
 */
export async function resolveIdentity(): Promise<Identity> {
  try {
    const cookieStore = await cookies();

    // 1) Shopify session takes precedence when present. We reuse `requireAuth`
    //    semantics so Shopify-auth'd users keep the existing `userKey` shape.
    const session = await getSession();
    if (session) {
      const cidEnc = cookieStore.get("shop_cid")?.value;
      if (cidEnc) {
        const customerId = decryptToken(cidEnc);
        if (customerId) {
          return {
            authenticated: true,
            userKey: customerId,
            provider: "shopify",
            displayName: "Customer",
            shopifyCustomerId: customerId,
            lineUserId: null,
          };
        }
      }

      const customer = await getCustomer(session.accessToken);
      if (customer) {
        const customerId = extractCustomerId(customer.id);
        const displayName =
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          "Anonymous";
        return {
          authenticated: true,
          userKey: customerId,
          provider: "shopify",
          displayName,
          shopifyCustomerId: customerId,
          lineUserId: null,
        };
      }
      // Shopify session present but customer fetch failed — fall through to LINE.
    }

    // 2) LINE session fallback.
    const hasLineSession = cookieStore.has("line_session");
    const lineUidEnc = cookieStore.get("line_uid")?.value;
    if (hasLineSession && lineUidEnc) {
      const lineUserId = decryptToken(lineUidEnc);
      if (lineUserId) {
        let displayName = "LINE User";
        const lineUserCookie = cookieStore.get("line_user")?.value;
        if (lineUserCookie) {
          try {
            const parsed = JSON.parse(lineUserCookie);
            if (typeof parsed?.displayName === "string" && parsed.displayName) {
              displayName = parsed.displayName;
            }
          } catch {
            // Ignore malformed cookie — keep default display name.
          }
        }
        return {
          authenticated: true,
          userKey: `line:${lineUserId}`,
          provider: "line",
          displayName,
          shopifyCustomerId: null,
          lineUserId,
        };
      }
    }

    return { authenticated: false, error: "Not authenticated", status: 401 };
  } catch {
    return { authenticated: false, error: "Authentication failed", status: 401 };
  }
}

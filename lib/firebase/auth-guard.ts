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

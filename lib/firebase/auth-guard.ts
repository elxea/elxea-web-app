/**
 * Authentication guard for Firestore API routes.
 * Validates the Shopify session and extracts the customer ID.
 */
import { getSession } from "@/lib/shopify/auth";
import { getCustomer } from "@/lib/shopify/customer";
import { extractCustomerId } from "./types";

type AuthResult =
  | { authenticated: true; customerId: string; customerName: string }
  | { authenticated: false; error: string; status: number };

/**
 * Validate the current session and return the customer's Firestore ID.
 * Returns the numeric portion of the Shopify customer GID.
 */
export async function requireAuth(): Promise<AuthResult> {
  try {
    const session = await getSession();
    if (!session) {
      return { authenticated: false, error: "Not authenticated", status: 401 };
    }

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

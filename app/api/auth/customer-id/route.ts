/**
 * GET /api/auth/customer-id
 *
 * Returns the Shopify Customer ID for the currently logged-in user.
 * Used by the chat transport to identify authenticated users when
 * communicating with the cx-agent API.
 *
 * Response:
 *   - 200 { customer_id: string }  — logged in
 *   - 200 { customer_id: null }    — not logged in
 *   - 500 { error: string }        — internal error
 */
import { NextResponse } from "next/server";
import { getCustomerFromSession } from "@/lib/shopify/auth";

export async function GET() {
  try {
    const customer = await getCustomerFromSession();

    if (!customer?.id) {
      return NextResponse.json({ customer_id: null });
    }

    return NextResponse.json({ customer_id: customer.id });
  } catch (error) {
    console.error("customer-id route error:", error);
    return NextResponse.json({ customer_id: null });
  }
}

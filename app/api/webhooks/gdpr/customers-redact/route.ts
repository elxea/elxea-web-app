import { NextRequest, NextResponse } from "next/server";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";

/**
 * Shopify GDPR: customers/redact webhook handler.
 *
 * Shopify sends this when a customer requests deletion of their data.
 * elxea does not store customer personal data outside Shopify,
 * so we log the request and return 200 OK.
 */
export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;

  console.log(
    `[Webhook:GDPR] Received ${topic}: customers/redact`,
    JSON.stringify(payload),
  );

  // elxea does not store customer personal data outside Shopify.
  // No action required beyond acknowledging the request.
  return NextResponse.json({ received: true });
}

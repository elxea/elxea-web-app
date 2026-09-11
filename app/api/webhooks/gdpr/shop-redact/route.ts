import { NextRequest, NextResponse } from "next/server";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";

/**
 * Shopify GDPR: shop/redact webhook handler.
 *
 * Shopify sends this 48 hours after a store uninstalls the app,
 * requesting deletion of all shop data.
 * elxea does not store shop data outside Shopify,
 * so we log the request and return 200 OK.
 */
export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;

  console.log(
    `[Webhook:GDPR] Received ${topic}: shop/redact`,
    JSON.stringify(payload),
  );

  // elxea does not store shop data outside Shopify.
  // No action required beyond acknowledging the request.
  return NextResponse.json({ received: true });
}

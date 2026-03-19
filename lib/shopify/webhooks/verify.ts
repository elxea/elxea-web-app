import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Verify a Shopify webhook request using HMAC-SHA256 signature.
 *
 * Shopify sends the HMAC in the `X-Shopify-Hmac-SHA256` header as a
 * base64-encoded digest of the raw request body signed with the shared secret.
 *
 * Uses `crypto.timingSafeEqual` to prevent timing attacks.
 */
export function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string,
  secret: string,
): boolean {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const bufComputed = Buffer.from(computed);
  const bufReceived = Buffer.from(hmacHeader);

  if (bufComputed.length !== bufReceived.length) return false;
  return crypto.timingSafeEqual(bufComputed, bufReceived);
}

/**
 * Common preamble for all Shopify webhook route handlers.
 *
 * Returns `{ rawBody, payload }` on success or a NextResponse error to return
 * immediately.  Handles:
 *   - Non-POST rejection (405)
 *   - Missing secret (500)
 *   - Missing / invalid HMAC header (401)
 */
export async function validateWebhookRequest(
  request: NextRequest,
): Promise<
  | { ok: true; rawBody: string; payload: unknown; topic: string }
  | { ok: false; response: NextResponse }
> {
  if (request.method !== "POST") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Method Not Allowed" },
        { status: 405 },
      ),
    };
  }

  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Webhook] SHOPIFY_WEBHOOK_SECRET is not configured");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 },
      ),
    };
  }

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.warn("[Webhook] Missing X-Shopify-Hmac-SHA256 header");
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const rawBody = await request.text();

  if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
    console.warn("[Webhook] HMAC verification failed");
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const topic = request.headers.get("x-shopify-topic") ?? "unknown";

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }

  return { ok: true, rawBody, payload, topic };
}

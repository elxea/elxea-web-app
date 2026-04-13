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
  | {
      ok: true;
      rawBody: string;
      payload: unknown;
      topic: string;
      webhookId: string | null;
    }
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

  // Timestamp replay protection.
  // Shopify 2024+ webhooks include x-shopify-webhook-timestamp (seconds since
  // epoch). Older deliveries may not; in that case we log a warning and
  // proceed (HMAC verification still provides integrity).
  const timestampHeader = request.headers.get("x-shopify-webhook-timestamp");
  if (timestampHeader) {
    const tsSeconds = Number.parseInt(timestampHeader, 10);
    if (!Number.isFinite(tsSeconds)) {
      console.warn(
        `[Webhook] Invalid x-shopify-webhook-timestamp header: "${timestampHeader}"`,
      );
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const driftSeconds = Math.abs(nowSeconds - tsSeconds);
    const MAX_DRIFT_SECONDS = 5 * 60; // ±5 minutes
    if (driftSeconds > MAX_DRIFT_SECONDS) {
      console.warn(
        `[Webhook] Timestamp outside ±5min window (drift=${driftSeconds}s) — rejecting`,
      );
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
  } else {
    console.warn(
      "[Webhook] Missing x-shopify-webhook-timestamp header; replay window not enforced",
    );
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
  const webhookId = request.headers.get("x-shopify-webhook-id");

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

  return { ok: true, rawBody, payload, topic, webhookId };
}

/**
 * Check idempotency of a Shopify webhook delivery using the
 * `X-Shopify-Webhook-Id` header. Returns:
 *   - `{ alreadyProcessed: true }` if this id has a record in _webhookLogs
 *   - `{ alreadyProcessed: false, markProcessed }` otherwise; the caller
 *     must invoke `markProcessed()` after all side effects succeed.
 *
 * When `webhookId` is null (older Shopify deliveries without the header),
 * idempotency is not enforced and `alreadyProcessed` is always false. The
 * caller receives a no-op `markProcessed` that logs a warning.
 *
 * Shopify version requirements:
 *   - `X-Shopify-Webhook-Id` has been stable since API version 2017-10.
 *   - `X-Shopify-Webhook-Timestamp` (validated above) is Shopify 2024+ and
 *     older deliveries will fall through to HMAC-only verification.
 *
 * The caller is responsible for:
 *   - passing the db instance (so this helper stays runtime-agnostic)
 *   - calling markProcessed() only after ALL side effects succeeded
 *   - returning 5xx on side-effect failure so Shopify retries
 *
 * OPERATIONAL REQUIREMENT:
 *   The `_webhookLogs` Firestore collection must have a TTL policy of
 *   approximately 30 days so that records expire and storage/query cost
 *   stays bounded. Shopify's own retry window is 48 hours, so any window
 *   greater than 48h is safe. Configure via:
 *     gcloud firestore fields ttls update processedAt \
 *       --collection-group=_webhookLogs --enable-ttl
 *   Tracked separately in the elxea infra runbook. Keep `processedAt` as a
 *   serverTimestamp so Firestore TTL can use it as the expiry field.
 */
export async function checkWebhookIdempotency(
  db: FirebaseFirestore.Firestore,
  webhookId: string | null,
  topic: string,
): Promise<
  | { alreadyProcessed: true }
  | { alreadyProcessed: false; markProcessed: () => Promise<void> }
> {
  if (!webhookId) {
    console.warn(
      `[Webhook] Missing x-shopify-webhook-id header on topic="${topic}"; idempotency not enforced`,
    );
    return {
      alreadyProcessed: false,
      markProcessed: async () => {
        /* no-op: no id to record */
      },
    };
  }

  const logRef = db.collection("_webhookLogs").doc(webhookId);
  const existing = await logRef.get();
  if (existing.exists) {
    console.log(
      `[Webhook] Idempotent replay detected (topic="${topic}", webhookId=${webhookId})`,
    );
    return { alreadyProcessed: true };
  }

  const markProcessed = async () => {
    const { FieldValue } = await import("firebase-admin/firestore");
    await logRef.set({
      topic,
      source: "shopify",
      processedAt: FieldValue.serverTimestamp(),
    });
  };

  return { alreadyProcessed: false, markProcessed };
}

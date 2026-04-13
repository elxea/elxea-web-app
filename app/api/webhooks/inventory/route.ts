import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";

/**
 * Shopify INVENTORY_LEVELS_UPDATE webhook handler.
 *
 * When Shopify inventory changes (sale, manual adjustment, fulfillment),
 * this endpoint receives a notification and triggers the inventory-monitor
 * pipeline job via a local API call.
 *
 * Flow:
 *   1. Verify HMAC-SHA256 signature
 *   2. Extract inventory_item_id, location_id, available quantity
 *   3. Log the change
 *   4. Trigger pipeline job if below safety threshold (optional)
 *   5. Return 200 immediately (Shopify retries on non-2xx)
 */

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
  updated_at: string;
  admin_graphql_api_id: string;
}

export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;
  const inventoryLevel = payload as ShopifyInventoryLevel;

  console.log(
    `[Webhook:inventory] Received ${topic} for item=${inventoryLevel.inventory_item_id} location=${inventoryLevel.location_id} available=${inventoryLevel.available}`,
  );

  try {
    // Log inventory change for monitoring
    const logEntry = {
      timestamp: new Date().toISOString(),
      topic,
      inventory_item_id: inventoryLevel.inventory_item_id,
      location_id: inventoryLevel.location_id,
      available: inventoryLevel.available,
    };

    console.log(
      `[Webhook:inventory] Change logged: ${JSON.stringify(logEntry)}`,
    );

    // Trigger pipeline job notification (non-blocking)
    // The actual inventory-monitor pipeline will pick this up
    // via its next scheduled run or via a trigger mechanism
    const triggerUrl = process.env.PIPELINE_TRIGGER_URL;
    if (triggerUrl) {
      fetch(triggerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "inventory-monitor",
          org: "elxea",
          trigger: "shopify-webhook",
          context: {
            inventory_item_id: inventoryLevel.inventory_item_id,
            location_id: inventoryLevel.location_id,
            available: inventoryLevel.available,
          },
        }),
      }).catch((err) => {
        console.warn(
          `[Webhook:inventory] Pipeline trigger failed (non-blocking): ${err.message}`,
        );
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook:inventory] Processing error:", error);

    Sentry.captureException(error, {
      tags: { webhook: "inventory_levels_update" },
      extra: {
        inventoryItemId: inventoryLevel.inventory_item_id,
        locationId: inventoryLevel.location_id,
        available: inventoryLevel.available,
      },
    });

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

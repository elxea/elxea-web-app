import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Shopify ORDERS_CREATE webhook handler (Next.js API Route).
 *
 * Ported from functions/src/webhooks/shopifyOrders.ts (Firebase Cloud Functions).
 *
 * Flow:
 *   1. Verify HMAC-SHA256 signature
 *   2. Write order mirror to Firestore users/{customerId}/orders/{orderId}
 *   3. Add purchase behavior event to behaviorLog
 *   4. Update persona scores based on purchase history
 *   5. Return 200 immediately (Shopify retries on non-2xx)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyLineItem {
  title: string;
  quantity: number;
  variant_id: number;
  product_id: number;
  price: string;
}

interface ShopifyCustomer {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  email?: string;
  customer?: ShopifyCustomer;
  line_items: ShopifyLineItem[];
  total_price: string;
  currency: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
}

type PersonaType = "serenity" | "explorer" | "sensory";

// ---------------------------------------------------------------------------
// Persona scoring logic (ported from Cloud Functions)
// ---------------------------------------------------------------------------

/**
 * Infer persona signal from purchase behavior.
 *
 * Heuristics:
 *   - First purchase (no previous orders) -> explorer (curiosity)
 *   - Repeat purchase -> sensory (sensory attachment)
 *   - High-value order (over 5000 JPY) -> serenity (mindful consumption)
 */
function inferPersonaSignalFromOrder(
  order: ShopifyOrder,
  previousOrderCount: number,
): PersonaType | null {
  const totalPrice = parseFloat(order.total_price);

  if (previousOrderCount === 0) {
    return "explorer";
  }
  if (totalPrice >= 5000) {
    return "serenity";
  }
  return "sensory";
}

/**
 * Update persona scores in Firestore.
 *
 * Adds +10 to the matching signal type. Scores cap at 100.
 * Sets the highest-scoring persona as `primary`.
 */
async function updatePersonaScores(
  db: FirebaseFirestore.Firestore,
  customerId: string,
  signal: PersonaType,
): Promise<void> {
  const userRef = db.collection("users").doc(customerId);
  const userDoc = await userRef.get();
  const data = userDoc.data();

  const currentScores = (data?.persona?.scores as Record<string, number>) ?? {
    serenity: 0,
    explorer: 0,
    sensory: 0,
  };

  const SCORE_INCREMENT = 10;
  const newScores = { ...currentScores };
  newScores[signal] = Math.min(100, (newScores[signal] ?? 0) + SCORE_INCREMENT);

  const primary = (Object.entries(newScores).sort(
    ([, a], [, b]) => b - a,
  )[0][0]) as PersonaType;

  await userRef.set(
    {
      persona: {
        primary,
        scores: newScores,
        lastUpdated: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;
  const order = payload as ShopifyOrder;

  console.log(
    `[Webhook:orders] Received ${topic} for order #${order.order_number} (id=${order.id})`,
  );

  try {
    const db = getAdminFirestore();

    // Skip Firestore write if customer ID is missing
    if (!order.customer?.id) {
      console.warn(
        `[Webhook:orders] Order #${order.order_number} has no customer, skipping Firestore write`,
      );
      return NextResponse.json({ received: true });
    }

    const customerId = String(order.customer.id);
    const orderId = String(order.id);
    const userRef = db.collection("users").doc(customerId);

    // (1) Write order mirror to users/{customerId}/orders/{orderId}
    const orderMirror = {
      orderNumber: String(order.order_number),
      items: order.line_items.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        variantId: String(item.variant_id),
      })),
      totalPrice: order.total_price,
      currency: order.currency,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      createdAt: Timestamp.fromDate(new Date(order.created_at)),
    };

    await userRef.collection("orders").doc(orderId).set(orderMirror);
    console.log(
      `[Webhook:orders] Order mirror written for customer=${customerId}, order=${orderId}`,
    );

    // (2) Get previous order count for persona signal inference
    const ordersSnapshot = await userRef.collection("orders").count().get();
    const previousOrderCount = Math.max(0, ordersSnapshot.data().count - 1);

    // (3) Add purchase behavior event to behaviorLog
    const personaSignal = inferPersonaSignalFromOrder(order, previousOrderCount);
    const behaviorEvent = {
      action: "purchase",
      channel: "shopify",
      metadata: {
        productId: String(order.line_items[0]?.product_id ?? ""),
        orderId,
        orderNumber: String(order.order_number),
      },
      personaSignal,
      createdAt: FieldValue.serverTimestamp(),
    };

    await userRef.collection("behaviorLog").add(behaviorEvent);
    console.log(
      `[Webhook:orders] Behavior event added for customer=${customerId}, signal=${personaSignal}`,
    );

    // (4) Update persona scores
    if (personaSignal) {
      await updatePersonaScores(db, customerId, personaSignal);
      console.log(
        `[Webhook:orders] Persona scores updated for customer=${customerId}, signal=${personaSignal}`,
      );
    }

    // (5) Upsert user basic info (email, name)
    const userUpdate: Record<string, unknown> = {
      lastActiveAt: FieldValue.serverTimestamp(),
    };
    if (order.customer.email) {
      userUpdate.email = order.customer.email;
    }
    if (order.customer.first_name || order.customer.last_name) {
      userUpdate.displayName = [
        order.customer.last_name,
        order.customer.first_name,
      ]
        .filter(Boolean)
        .join(" ");
    }
    await userRef.set(userUpdate, { merge: true });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook:orders] Processing error:", error);

    Sentry.captureException(error, {
      tags: { webhook: "orders_create" },
      extra: {
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: order.customer?.id,
      },
    });

    // Return 500 so Shopify will retry
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

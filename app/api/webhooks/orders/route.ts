import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  validateWebhookRequest,
  checkWebhookIdempotency,
} from "@/lib/shopify/webhooks/verify";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { notifyWebhookException } from "@/lib/line/monitoring-alerts";
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

// Runtime validation schema mirroring the ShopifyOrder interface.
// Unknown fields are ignored (passthrough) because Shopify adds new fields
// over time and we should not reject legitimate webhooks.
const ShopifyLineItemSchema = z
  .object({
    title: z.string(),
    quantity: z.number(),
    variant_id: z.number(),
    product_id: z.number(),
    price: z.string(),
  })
  .passthrough();

const ShopifyCustomerSchema = z
  .object({
    id: z.number(),
    email: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .passthrough();

const ShopifyOrderSchema = z
  .object({
    id: z.number(),
    order_number: z.number(),
    email: z.string().optional(),
    customer: ShopifyCustomerSchema.nullish(),
    line_items: z.array(ShopifyLineItemSchema),
    total_price: z.string(),
    currency: z.string().min(3).max(8),
    created_at: z.string(),
    financial_status: z.string(),
    fulfillment_status: z.string().nullable(),
  })
  .passthrough();

type PersonaType = "serenity" | "explorer" | "sensory";

// ---------------------------------------------------------------------------
// Persona scoring logic (ported from Cloud Functions)
// ---------------------------------------------------------------------------

/**
 * Parse Shopify order total price into an integer minor-unit amount.
 *
 * Shopify returns `total_price` as a decimal string (e.g. "5000.00" or
 * "12.34"). Floating point arithmetic on money is unsafe, so we convert to
 * the smallest indivisible unit of the currency:
 *   - JPY has no sub-unit (1 yen = 1 minor unit); divisor = 1
 *   - USD / EUR / GBP etc. have 2 decimal places; divisor = 100
 *
 * Returns integer minor units (bigint-safe within Number.MAX_SAFE_INTEGER
 * for all practical order totals).
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "BIF",
  "DJF",
  "GNF",
  "KMF",
  "MGA",
  "RWF",
  "UGX",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function parseMoneyToMinorUnits(
  priceString: string,
  currency: string,
): number {
  const currencyUpper = currency.toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currencyUpper);
  const multiplier = isZeroDecimal ? 1 : 100;
  // Use string parsing to avoid floating-point drift, then round as a final
  // safety net for unexpected precision (e.g. "12.345").
  const parsed = Number.parseFloat(priceString);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * multiplier);
}

/**
 * Persona signal threshold: 5000 JPY (zero-decimal currency).
 * Expressed in minor units; for JPY this is literally 5000.
 */
const HIGH_VALUE_THRESHOLD_JPY_MINOR = 5000;

/**
 * Infer persona signal from purchase behavior.
 *
 * Heuristics:
 *   - First purchase (no previous orders) -> explorer (curiosity)
 *   - Repeat purchase -> sensory (sensory attachment)
 *   - High-value order (>= 5000 JPY equivalent) -> serenity (mindful consumption)
 *
 * Only applies the high-value heuristic when the order currency is JPY, to
 * avoid false positives across currency conversions.
 */
function inferPersonaSignalFromOrder(
  order: ShopifyOrder,
  previousOrderCount: number,
): PersonaType | null {
  if (previousOrderCount === 0) {
    return "explorer";
  }
  if (order.currency.toUpperCase() === "JPY") {
    const totalMinor = parseMoneyToMinorUnits(order.total_price, order.currency);
    if (totalMinor >= HIGH_VALUE_THRESHOLD_JPY_MINOR) {
      return "serenity";
    }
  }
  return "sensory";
}

/**
 * Compute updated persona scores given the current document data and a signal.
 * Pure function — safe to call inside a Firestore transaction.
 */
function computePersonaUpdate(
  existingData: FirebaseFirestore.DocumentData | undefined,
  signal: PersonaType,
): { primary: PersonaType; scores: Record<string, number> } {
  const currentScores = (existingData?.persona?.scores as
    | Record<string, number>
    | undefined) ?? {
    serenity: 0,
    explorer: 0,
    sensory: 0,
  };

  const SCORE_INCREMENT = 10;
  const newScores: Record<string, number> = { ...currentScores };
  newScores[signal] = Math.min(100, (newScores[signal] ?? 0) + SCORE_INCREMENT);

  const primary = (Object.entries(newScores).sort(
    ([, a], [, b]) => b - a,
  )[0][0]) as PersonaType;

  return { primary, scores: newScores };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic, webhookId } = validation;

  // Runtime validation: reject malformed payloads instead of type-asserting.
  const parsed = ShopifyOrderSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn(
      "[Webhook:orders] Payload failed schema validation:",
      parsed.error.issues.slice(0, 5),
    );
    Sentry.captureMessage("Shopify orders webhook payload failed schema validation", {
      level: "warning",
      tags: { webhook: "orders_create" },
      extra: { issues: parsed.error.issues.slice(0, 10) },
    });
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 },
    );
  }
  const order = parsed.data as ShopifyOrder;

  console.log(
    `[Webhook:orders] Received ${topic} for order #${order.order_number} (id=${order.id})`,
  );

  try {
    const db = getAdminFirestore();

    // Idempotency (webhook ID): drop duplicate deliveries.
    const idem = await checkWebhookIdempotency(db, webhookId, topic);
    if (idem.alreadyProcessed) {
      return NextResponse.json({ received: true, idempotent: true });
    }

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
    const orderRef = userRef.collection("orders").doc(orderId);
    const behaviorRef = userRef.collection("behaviorLog").doc();

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

    // Wrap all writes (order mirror, behavior log, persona scores, user upsert)
    // in a single Firestore transaction. Reads (existing order check, order
    // count, user doc) happen inside the transaction, so the previousOrderCount
    // is free from race conditions with concurrent webhook deliveries.
    const txResult = await db.runTransaction(async (tx) => {
      // Idempotency: if order already mirrored, skip all writes.
      const existingOrderSnap = await tx.get(orderRef);
      if (existingOrderSnap.exists) {
        return { skipped: true as const };
      }

      // Read existing user doc (for persona score merge)
      const userSnap = await tx.get(userRef);

      // Read current order count (pre-insert) for persona inference.
      // Firebase Admin SDK's count() aggregation returns an object with a
      // numeric `count` property. We defensively coerce and fall back to 0
      // so a future API shape change cannot cause NaN propagation.
      const ordersCountSnap = await tx.get(
        userRef.collection("orders").count(),
      );
      const rawCount = ordersCountSnap.data() as unknown;
      const previousOrderCount =
        typeof rawCount === "object" &&
        rawCount !== null &&
        "count" in rawCount &&
        typeof (rawCount as { count: unknown }).count === "number"
          ? (rawCount as { count: number }).count
          : 0;

      const personaSignal = inferPersonaSignalFromOrder(order, previousOrderCount);

      // (1) Order mirror
      tx.set(orderRef, orderMirror);

      // (2) Behavior log
      tx.set(behaviorRef, {
        action: "purchase",
        channel: "shopify",
        metadata: {
          productId: String(order.line_items[0]?.product_id ?? ""),
          orderId,
          orderNumber: String(order.order_number),
        },
        personaSignal,
        createdAt: FieldValue.serverTimestamp(),
      });

      // (3) Persona scores + (4) user upsert — merged into a single user write
      const userUpdate: Record<string, unknown> = {
        lastActiveAt: FieldValue.serverTimestamp(),
      };
      if (order.customer?.email) {
        userUpdate.email = order.customer.email;
      }
      if (order.customer?.first_name || order.customer?.last_name) {
        userUpdate.displayName = [
          order.customer?.last_name,
          order.customer?.first_name,
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (personaSignal) {
        const { primary, scores } = computePersonaUpdate(userSnap.data(), personaSignal);
        userUpdate.persona = {
          primary,
          scores,
          lastUpdated: FieldValue.serverTimestamp(),
        };
      }
      tx.set(userRef, userUpdate, { merge: true });

      return { skipped: false as const, personaSignal };
    });

    if (txResult.skipped) {
      console.log(
        `[Webhook:orders] Order ${orderId} already mirrored for customer=${customerId}, skipping`,
      );
    } else {
      console.log(
        `[Webhook:orders] Transaction committed for customer=${customerId}, order=${orderId}, signal=${txResult.personaSignal}`,
      );
    }

    // Mark webhook id as processed only after all side effects succeeded.
    await idem.markProcessed();

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

    // 運営宛の監視通知。注文の取り込みが落ちると Firestore 側の履歴・ペルソナが
    // 欠けるが、顧客側には何も見えないため気づけない。載せるのは注文番号だけで、
    // 顧客の識別子 (customerId) やメールは載せない。
    // `.catch` は保険 (monitoring-alerts 側でも例外は外に出さない)。通知の失敗で
    // 500 応答そのものが崩れると、Shopify の再送判定まで巻き込むため。
    await notifyWebhookException({
      webhook: topic,
      reference: `注文 #${order.order_number}`,
      message: error instanceof Error ? error.message : "Unknown error",
    }).catch((notifyError) =>
      console.error("[Webhook:orders] 監視通知の送出に失敗しました:", notifyError),
    );

    // Return 500 so Shopify will retry
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

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
 *   4. Return 200 immediately (Shopify retries on non-2xx)
 *
 * ## ここは persona を書かない (T-1 / CDP 統合 Stage 0)
 *
 * persona の書き手は cx-agent `src/lib/preference-pipeline.ts` の
 * `PURCHASE_SIGNAL_WEIGHT` 加算 1 本に一本化する。web-app 側と cx-agent 側の
 * 2 つの書き手が同一注文で各々加算していたため、二重加算またはカルテ分裂が
 * 起きていた。
 *
 * かつてここには `inferPersonaSignalFromOrder` (初回購入 → explorer / 高額 →
 * serenity / それ以外 → sensory) と `computePersonaUpdate` (スコア +10 の
 * マージ) があり、`users/{customerId}` の `persona` を直接書いていた。同じ
 * 注文を cx-agent 側も商品タグから採点するので、1 回の購入で 2 回加算される
 * か、後勝ちで一方の計算結果が消えるかのどちらかになる。どちらが起きたかは
 * 到着順で決まり、後から見分ける手段が無い。
 *
 * よって **web-app は「何が起きたか」(注文ミラー・behaviorLog) だけを書き、
 * 「それをどう解釈するか」(persona) は書かない**。behaviorLog の
 * `personaSignal` も web-app では推論しないので `null` (= 判定しない) を置く。
 * 解釈は購入シグナルを商品タグから導く cx-agent 側が単独で持つ。
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

    // Wrap all writes (order mirror, behavior log, user upsert) in a single
    // Firestore transaction. The idempotency read (existing order check) happens
    // inside the transaction, so concurrent deliveries of the same order cannot
    // both pass the check.
    //
    // かつてここには「注文件数の集計読み取り」と「ユーザー文書の読み取り」も
    // あった。どちらも persona 加算のためだけの読み取りで、persona を書かなく
    // なった今は結果を誰も使わない。トランザクションの読み取りは競合検出の
    // 対象になる (読んだものが他所で書き換わると再試行が起きる) ため、使わない
    // 読み取りを残すと注文の取り込みが理由なく再試行で詰まる。よって外す。
    const txResult = await db.runTransaction(async (tx) => {
      // Idempotency: if order already mirrored, skip all writes.
      const existingOrderSnap = await tx.get(orderRef);
      if (existingOrderSnap.exists) {
        return { skipped: true as const };
      }

      // (1) Order mirror
      tx.set(orderRef, orderMirror);

      // (2) Behavior log
      // `personaSignal` は **web-app では推論しない** (ファイル冒頭の T-1 注記)。
      // BehaviorEvent の型上この項目は必須なので、「判定していない」を意味する
      // null を明示的に置く。項目ごと落とすと、cx-agent が書いた過去の行と
      // 「項目が無い = 未定義」「null = 判定しない」の区別が付かなくなる。
      tx.set(behaviorRef, {
        action: "purchase",
        channel: "shopify",
        metadata: {
          productId: String(order.line_items[0]?.product_id ?? ""),
          orderId,
          orderNumber: String(order.order_number),
        },
        personaSignal: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // (3) User upsert
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
      tx.set(userRef, userUpdate, { merge: true });

      return { skipped: false as const };
    });

    if (txResult.skipped) {
      console.log(
        `[Webhook:orders] Order ${orderId} already mirrored for customer=${customerId}, skipping`,
      );
    } else {
      console.log(
        `[Webhook:orders] Transaction committed for customer=${customerId}, order=${orderId}`,
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

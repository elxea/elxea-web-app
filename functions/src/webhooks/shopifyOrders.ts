/**
 * Shopify orders/create Webhook ハンドラ（Cloud Functions v2）
 *
 * フロー:
 *   1. Shopify からの HMAC-SHA256 署名を検証
 *   2. 注文データを Firestore users/{customerId}/orders/{orderId} に書き込む
 *   3. 購入 behavior event を behaviorLog に追加
 *   4. 購入履歴に基づいて persona スコアを更新（explorer 傾向: 初回品 / sensory: リピート）
 *
 * 環境変数（Firebase Functions Config または Secret Manager）:
 *   SHOPIFY_WEBHOOK_SECRET — Shopify Webhook 共有シークレット（HMAC 検証用）
 *
 * デプロイ後に Shopify Admin の Webhook 設定で orders/create → この URL を登録する。
 */

import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { logger } from "firebase-functions";

// Firebase Admin SDK 初期化（1回だけ）
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

interface ShopifyLineItem {
  title: string;
  quantity: number;
  variant_id: number;
  product_id: number;
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
  created_at: string;
}

type PersonaType = "serenity" | "explorer" | "sensory";

// ---------------------------------------------------------------------------
// HMAC 署名検証
// ---------------------------------------------------------------------------

/**
 * Shopify Webhook の HMAC-SHA256 署名を検証する。
 *
 * Shopify は X-Shopify-Hmac-SHA256 ヘッダに base64 エンコードされた HMAC を付与する。
 * リクエストボディ全体を shared secret でハッシュし、比較する。
 */
function verifyShopifyHmac(
  body: string,
  hmacHeader: string,
  secret: string,
): boolean {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  // タイミング攻撃防止のため timingSafeEqual を使用
  const bufA = Buffer.from(hmac);
  const bufB = Buffer.from(hmacHeader);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Persona スコア更新ロジック
// ---------------------------------------------------------------------------

/**
 * 購入行動からペルソナシグナルを推定する。
 *
 * ヒューリスティック:
 *   - 初回購入（過去注文なし）→ explorer（好奇心）
 *   - 同じ商品を再購入 → sensory（感覚的執着）
 *   - 高単価（5,000円超） → serenity（落ち着き・丁寧な消費）
 */
function inferPersonaSignalFromOrder(
  order: ShopifyOrder,
  previousOrderCount: number,
): PersonaType | null {
  const totalPrice = parseFloat(order.total_price);

  if (previousOrderCount === 0) {
    return "explorer"; // 初回購入
  }
  if (totalPrice >= 5000) {
    return "serenity"; // 高単価
  }
  // リピート購入は sensory
  return "sensory";
}

/**
 * Firestore の persona スコアを更新する。
 *
 * 既存スコアに加点（シグナルに +10、他は +0）。
 * 上限は 100。
 */
async function updatePersonaScores(
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

  // 該当シグナルに加点
  const SCORE_INCREMENT = 10;
  const newScores = { ...currentScores };
  newScores[signal] = Math.min(100, (newScores[signal] ?? 0) + SCORE_INCREMENT);

  // 最高スコアを primary ペルソナとして設定
  const primary = (Object.entries(newScores).sort(
    ([, a], [, b]) => b - a,
  )[0][0]) as PersonaType;

  await userRef.set(
    {
      persona: {
        primary,
        scores: newScores,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
}

// ---------------------------------------------------------------------------
// Cloud Function 本体
// ---------------------------------------------------------------------------

export const shopifyOrderWebhook = functions.onRequest(
  {
    region: "asia-northeast1", // 東京リージョン
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: ["SHOPIFY_WEBHOOK_SECRET"],
  },
  async (req, res) => {
    // POST のみ受け付ける
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // HMAC 検証
    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error("SHOPIFY_WEBHOOK_SECRET is not set");
      res.status(500).send("Internal Server Error");
      return;
    }

    if (!hmacHeader) {
      logger.warn("Missing X-Shopify-Hmac-SHA256 header");
      res.status(401).send("Unauthorized");
      return;
    }

    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
      logger.warn("HMAC verification failed");
      res.status(401).send("Unauthorized");
      return;
    }

    const order = req.body as ShopifyOrder;

    // Shopify Customer ID が必須
    if (!order.customer?.id) {
      logger.warn("Order has no customer", { orderId: order.id });
      res.status(200).send("OK"); // Shopify に 200 を返さないとリトライされる
      return;
    }

    const customerId = String(order.customer.id);
    const orderId = String(order.id);

    logger.info("Processing Shopify order", { customerId, orderId });

    try {
      const userRef = db.collection("users").doc(customerId);

      // (1) users/{customerId}/orders/{orderId} に注文ミラーを書き込む
      const orderMirror = {
        orderNumber: String(order.order_number),
        items: order.line_items.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          variantId: String(item.variant_id),
        })),
        totalPrice: order.total_price,
        createdAt: admin.firestore.Timestamp.fromDate(
          new Date(order.created_at),
        ),
      };

      await userRef.collection("orders").doc(orderId).set(orderMirror);
      logger.info("Order mirror written", { customerId, orderId });

      // (2) 既存注文数を取得（persona シグナル推定用）
      const ordersSnapshot = await userRef.collection("orders").count().get();
      const previousOrderCount = Math.max(0, ordersSnapshot.data().count - 1);

      // (3) behaviorLog に購入イベントを追加
      const personaSignal = inferPersonaSignalFromOrder(order, previousOrderCount);
      const behaviorEvent = {
        action: "purchase",
        channel: "line",
        metadata: {
          productId: String(order.line_items[0]?.product_id ?? ""),
        },
        personaSignal,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.collection("behaviorLog").add(behaviorEvent);
      logger.info("Behavior event added", { customerId, signal: personaSignal });

      // (4) persona スコア更新
      if (personaSignal) {
        await updatePersonaScores(customerId, personaSignal);
        logger.info("Persona scores updated", { customerId, signal: personaSignal });
      }

      // ユーザーの基本情報も upsert（email・名前）
      const userUpdate: Record<string, unknown> = {
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
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

      res.status(200).send("OK");
    } catch (err) {
      logger.error("Failed to process order", { customerId, orderId, err });
      // 500 を返すと Shopify がリトライする
      res.status(500).send("Internal Server Error");
    }
  },
);

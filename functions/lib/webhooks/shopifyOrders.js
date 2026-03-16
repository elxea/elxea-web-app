"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.shopifyOrderWebhook = void 0;
const functions = __importStar(require("firebase-functions/v2/https"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const firebase_functions_1 = require("firebase-functions");
// Firebase Admin SDK 初期化（1回だけ）
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
// ---------------------------------------------------------------------------
// HMAC 署名検証
// ---------------------------------------------------------------------------
/**
 * Shopify Webhook の HMAC-SHA256 署名を検証する。
 *
 * Shopify は X-Shopify-Hmac-SHA256 ヘッダに base64 エンコードされた HMAC を付与する。
 * リクエストボディ全体を shared secret でハッシュし、比較する。
 */
function verifyShopifyHmac(body, hmacHeader, secret) {
    const hmac = crypto
        .createHmac("sha256", secret)
        .update(body, "utf8")
        .digest("base64");
    // タイミング攻撃防止のため timingSafeEqual を使用
    const bufA = Buffer.from(hmac);
    const bufB = Buffer.from(hmacHeader);
    if (bufA.length !== bufB.length)
        return false;
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
function inferPersonaSignalFromOrder(order, previousOrderCount) {
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
async function updatePersonaScores(customerId, signal) {
    const userRef = db.collection("users").doc(customerId);
    const userDoc = await userRef.get();
    const data = userDoc.data();
    const currentScores = data?.persona?.scores ?? {
        serenity: 0,
        explorer: 0,
        sensory: 0,
    };
    // 該当シグナルに加点
    const SCORE_INCREMENT = 10;
    const newScores = { ...currentScores };
    newScores[signal] = Math.min(100, (newScores[signal] ?? 0) + SCORE_INCREMENT);
    // 最高スコアを primary ペルソナとして設定
    const primary = (Object.entries(newScores).sort(([, a], [, b]) => b - a)[0][0]);
    await userRef.set({
        persona: {
            primary,
            scores: newScores,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
    }, { merge: true });
}
// ---------------------------------------------------------------------------
// Cloud Function 本体
// ---------------------------------------------------------------------------
exports.shopifyOrderWebhook = functions.onRequest({
    region: "asia-northeast1", // 東京リージョン
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: ["SHOPIFY_WEBHOOK_SECRET"],
}, async (req, res) => {
    // POST のみ受け付ける
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    // HMAC 検証
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        firebase_functions_1.logger.error("SHOPIFY_WEBHOOK_SECRET is not set");
        res.status(500).send("Internal Server Error");
        return;
    }
    if (!hmacHeader) {
        firebase_functions_1.logger.warn("Missing X-Shopify-Hmac-SHA256 header");
        res.status(401).send("Unauthorized");
        return;
    }
    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
        firebase_functions_1.logger.warn("HMAC verification failed");
        res.status(401).send("Unauthorized");
        return;
    }
    const order = req.body;
    // Shopify Customer ID が必須
    if (!order.customer?.id) {
        firebase_functions_1.logger.warn("Order has no customer", { orderId: order.id });
        res.status(200).send("OK"); // Shopify に 200 を返さないとリトライされる
        return;
    }
    const customerId = String(order.customer.id);
    const orderId = String(order.id);
    firebase_functions_1.logger.info("Processing Shopify order", { customerId, orderId });
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
            createdAt: admin.firestore.Timestamp.fromDate(new Date(order.created_at)),
        };
        await userRef.collection("orders").doc(orderId).set(orderMirror);
        firebase_functions_1.logger.info("Order mirror written", { customerId, orderId });
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
        firebase_functions_1.logger.info("Behavior event added", { customerId, signal: personaSignal });
        // (4) persona スコア更新
        if (personaSignal) {
            await updatePersonaScores(customerId, personaSignal);
            firebase_functions_1.logger.info("Persona scores updated", { customerId, signal: personaSignal });
        }
        // ユーザーの基本情報も upsert（email・名前）
        const userUpdate = {
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
    }
    catch (err) {
        firebase_functions_1.logger.error("Failed to process order", { customerId, orderId, err });
        // 500 を返すと Shopify がリトライする
        res.status(500).send("Internal Server Error");
    }
});
//# sourceMappingURL=shopifyOrders.js.map
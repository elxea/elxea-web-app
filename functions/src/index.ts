/**
 * elxea Cloud Functions v2 エントリポイント
 *
 * - shopifyOrderWebhook: Shopify orders/create Webhook → Firestore 購入履歴書き込み + persona スコア更新
 * - syncPersonaToShopify: 日次バッチ Firestore persona/tier → Shopify Customer Metafield 同期
 * - recalculatePersona: Firestore trigger → behaviorLog 追加時にペルソナ再計算
 */

export { shopifyOrderWebhook } from "./webhooks/shopifyOrders";
export { syncPersonaToShopify } from "./batch/syncPersona";
export { recalculatePersona } from "./triggers/personaCalculator";

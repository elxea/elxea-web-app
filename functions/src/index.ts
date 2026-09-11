/**
 * elxea Cloud Functions v2 エントリポイント
 *
 * - shopifyOrderWebhook: Shopify orders/create Webhook → Firestore 購入履歴書き込み + persona スコア更新
 * - syncPersonaToShopify: 日次バッチ Firestore persona/tier → Shopify Customer Metafield 同期
 *
 * Note: recalculatePersona (Firestore trigger) は削除済み。
 * ペルソナ計算は elxea-cx-agent の preference-pipeline が Single Source of Truth。
 * Web 側で独自にペルソナを計算しない。
 */

export { shopifyOrderWebhook } from "./webhooks/shopifyOrders";
export { syncPersonaToShopify } from "./batch/syncPersona";

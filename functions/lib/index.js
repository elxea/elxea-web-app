"use strict";
/**
 * elxea Cloud Functions v2 エントリポイント
 *
 * - shopifyOrderWebhook: Shopify orders/create Webhook → Firestore 購入履歴書き込み + persona スコア更新
 * - syncPersonaToShopify: 日次バッチ Firestore persona/tier → Shopify Customer Metafield 同期
 *
 * Note: recalculatePersona (Firestore trigger) は削除済み。
 * ペルソナ計算は elxea-cx-agent の preference-pipeline が Single Source of Truth。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPersonaToShopify = exports.shopifyOrderWebhook = void 0;
var shopifyOrders_1 = require("./webhooks/shopifyOrders");
Object.defineProperty(exports, "shopifyOrderWebhook", { enumerable: true, get: function () { return shopifyOrders_1.shopifyOrderWebhook; } });
var syncPersona_1 = require("./batch/syncPersona");
Object.defineProperty(exports, "syncPersonaToShopify", { enumerable: true, get: function () { return syncPersona_1.syncPersonaToShopify; } });
//# sourceMappingURL=index.js.map

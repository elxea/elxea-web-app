"use strict";
/**
 * elxea Cloud Functions v2 エントリポイント
 *
 * - shopifyOrderWebhook: Shopify orders/create Webhook → Firestore 購入履歴書き込み + persona スコア更新
 * - syncPersonaToShopify: 日次バッチ Firestore persona/tier → Shopify Customer Metafield 同期
 * - recalculatePersona: Firestore trigger → behaviorLog 追加時にペルソナ再計算
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculatePersona = exports.syncPersonaToShopify = exports.shopifyOrderWebhook = void 0;
var shopifyOrders_1 = require("./webhooks/shopifyOrders");
Object.defineProperty(exports, "shopifyOrderWebhook", { enumerable: true, get: function () { return shopifyOrders_1.shopifyOrderWebhook; } });
var syncPersona_1 = require("./batch/syncPersona");
Object.defineProperty(exports, "syncPersonaToShopify", { enumerable: true, get: function () { return syncPersona_1.syncPersonaToShopify; } });
var personaCalculator_1 = require("./triggers/personaCalculator");
Object.defineProperty(exports, "recalculatePersona", { enumerable: true, get: function () { return personaCalculator_1.recalculatePersona; } });
//# sourceMappingURL=index.js.map
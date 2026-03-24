"use strict";
/**
 * Firestore Trigger: ペルソナ判定 Cloud Function
 *
 * behaviorLog サブコレクションにドキュメントが追加されたとき、
 * 累積イベント数が閾値（10件）を超えたら persona スコアを再計算する。
 *
 * ロジック（ルールベース）:
 *   serenity:  リラックス系コンテンツ閲覧、ほうじ茶・緑茶言及、topic_interest(serenity)
 *   explorer:  新商品・産地閲覧(view_product)、多様な茶種言及(tea_mention)、search
 *   sensory:   フレーバー表現・ペアリング閲覧、flavor_preference イベント
 *
 * 各ペルソナスコアは 0–100 の範囲。最高スコアが primary ペルソナ。
 *
 * トリガー: onDocumentCreated → users/{customerId}/behaviorLog/{docId}
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
exports.recalculatePersona = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
/** ペルソナ判定を実行する最小イベント数 */
const PERSONA_THRESHOLD = 10;
/** 1イベントあたりの最大スコア加算 */
const SCORE_INCREMENT = 10;
/** スコア上限 */
const SCORE_MAX = 100;
// ---------------------------------------------------------------------------
// ペルソナスコア算出ロジック
// ---------------------------------------------------------------------------
/**
 * ルールベースでイベントリストから各ペルソナのスコアを算出する。
 *
 * スコアリング方針:
 *   - personaSignal が明示されている場合は、そのシグナルに SCORE_INCREMENT を加算
 *   - personaSignal が null の場合は action と metadata から推定
 *
 * serenity キーワード（contentId / query に含まれる場合）:
 *   relax, hojicha, ほうじ茶, green, 緑茶, evening, 夜, くつろぎ, リラックス
 *
 * sensory キーワード:
 *   flavor, pairing, ペアリング, taste, 味, フレーバー, 甘, 苦, 渋
 *
 * explorer キーワード:
 *   origin, region, 産地, 農園, new, 新, search, variety, 茶種
 */
function calculatePersonaScores(events) {
    const scores = { serenity: 0, explorer: 0, sensory: 0 };
    const SERENITY_KEYWORDS = [
        "relax", "hojicha", "ほうじ茶", "green", "緑茶", "evening",
        "夜", "くつろぎ", "リラックス", "serenity",
    ];
    const SENSORY_KEYWORDS = [
        "flavor", "pairing", "ペアリング", "taste", "味", "フレーバー",
        "甘", "苦", "渋", "sensory", "read:",
    ];
    const EXPLORER_KEYWORDS = [
        "origin", "region", "産地", "農園", "new", "新", "variety",
        "茶種", "explorer", "product",
    ];
    function matchesKeywords(text, keywords) {
        const lower = text.toLowerCase();
        return keywords.some((kw) => lower.includes(kw.toLowerCase()));
    }
    for (const event of events) {
        // 明示的なペルソナシグナルがある場合はそれを優先
        if (event.personaSignal) {
            scores[event.personaSignal] = Math.min(SCORE_MAX, scores[event.personaSignal] + SCORE_INCREMENT);
            continue;
        }
        // action 別のデフォルトシグナル
        const { action, metadata } = event;
        const contentId = metadata?.contentId ?? "";
        const query = metadata?.query ?? "";
        const buttonLabel = metadata?.buttonLabel ?? "";
        const combined = `${action} ${contentId} ${query} ${buttonLabel}`;
        if (action === "flavor_preference") {
            scores.sensory = Math.min(SCORE_MAX, scores.sensory + SCORE_INCREMENT);
        }
        else if (action === "tea_mention") {
            scores.explorer = Math.min(SCORE_MAX, scores.explorer + SCORE_INCREMENT);
        }
        else if (action === "topic_interest") {
            // topic_interest はキーワードで分岐
            if (matchesKeywords(combined, SERENITY_KEYWORDS)) {
                scores.serenity = Math.min(SCORE_MAX, scores.serenity + SCORE_INCREMENT);
            }
            else {
                scores.explorer = Math.min(SCORE_MAX, scores.explorer + SCORE_INCREMENT);
            }
        }
        else if (action === "view_product" || action === "search") {
            scores.explorer = Math.min(SCORE_MAX, scores.explorer + SCORE_INCREMENT);
        }
        else if (action === "view_content") {
            // コンテンツ系はキーワードで判定
            if (matchesKeywords(combined, SENSORY_KEYWORDS)) {
                scores.sensory = Math.min(SCORE_MAX, scores.sensory + SCORE_INCREMENT);
            }
            else if (matchesKeywords(combined, SERENITY_KEYWORDS)) {
                scores.serenity = Math.min(SCORE_MAX, scores.serenity + SCORE_INCREMENT);
            }
            else if (matchesKeywords(combined, EXPLORER_KEYWORDS)) {
                scores.explorer = Math.min(SCORE_MAX, scores.explorer + SCORE_INCREMENT);
            }
            else {
                // 分類不能なコンテンツ閲覧は全ペルソナに少し加算
                scores.serenity = Math.min(SCORE_MAX, scores.serenity + Math.floor(SCORE_INCREMENT / 3));
                scores.explorer = Math.min(SCORE_MAX, scores.explorer + Math.floor(SCORE_INCREMENT / 3));
                scores.sensory = Math.min(SCORE_MAX, scores.sensory + Math.floor(SCORE_INCREMENT / 3));
            }
        }
        // purchase / line_message / tap_button は直接スコアリングしない
    }
    return scores;
}
/**
 * スコアマップから最高スコアのペルソナを返す。
 * 同点の場合は serenity > sensory > explorer の優先順位。
 */
function getPrimaryPersona(scores) {
    const priority = ["serenity", "sensory", "explorer"];
    let best = "serenity";
    let bestScore = -1;
    for (const persona of priority) {
        if (scores[persona] > bestScore) {
            bestScore = scores[persona];
            best = persona;
        }
    }
    return best;
}
// ---------------------------------------------------------------------------
// Cloud Function 本体
// ---------------------------------------------------------------------------
/**
 * behaviorLog にドキュメントが追加されたとき、ペルソナを再計算する。
 *
 * - イベント数 < PERSONA_THRESHOLD の場合は何もしない
 * - 過去 50 件のイベントをサンプリングしてスコア算出
 * - users/{customerId} の persona フィールドを更新
 */
exports.recalculatePersona = (0, firestore_1.onDocumentCreated)({
    document: "users/{customerId}/behaviorLog/{docId}",
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
}, async (event) => {
    const customerId = event.params.customerId;
    const userRef = db.collection("users").doc(customerId);
    firebase_functions_1.logger.info("behaviorLog created, checking persona threshold", {
        customerId,
        docId: event.params.docId,
    });
    try {
        // イベント総数チェック
        const countSnapshot = await userRef.collection("behaviorLog").count().get();
        const totalCount = countSnapshot.data().count;
        if (totalCount < PERSONA_THRESHOLD) {
            firebase_functions_1.logger.info("Below persona threshold, skipping", {
                customerId,
                totalCount,
                threshold: PERSONA_THRESHOLD,
            });
            return;
        }
        // 直近 50 件のイベントを取得してスコア算出
        const eventsSnapshot = await userRef
            .collection("behaviorLog")
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();
        const events = eventsSnapshot.docs.map((doc) => doc.data());
        const scores = calculatePersonaScores(events);
        const primary = getPrimaryPersona(scores);
        firebase_functions_1.logger.info("Persona scores calculated", { customerId, scores, primary });
        // users/{customerId} の persona フィールドを更新
        await userRef.set({
            persona: {
                primary,
                scores,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
        firebase_functions_1.logger.info("Persona updated", { customerId, primary });
    }
    catch (err) {
        firebase_functions_1.logger.error("Failed to recalculate persona", { customerId, err });
    }
});
//# sourceMappingURL=personaCalculator.js.map
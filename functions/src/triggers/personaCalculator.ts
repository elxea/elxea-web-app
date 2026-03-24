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
 *
 * Design decisions:
 *   - Keywords are loaded from a JSON config file (persona-keywords.json) so
 *     they can be updated without redeploying the function.
 *   - Purchase events are now scored (Fix #2) — the strongest behavioral signal.
 *   - Exponential time decay is applied (Fix #6) — recent actions weigh more.
 *   - durationSeconds from view_content events boosts engagement score (Fix #6).
 *   - Japanese substring matching handles inflections naturally (Fix #1):
 *     「ほうじ茶」 matches 「ほうじ茶の」「ほうじ茶ラテ」 via String.includes().
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import keywordConfig from "../config/persona-keywords.json";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** ペルソナ判定を実行する最小イベント数 */
const PERSONA_THRESHOLD = 10;

/** 1イベントあたりの基本スコア加算 */
const SCORE_INCREMENT = 10;

/** 購入イベントのスコア加算（購入は最も強い意図シグナル） */
const PURCHASE_SCORE_INCREMENT = 15;

/** スコア上限 */
const SCORE_MAX = 100;

/**
 * Time decay half-life in days.
 * After this many days, an event's contribution is halved.
 * 14 days balances recency with enough history to form stable personas.
 */
const DECAY_HALF_LIFE_DAYS = 14;

/**
 * Engagement depth bonus threshold in seconds.
 * view_content events with durationSeconds >= this value receive a 50% score
 * boost, reflecting deeper engagement with the content.
 */
const DEEP_READ_THRESHOLD_SECONDS = 120;

/** Engagement depth bonus multiplier (1.5x for deep reads) */
const DEEP_READ_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

type PersonaType = "serenity" | "explorer" | "sensory";

type PersonaScores = {
  serenity: number;
  explorer: number;
  sensory: number;
};

type BehaviorEvent = {
  action: string;
  channel: string;
  metadata?: {
    contentId?: string;
    productId?: string;
    query?: string;
    buttonLabel?: string;
    /** Reading duration in seconds (tracked by behavior-tracker) */
    durationSeconds?: number;
    /** Product tags or category from Shopify (set by order webhook) */
    productTags?: string[];
    productCategory?: string;
  };
  personaSignal?: PersonaType | null;
  createdAt?: admin.firestore.Timestamp;
};

// ---------------------------------------------------------------------------
// Keyword config (loaded from JSON — Fix #1)
// ---------------------------------------------------------------------------

const SERENITY_KEYWORDS: string[] = keywordConfig.serenity;
const SENSORY_KEYWORDS: string[] = keywordConfig.sensory;
const EXPLORER_KEYWORDS: string[] = keywordConfig.explorer;
const PURCHASE_SIGNALS = keywordConfig.purchaseSignals;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Substring match against a keyword list.
 * Uses String.includes() which naturally handles Japanese inflections:
 * 「ほうじ茶」 matches 「ほうじ茶の」「ほうじ茶ラテ」「冷ほうじ茶」
 *
 * This avoids the need for a Japanese morphological analyzer (MeCab etc.)
 * which would add significant complexity and latency to a Cloud Function.
 */
function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Compute exponential time decay factor for an event.
 * Returns a value between 0 and 1 where:
 *   - 1.0 = event happened just now
 *   - 0.5 = event happened DECAY_HALF_LIFE_DAYS ago
 *   - 0.25 = event happened 2 * DECAY_HALF_LIFE_DAYS ago
 *
 * Formula: decay = 2^(-daysSinceEvent / halfLife)
 */
function computeDecayFactor(
  eventTimestamp: admin.firestore.Timestamp | undefined,
  now: Date,
): number {
  if (!eventTimestamp) return 0.5; // Unknown timestamp → treat as moderately old

  const eventDate = eventTimestamp.toDate();
  const daysSince =
    (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince <= 0) return 1.0;

  return Math.pow(2, -daysSince / DECAY_HALF_LIFE_DAYS);
}

/**
 * Add a decayed score increment to a persona score, clamping to SCORE_MAX.
 */
function addScore(
  current: number,
  increment: number,
  decayFactor: number,
  engagementMultiplier: number = 1.0,
): number {
  const effective = increment * decayFactor * engagementMultiplier;
  return Math.min(SCORE_MAX, current + effective);
}

// ---------------------------------------------------------------------------
// ペルソナスコア算出ロジック
// ---------------------------------------------------------------------------

/**
 * Rule-based persona scoring from a list of behavior events.
 *
 * Improvements over v1:
 *   - Keywords loaded from config file (not hardcoded) — Fix #1
 *   - Purchase events scored using product tags/category — Fix #2
 *   - Exponential time decay applied to all events — Fix #6
 *   - durationSeconds boosts engagement score — Fix #6
 */
function calculatePersonaScores(events: BehaviorEvent[]): PersonaScores {
  const scores: PersonaScores = { serenity: 0, explorer: 0, sensory: 0 };
  const now = new Date();

  for (const event of events) {
    const decay = computeDecayFactor(event.createdAt, now);
    const { action, metadata } = event;
    const durationSeconds = metadata?.durationSeconds ?? 0;

    // Engagement depth multiplier: longer reads get a boost (Fix #6)
    const engagementMultiplier =
      action === "view_content" && durationSeconds >= DEEP_READ_THRESHOLD_SECONDS
        ? DEEP_READ_MULTIPLIER
        : 1.0;

    // 1. Explicit persona signal takes priority
    if (event.personaSignal) {
      scores[event.personaSignal] = addScore(
        scores[event.personaSignal],
        SCORE_INCREMENT,
        decay,
        engagementMultiplier,
      );
      continue;
    }

    const contentId = metadata?.contentId ?? "";
    const query = metadata?.query ?? "";
    const buttonLabel = metadata?.buttonLabel ?? "";
    const combined = `${action} ${contentId} ${query} ${buttonLabel}`;

    // 2. Purchase events — strongest behavioral signal (Fix #2)
    if (action === "purchase") {
      const productTags = metadata?.productTags ?? [];
      const productCategory = metadata?.productCategory ?? "";
      const purchaseText = [...productTags, productCategory].join(" ");

      let matched = false;
      for (const persona of ["serenity", "sensory", "explorer"] as const) {
        const signals = PURCHASE_SIGNALS[persona];
        if (matchesKeywords(purchaseText, signals)) {
          scores[persona] = addScore(
            scores[persona],
            PURCHASE_SCORE_INCREMENT,
            decay,
          );
          matched = true;
        }
      }
      // Unclassifiable purchase still shows engagement — slight boost to explorer
      if (!matched) {
        scores.explorer = addScore(scores.explorer, SCORE_INCREMENT * 0.5, decay);
      }
      continue;
    }

    // 3. Action-specific scoring
    if (action === "flavor_preference") {
      scores.sensory = addScore(scores.sensory, SCORE_INCREMENT, decay);
    } else if (action === "tea_mention") {
      scores.explorer = addScore(scores.explorer, SCORE_INCREMENT, decay);
    } else if (action === "topic_interest") {
      if (matchesKeywords(combined, SERENITY_KEYWORDS)) {
        scores.serenity = addScore(
          scores.serenity,
          SCORE_INCREMENT,
          decay,
        );
      } else if (matchesKeywords(combined, SENSORY_KEYWORDS)) {
        scores.sensory = addScore(scores.sensory, SCORE_INCREMENT, decay);
      } else {
        scores.explorer = addScore(scores.explorer, SCORE_INCREMENT, decay);
      }
    } else if (action === "view_product" || action === "search") {
      scores.explorer = addScore(
        scores.explorer,
        SCORE_INCREMENT,
        decay,
        engagementMultiplier,
      );
    } else if (action === "view_content") {
      if (matchesKeywords(combined, SENSORY_KEYWORDS)) {
        scores.sensory = addScore(
          scores.sensory,
          SCORE_INCREMENT,
          decay,
          engagementMultiplier,
        );
      } else if (matchesKeywords(combined, SERENITY_KEYWORDS)) {
        scores.serenity = addScore(
          scores.serenity,
          SCORE_INCREMENT,
          decay,
          engagementMultiplier,
        );
      } else if (matchesKeywords(combined, EXPLORER_KEYWORDS)) {
        scores.explorer = addScore(
          scores.explorer,
          SCORE_INCREMENT,
          decay,
          engagementMultiplier,
        );
      } else {
        // Unclassifiable content view → small boost to all (reduced by decay)
        const third = SCORE_INCREMENT / 3;
        scores.serenity = addScore(scores.serenity, third, decay, engagementMultiplier);
        scores.explorer = addScore(scores.explorer, third, decay, engagementMultiplier);
        scores.sensory = addScore(scores.sensory, third, decay, engagementMultiplier);
      }
    }
    // line_message / tap_button → no direct scoring (low-intent signals)
  }

  return scores;
}

/**
 * Return the highest-scoring persona.
 * Tie-breaking priority: serenity > sensory > explorer
 */
function getPrimaryPersona(scores: PersonaScores): PersonaType {
  const priority: PersonaType[] = ["serenity", "sensory", "explorer"];
  let best: PersonaType = "serenity";
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
export const recalculatePersona = onDocumentCreated(
  {
    document: "users/{customerId}/behaviorLog/{docId}",
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (event) => {
    const customerId = event.params.customerId;
    const userRef = db.collection("users").doc(customerId);

    logger.info("behaviorLog created, checking persona threshold", {
      customerId,
      docId: event.params.docId,
    });

    try {
      // イベント総数チェック
      const countSnapshot = await userRef.collection("behaviorLog").count().get();
      const totalCount = countSnapshot.data().count;

      if (totalCount < PERSONA_THRESHOLD) {
        logger.info("Below persona threshold, skipping", {
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

      const events: BehaviorEvent[] = eventsSnapshot.docs.map((doc) =>
        doc.data() as BehaviorEvent,
      );

      const scores = calculatePersonaScores(events);
      const primary = getPrimaryPersona(scores);

      logger.info("Persona scores calculated", { customerId, scores, primary });

      // users/{customerId} の persona フィールドを更新
      await userRef.set(
        {
          persona: {
            primary,
            scores,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );

      logger.info("Persona updated", { customerId, primary });
    } catch (err) {
      logger.error("Failed to recalculate persona", { customerId, err });
    }
  },
);

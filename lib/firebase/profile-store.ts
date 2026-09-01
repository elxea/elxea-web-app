/**
 * 顧客プロファイル 第1段の**画面の状態**を Firestore に持つ層。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ① / ⑤ / ⑥。
 *
 * ## ここは「解釈」を持たない（役割の線引き・重要）
 *
 * 出来事の正本は **L0（cx-agent の `customer_events`）**、見立て（解釈）の正本は
 * **L1** で、どちらも web-app は書かない。ここが持つのは
 * 「**もう聞いたかどうか**」という画面の状態だけである。
 *
 *   - 同じ一杯を二度聞かないため（設計 §2「しつこくしない」）
 *   - 同じ注文の「誰のために」を二度聞かないため
 *   - 申告済みの内容をその人に見せ返すため（§4 透明性）
 *
 * L0 に積めたかどうかと、ここに印を付けるかは**別**にしてある。gateway が落ちた
 * ときに印だけ残ると、その一杯は二度と聞けないまま L0 に何も無い状態になる。
 * だから呼び出し側は **L0 に積めたときだけ印を付ける**（route を参照）。
 *
 * ## 新しいコレクションを作らない
 *
 * 置き場は既存の `users/{userKey}` 本体と `users/{userKey}/orders` だけ。
 * `USER_SUBCOLLECTIONS`（`lib/firebase/collections.ts`）を増やすと合体
 * （`lib/auth/identity-merge.ts`）の荷物が増え、運び忘れの面が広がる。
 * 本体のフィールドと既存の注文ミラーに寄せれば、合体は既存の経路のまま通る。
 */

import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminFirestore } from "./admin";
import { ordersCol, userDoc } from "./collections";
import { isSafetyTag, type SafetyTag } from "@/lib/cdp/cup-feedback";

/** 一杯ぶんの印。`declined` は「いまは答えない」を押したもの。 */
export interface CupFeedbackMark {
  issueRef: string;
  at: string;
  declined: boolean;
}

/** 5 桁の銘柄番号 → 印。 */
export type CupFeedbackMarks = Record<string, CupFeedbackMark>;

/**
 * すでに聞き終わった一杯の印を読む。**決して throw しない**（読めなければ空）。
 *
 * 読めなかったときに空を返すのは、「聞いてよいか分からない」を「まだ聞いていない」
 * 側に倒す判断である。最悪もう一度聞くだけで済み、逆（全部聞き終わったことに
 * する）だと反応が永久に取れない。
 */
export async function getCupFeedbackMarks(userKey: string): Promise<CupFeedbackMarks> {
  const db = getAdminFirestore();
  const snapshot = await db.doc(userDoc(userKey)).get();
  const raw = snapshot.data()?.cupFeedback;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const marks: CupFeedbackMarks = {};
  for (const [productNo, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const mark = value as Record<string, unknown>;
    if (typeof mark.issueRef !== "string" || typeof mark.at !== "string") continue;
    marks[productNo] = {
      issueRef: mark.issueRef,
      at: mark.at,
      declined: mark.declined === true,
    };
  }
  return marks;
}

/**
 * 一杯ぶんの印を付ける（上書き）。
 *
 * `merge: true` の入れ子キーで 1 銘柄だけを触る。ドキュメント全体を読んで書き戻すと、
 * 同時に別のタブから答えられたときにどちらかの印が消える。
 */
export async function markCupFeedback(
  userKey: string,
  productNo: string,
  mark: CupFeedbackMark,
): Promise<void> {
  const db = getAdminFirestore();
  await db.doc(userDoc(userKey)).set(
    { cupFeedback: { [productNo]: mark }, lastActiveAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** 申告済みの「避けたいもの」。 */
export interface SafetyDeclaration {
  tags: SafetyTag[];
  updatedAt: string | null;
}

/** 申告済みの内容を読む（読めなければ空）。 */
export async function getSafetyDeclaration(userKey: string): Promise<SafetyDeclaration> {
  const db = getAdminFirestore();
  const snapshot = await db.doc(userDoc(userKey)).get();
  const raw = snapshot.data()?.safety;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { tags: [], updatedAt: null };
  const record = raw as Record<string, unknown>;
  const tags = Array.isArray(record.tags) ? record.tags.filter(isSafetyTag) : [];
  return {
    tags: [...new Set(tags)].sort(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

/**
 * 「避けたいもの」を**足す**（和集合）。
 *
 * ⚠ **減らせない**。cx-agent の L1 は `safety.declared` を「減らす方向に畳まない」
 * ので、ここだけ減らすと画面と選定がずれる（画面では消えたのに、お茶は外れたまま）。
 * 解除は `safety.cleared` を語彙に足す第2段の仕事で、画面もそう書いてある。
 *
 * @returns 実際に足された分（すでに申告済みだったものは含まない）
 */
export async function addSafetyTags(
  userKey: string,
  tags: readonly SafetyTag[],
): Promise<{ added: SafetyTag[]; tags: SafetyTag[] }> {
  const current = await getSafetyDeclaration(userKey);
  const added = tags.filter((tag) => !current.tags.includes(tag));
  if (added.length === 0) return { added: [], tags: current.tags };

  const next = [...new Set([...current.tags, ...added])].sort();
  const db = getAdminFirestore();
  await db.doc(userDoc(userKey)).set(
    {
      safety: { tags: next, updatedAt: new Date().toISOString() },
      lastActiveAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { added, tags: next };
}

/** 「誰のために」をまだ聞いていない注文 1 件。 */
export interface PendingRecipientOrder {
  orderId: string;
  orderNumber: string;
  orderedAt: string | null;
}

/** 遡って聞く注文の数。古い注文まで掘り返すと、思い出せないことを聞くことになる。 */
const RECIPIENT_LOOKBACK_ORDERS = 5;

/**
 * 「誰のために買ったか」をまだ聞いていない、いちばん新しい注文を返す。
 *
 * 注文ミラー（`users/{userKey}/orders`・Shopify の注文 webhook が書く）を新しい順に
 * 数件だけ見る。**購入画面の外**で聞く、という設計 §2 の指定は、この
 * 「次に開いたときに 1 枚出す」形で満たしている（決済導線は Shopify 側にあり、
 * そもそもこちらから割り込めない）。
 */
export async function getPendingRecipientOrder(
  userKey: string,
): Promise<PendingRecipientOrder | null> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection(ordersCol(userKey))
    .orderBy("createdAt", "desc")
    .limit(RECIPIENT_LOOKBACK_ORDERS)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (typeof data.recipientScene === "string") continue;
    const createdAt = data.createdAt;
    return {
      orderId: doc.id,
      orderNumber: typeof data.orderNumber === "string" ? data.orderNumber : doc.id,
      orderedAt:
        createdAt && typeof createdAt.toDate === "function"
          ? (createdAt.toDate() as Date).toISOString()
          : null,
    };
  }
  return null;
}

/**
 * 注文 1 件に「誰のために」を記す。
 *
 * 注文ミラーがまだ書かれていない（webhook が遅れている）場合も考えて `merge: true`
 * で置く。ミラーが後から来ても、この 1 フィールドは残る。
 */
export async function markOrderRecipient(
  userKey: string,
  orderId: string,
  scene: string,
): Promise<void> {
  const db = getAdminFirestore();
  await db
    .collection(ordersCol(userKey))
    .doc(orderId)
    .set({ recipientScene: scene, recipientDeclaredAt: new Date().toISOString() }, { merge: true });
}

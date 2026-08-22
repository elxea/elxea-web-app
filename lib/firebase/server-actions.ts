/**
 * Server-side Firestore operations using Firebase Admin SDK.
 * These are called from API routes (not directly from client components).
 */
import { FieldValue, type Query } from "firebase-admin/firestore";
import { getAdminFirestore } from "./admin";
import { COLLECTIONS, favoritesCol, followsCol, eventRegistrationsCol, behaviorLogCol, userDoc } from "./collections";
import type {
  FavoriteType,
  CommentTargetType,
  BehaviorAction,
  BehaviorChannel,
  BehaviorEventMetadata,
  PersonaType,
} from "./types";

const COMMENT_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function addFavorite(
  customerId: string,
  data: {
    type: FavoriteType;
    targetId: string;
    title: string;
    imageUrl: string | null;
  }
) {
  const db = getAdminFirestore();
  const colPath = favoritesCol(customerId);

  // Check for duplicate (same type + targetId)
  const existing = await db
    .collection(colPath)
    .where("type", "==", data.type)
    .where("targetId", "==", data.targetId)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { success: true, action: "already_exists" as const };
  }

  const docRef = await db.collection(colPath).add({
    ...data,
    createdAt: new Date(),
  });

  return { success: true, action: "created" as const, id: docRef.id };
}

export async function removeFavorite(
  customerId: string,
  type: FavoriteType,
  targetId: string
) {
  const db = getAdminFirestore();
  const colPath = favoritesCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("type", "==", type)
    .where("targetId", "==", targetId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { success: true, action: "not_found" as const };
  }

  await snapshot.docs[0].ref.delete();
  return { success: true, action: "removed" as const };
}

export async function getFavorites(customerId: string, type?: FavoriteType) {
  const db = getAdminFirestore();
  const colPath = favoritesCol(customerId);

  // Firestore requires where() before orderBy() when filtering on a different field
  let query: Query = db.collection(colPath);
  if (type) {
    query = query.where("type", "==", type);
  }
  query = query.orderBy("createdAt", "desc");

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
  }));
}

export async function isFavorited(
  customerId: string,
  type: FavoriteType,
  targetId: string
): Promise<boolean> {
  const db = getAdminFirestore();
  const colPath = favoritesCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("type", "==", type)
    .where("targetId", "==", targetId)
    .limit(1)
    .get();

  return !snapshot.empty;
}

// ---------------------------------------------------------------------------
// Farmer follows
// ---------------------------------------------------------------------------

export async function followFarmer(
  customerId: string,
  data: {
    farmerSlug: string;
    farmerName: string;
    farmerImageUrl: string | null;
  }
) {
  const db = getAdminFirestore();
  const colPath = followsCol(customerId);

  const existing = await db
    .collection(colPath)
    .where("farmerSlug", "==", data.farmerSlug)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { success: true, action: "already_following" as const };
  }

  const docRef = await db.collection(colPath).add({
    ...data,
    createdAt: new Date(),
  });

  return { success: true, action: "followed" as const, id: docRef.id };
}

export async function unfollowFarmer(customerId: string, farmerSlug: string) {
  const db = getAdminFirestore();
  const colPath = followsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("farmerSlug", "==", farmerSlug)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { success: true, action: "not_found" as const };
  }

  await snapshot.docs[0].ref.delete();
  return { success: true, action: "unfollowed" as const };
}

export async function getFollows(customerId: string) {
  const db = getAdminFirestore();
  const colPath = followsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
  }));
}

export async function isFollowing(
  customerId: string,
  farmerSlug: string
): Promise<boolean> {
  const db = getAdminFirestore();
  const colPath = followsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("farmerSlug", "==", farmerSlug)
    .limit(1)
    .get();

  return !snapshot.empty;
}

// ---------------------------------------------------------------------------
// Event registrations
// ---------------------------------------------------------------------------

export async function registerForEvent(
  customerId: string,
  data: {
    eventSlug: string;
    eventTitle: string;
    eventDate: string | null;
    eventImageUrl: string | null;
  }
) {
  const db = getAdminFirestore();
  const colPath = eventRegistrationsCol(customerId);

  const existing = await db
    .collection(colPath)
    .where("eventSlug", "==", data.eventSlug)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { success: true, action: "already_registered" as const };
  }

  const docRef = await db.collection(colPath).add({
    ...data,
    registeredAt: new Date(),
  });

  return { success: true, action: "registered" as const, id: docRef.id };
}

export async function cancelEventRegistration(
  customerId: string,
  eventSlug: string
) {
  const db = getAdminFirestore();
  const colPath = eventRegistrationsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("eventSlug", "==", eventSlug)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { success: true, action: "not_found" as const };
  }

  await snapshot.docs[0].ref.delete();
  return { success: true, action: "cancelled" as const };
}

export async function getEventRegistrations(customerId: string) {
  const db = getAdminFirestore();
  const colPath = eventRegistrationsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .orderBy("registeredAt", "desc")
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    registeredAt: doc.data().registeredAt?.toDate?.()?.toISOString() ?? null,
  }));
}

export async function isRegisteredForEvent(
  customerId: string,
  eventSlug: string
): Promise<boolean> {
  const db = getAdminFirestore();
  const colPath = eventRegistrationsCol(customerId);

  const snapshot = await db
    .collection(colPath)
    .where("eventSlug", "==", eventSlug)
    .limit(1)
    .get();

  return !snapshot.empty;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addComment(
  customerId: string,
  data: {
    targetType: CommentTargetType;
    targetId: string;
    authorName: string;
    body: string;
  }
) {
  if (data.body.length > COMMENT_MAX_LENGTH) {
    return {
      success: false,
      error: `Comment exceeds maximum length of ${COMMENT_MAX_LENGTH} characters`,
    };
  }

  if (data.body.trim().length === 0) {
    return { success: false, error: "Comment body cannot be empty" };
  }

  const db = getAdminFirestore();

  const docRef = await db.collection(COLLECTIONS.comments).add({
    ...data,
    authorId: customerId,
    createdAt: new Date(),
    status: "approved", // Auto-approve for now; can switch to "pending" with moderation
  });

  return { success: true, id: docRef.id };
}

export async function getComments(
  targetType: CommentTargetType,
  targetId: string,
  limit: number = 50
) {
  const db = getAdminFirestore();

  const snapshot = await db
    .collection(COLLECTIONS.comments)
    .where("targetType", "==", targetType)
    .where("targetId", "==", targetId)
    .where("status", "==", "approved")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
  }));
}

/**
 * Fetch a single comment by ID. Returns null if not found.
 * Used by the DELETE route for an explicit BOLA check before calling
 * `deleteComment`.
 */
export async function getCommentById(commentId: string) {
  const db = getAdminFirestore();
  const doc = await db.collection(COLLECTIONS.comments).doc(commentId).get();
  if (!doc.exists) return null;
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    authorId: (data.authorId as string | undefined) ?? null,
    targetType: (data.targetType as string | undefined) ?? null,
    targetId: (data.targetId as string | undefined) ?? null,
  };
}

export async function deleteComment(customerId: string, commentId: string) {
  const db = getAdminFirestore();
  const docRef = db.collection(COLLECTIONS.comments).doc(commentId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return { success: false, error: "Comment not found" };
  }

  // Only allow the author to delete their own comment
  if (doc.data()?.authorId !== customerId) {
    return { success: false, error: "Not authorized to delete this comment" };
  }

  await docRef.delete();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Aggregated user data (for my-page dashboard)
// ---------------------------------------------------------------------------

export async function getUserDashboardData(customerId: string) {
  const [favorites, follows, registrations] = await Promise.all([
    getFavorites(customerId),
    getFollows(customerId),
    getEventRegistrations(customerId),
  ]);

  return {
    favorites,
    follows,
    eventRegistrations: registrations,
  };
}

// ---------------------------------------------------------------------------
// BehaviorLog (behavior event tracking)
// ---------------------------------------------------------------------------

/**
 * Infer persona signal from action and metadata.
 * Lightweight heuristic for initial categorization.
 */
function inferPersonaSignal(
  action: BehaviorAction,
  metadata: BehaviorEventMetadata,
): PersonaType | null {
  // view_content with category hints
  if (action === "view_content") {
    const contentId = metadata.contentId ?? "";
    if (contentId.includes("relax") || contentId.includes("hojicha") || contentId.includes("green")) {
      return "serenity";
    }
    if (contentId.includes("region") || contentId.includes("origin") || contentId.includes("new")) {
      return "explorer";
    }
    if (contentId.includes("flavor") || contentId.includes("pairing") || contentId.includes("taste")) {
      return "sensory";
    }
  }

  // view_product — explorer signal (browsing new products)
  if (action === "view_product") {
    return "explorer";
  }

  // search — explorer signal
  if (action === "search") {
    return "explorer";
  }

  // tap_button — context dependent, no strong signal
  return null;
}

/**
 * Add a behavior event to the user's behaviorLog subcollection.
 *
 * @param customerId Shopify numeric customer ID
 * @param action BehaviorAction type
 * @param channel Channel (web or line)
 * @param metadata Event-specific metadata
 */
export async function addBehaviorLog(
  customerId: string,
  action: BehaviorAction,
  channel: BehaviorChannel,
  metadata: BehaviorEventMetadata,
): Promise<{ success: boolean; id?: string }> {
  const db = getAdminFirestore();
  const colPath = behaviorLogCol(customerId);

  const personaSignal = inferPersonaSignal(action, metadata);

  const docRef = await db.collection(colPath).add({
    action,
    channel,
    metadata,
    personaSignal,
    createdAt: new Date(),
  });

  return { success: true, id: docRef.id };
}

/**
 * Count behavior events in the user's behaviorLog subcollection.
 */
export async function getBehaviorEventCount(customerId: string): Promise<number> {
  const db = getAdminFirestore();
  const colPath = behaviorLogCol(customerId);
  const snapshot = await db.collection(colPath).count().get();
  return snapshot.data().count;
}

// ---------------------------------------------------------------------------
// LINE account linking
// ---------------------------------------------------------------------------

/**
 * 顧客ドキュメントから LINE の写しを外す。
 *
 * ⚠ 対になる**書き込み**はここには無い (2026-08-22 / P10)。写しを書くのは
 *   `lib/auth/identity-link.ts` の `completeLineLinkage` だけで、そこは
 *   **cx-agent の台帳が本人一致を認めたあと**にしか書かない。かつてここにあった
 *   `linkLineUser` は「ブラウザが送ってきた LINE userId をそのまま書く」実装で、
 *   LINE に何も検証させていなかったため、廃止した POST もろとも削除した。
 *
 * 「解除 → 再連携」が成立するために、**フィールドを空文字や null で上書きせず
 * `FieldValue.delete()` で消す**。消し残り (`lineUserId: null` 等) があると、
 * 再連携時に「写しは既にある」と読める余地が残る。フィールドごと消せば、
 * 再連携は必ず「未連携からの新規連携」と同じ状態から始まる。
 *
 * 冪等: 連携が無い状態で呼ばれても失敗させず `not_linked` を返す (解除は
 * 「その状態にする」操作であり、二重解除をエラーにする意味がない)。
 *
 * 削除範囲はこのドキュメントの連携情報のみ。カルテ・注文履歴等のサブコレクションは
 * 触らない (解除 != データ削除。データ削除は GDPR `customers/redact` webhook /
 * cx-agent `/api/erase` の担当)。
 *
 * ⚠ **この戻り値で「解除できたか」を判断しない** (2026-08-22 / P9)。連携の正本は
 *   cx-agent の `customer_linkages` であり、ここはその写し。Web / LIFF から連携した
 *   お客さまには写しが書かれていない期間があり、写しの有無で判定すると「台帳からは
 *   外れたのに not_linked」という嘘になる。呼び出し側 (`DELETE /api/user/line-link`) は
 *   cx-agent の `cleared_count` で判定する。
 *
 * @param customerId Shopify numeric customer ID (サーバ確定値のみを渡すこと)
 * @param expectedLineUserId 任意。指定すると **写しがこの LINE のものであるときだけ**消す。
 *   世帯共有 (1 顧客に複数 LINE) で、家族の写しを取り違えて消さないため。
 */
export async function unlinkLineUser(
  customerId: string,
  expectedLineUserId?: string
): Promise<{ success: boolean; action: "unlinked" | "not_linked" }> {
  const db = getAdminFirestore();
  const docRef = db.doc(userDoc(customerId));

  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return { success: true, action: "not_linked" };
  }

  const existing = snapshot.data()?.lineUserId;
  if (existing === undefined || existing === null) {
    return { success: true, action: "not_linked" };
  }
  if (expectedLineUserId !== undefined && existing !== expectedLineUserId) {
    /* 写しは別の LINE のもの。名指しで解除された LINE とは違うので触らない
       (消すと、まだ連携している家族の写しが消える)。 */
    return { success: true, action: "not_linked" };
  }

  await docRef.update({
    lineUserId: FieldValue.delete(),
    lastActiveAt: new Date(),
  });

  return { success: true, action: "unlinked" };
}

/**
 * Retrieve the LINE user ID linked to a customer (if any).
 */
export async function getLinkedLineUserId(customerId: string): Promise<string | null> {
  const db = getAdminFirestore();
  const docRef = db.doc(userDoc(customerId));
  const snapshot = await docRef.get();
  return snapshot.data()?.lineUserId ?? null;
}

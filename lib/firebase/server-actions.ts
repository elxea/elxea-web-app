/**
 * Server-side Firestore operations using Firebase Admin SDK.
 * These are called from API routes (not directly from client components).
 */
import { FieldValue, type Query } from "firebase-admin/firestore";
import {
  favoriteDocId,
  partitionFavoriteDuplicates,
} from "@/lib/account-favorites";
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

/**
 * お気に入りを 1 件保存する。
 *
 * 書き込み先のドキュメント ID は内容から決まる (`favoriteDocId`)。同じものを
 * 同時に 2 回書いても**同じ 1 ドキュメントを上書きする**だけなので、重複が
 * 生まれる余地が無い。以前の「問い合わせて無ければ `add()`」は、その 2 手の
 * あいだに割り込まれると 2 件できる形だった (F16 の原因)。
 *
 * 問い合わせ自体は残す。ID が自動採番だった時代に書かれた既存のドキュメントは
 * 内容でしか見つけられず、それを見ずに新しい ID で書くと**古い 1 件 + 新しい
 * 1 件**でかえって増えるため。
 */
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

  const docId = favoriteDocId(data.type, data.targetId);

  // 旧採番 (自動 ID) で既に入っていないか。内容でしか照合できない。
  const existing = await db
    .collection(colPath)
    .where("type", "==", data.type)
    .where("targetId", "==", data.targetId)
    .get();

  if (!existing.empty) {
    /* 既にある。ここで**新しい規則の ID へ移しておく** (QA 指摘 3)。
     *
     * 以前はそのまま `already_exists` を返していたので、旧 ID のドキュメントは
     * 何度保存し直しても旧 ID のまま残った。読み出し側 (`getFavorites`) の
     * 片付けが効くのは**重複しているとき**だけなので、旧 ID が 1 件だけの棚は
     * 永久に旧採番のままで、`doc(favoriteDocId(...)).set()` を前提にした
     * 「同じものは同じ 1 件に上書きされる」保証 (F16) の外に居続ける。
     *
     * 移すのは「既に新しい ID のものが無い」ときだけ。あるならそれが本命で、
     * 旧 ID のほうは重複なので消せばよい — どちらの道でも棚には新しい ID の
     * 1 件だけが残る。保存日 (`createdAt`) は最初の 1 件のものを引き継ぐ
     * (利用者に見える情報なので、移動で今日に化けさせない)。
     */
    const canonical = existing.docs.find((doc) => doc.id === docId);
    const legacy = existing.docs.filter((doc) => doc.id !== docId);

    if (legacy.length > 0) {
      try {
        if (!canonical) {
          const oldest = legacy.reduce((a, b) =>
            (a.createTime?.toMillis() ?? 0) <= (b.createTime?.toMillis() ?? 0) ? a : b,
          );
          await db
            .collection(colPath)
            .doc(docId)
            .set({ ...oldest.data(), ...data });
        }
        /* 消すのは新しい ID への着地が済んだあとだけ (順序を崩さない)。 */
        for (const doc of legacy) await doc.ref.delete();
      } catch (err) {
        /* 移せなくても「保存済み」であることは変わらない。読み出し側の片付けが
           次に拾うので、ここで利用者に失敗を見せる理由は無い。 */
        console.error("[favorites] legacy id migration failed:", err);
      }
    }

    return { success: true, action: "already_exists" as const, id: docId };
  }

  await db
    .collection(colPath)
    .doc(docId)
    .set({ ...data, createdAt: new Date() });

  return { success: true, action: "created" as const, id: docId };
}

/**
 * お気に入りを解除する。**一致するものは全部消す**。
 *
 * 1 件だけ消していたころは、棚に重複が残っていると解除しても片割れが残り、
 * 画面を開き直すと「消したはずのものが戻ってくる」ように見えた。解除の意思は
 * 「この記事を保存しない」であって「このドキュメントを 1 つ消す」ではない。
 */
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
    .get();

  if (snapshot.empty) {
    return { success: true, action: "not_found" as const };
  }

  for (const doc of snapshot.docs) {
    await doc.ref.delete();
  }
  return { success: true, action: "removed" as const, removed: snapshot.docs.length };
}

/**
 * お気に入りの一覧。**読むついでに棚の重複を片付ける**。
 *
 * 書き込み側を一意キーに直しても、それ以前に作られた重複は棚に残ったままで、
 * 放っておくと利用者にはいつまでも 2 件に見える。持ち主が自分のマイページを
 * 開いた瞬間に、その人の棚だけを直す。件数が極小 (数十件) なので読み出しへの
 * 影響は無視でき、重複が無ければ書き込みは 1 件も起きない。
 *
 * 片付けに失敗しても読み出しは成功させる (画面は `partitionFavoriteDuplicates`
 * が返した「残す側」だけを見るので、棚が直らなくても 2 件には見えない)。
 */
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
  /* `id` は**展開のあと**に置く。先に置くと、保存されている中身がたまたま `id`
     という項目を持っていたときにドキュメント ID が上書きされ、重複の片付け
     (`partitionFavoriteDuplicates` → `doc(id).delete()`) が**別のドキュメントを
     指す**。中身は利用者の入力を含むので、そうなり得ないとは言えない。 */
  const rows = snapshot.docs.map((doc) => ({
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
    id: doc.id,
  }));

  const { kept, duplicates } = partitionFavoriteDuplicates(rows);

  if (duplicates.length > 0) {
    try {
      for (const duplicate of duplicates) {
        await db.collection(colPath).doc(duplicate.id).delete();
      }
      console.warn(
        `[favorites] removed ${duplicates.length} duplicate document(s) while reading a favorites shelf`,
      );
    } catch (err) {
      console.error("[favorites] duplicate cleanup failed:", err);
    }
  }

  return kept;
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

  /* `id` は展開のあと (中身の `id` にドキュメント ID を奪わせない)。 */
  return snapshot.docs.map((doc) => ({
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
    id: doc.id,
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

  /* `id` は展開のあと (中身の `id` にドキュメント ID を奪わせない)。 */
  return snapshot.docs.map((doc) => ({
    ...doc.data(),
    registeredAt: doc.data().registeredAt?.toDate?.()?.toISOString() ?? null,
    id: doc.id,
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

  /* `id` は展開のあと。コメントの中身は利用者が書いた JSON なので、`id` という
     項目が混じったときにドキュメント ID を奪われると、削除の宛先がずれる。 */
  return snapshot.docs.map((doc) => ({
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
    id: doc.id,
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

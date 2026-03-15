/**
 * Server-side Firestore operations using Firebase Admin SDK.
 * These are called from API routes (not directly from client components).
 */
import type { Query } from "firebase-admin/firestore";
import { getAdminFirestore } from "./admin";
import { COLLECTIONS, favoritesCol, followsCol, eventRegistrationsCol } from "./collections";
import type {
  FavoriteType,
  CommentTargetType,
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

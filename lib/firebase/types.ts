/**
 * Firestore document types for user interaction features.
 *
 * Collection structure:
 *   users/{shopifyCustomerId}/favorites/{docId}
 *   users/{shopifyCustomerId}/follows/{docId}
 *   users/{shopifyCustomerId}/eventRegistrations/{docId}
 *   comments/{docId}  (top-level, queryable across all users)
 *
 * User identification: Shopify Customer GID (e.g. "gid://shopify/Customer/12345")
 * We use the numeric portion as the document path for cleaner URLs.
 */

import type { Timestamp } from "firebase/firestore";

// ---------------------------------------------------------------------------
// Favorites (products & articles)
// ---------------------------------------------------------------------------

export type FavoriteType = "product" | "article";

export type Favorite = {
  /** "product" or "article" */
  type: FavoriteType;
  /** Shopify product handle (products) or Sanity article slug (articles) */
  targetId: string;
  /** Human-readable title for display in my-page without re-fetching */
  title: string;
  /** Thumbnail URL for quick display */
  imageUrl: string | null;
  createdAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Farmer follows
// ---------------------------------------------------------------------------

export type FarmerFollow = {
  /** Sanity farmer slug */
  farmerSlug: string;
  /** Display name */
  farmerName: string;
  /** Profile image URL */
  farmerImageUrl: string | null;
  createdAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Event registrations
// ---------------------------------------------------------------------------

export type EventRegistration = {
  /** Sanity event slug */
  eventSlug: string;
  /** Event title for display */
  eventTitle: string;
  /** Event date (ISO string) */
  eventDate: string | null;
  /** Event image URL */
  eventImageUrl: string | null;
  registeredAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Comments / encouragement messages
// ---------------------------------------------------------------------------

export type CommentTargetType = "article" | "farmer";

export type Comment = {
  /** "article" or "farmer" */
  targetType: CommentTargetType;
  /** Sanity slug of the target */
  targetId: string;
  /** Shopify customer ID (numeric portion) */
  authorId: string;
  /** Display name of the commenter */
  authorName: string;
  /** Comment text (max 500 chars enforced at API level) */
  body: string;
  createdAt: Timestamp;
  /** Moderation status */
  status: "pending" | "approved" | "rejected";
};

// ---------------------------------------------------------------------------
// Helper: Extract numeric ID from Shopify GID
// ---------------------------------------------------------------------------

/**
 * Extract the numeric customer ID from a Shopify GID.
 * e.g. "gid://shopify/Customer/7654321" -> "7654321"
 */
export function extractCustomerId(shopifyGid: string): string {
  const match = shopifyGid.match(/(\d+)$/);
  return match ? match[1] : shopifyGid;
}

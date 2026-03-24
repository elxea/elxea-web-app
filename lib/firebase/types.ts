/**
 * Firestore document types for user interaction features.
 *
 * Collection structure:
 *   users/{shopifyCustomerId}                      — customer master document
 *   users/{shopifyCustomerId}/favorites/{docId}    — product / article favorites
 *   users/{shopifyCustomerId}/follows/{docId}      — farmer follows
 *   users/{shopifyCustomerId}/eventRegistrations/{docId}
 *   users/{shopifyCustomerId}/behaviorLog/{docId}  — cross-channel behavior events (NEW)
 *   users/{shopifyCustomerId}/conversations/{docId} — LINE chat history (NEW)
 *   users/{shopifyCustomerId}/orders/{orderId}     — Shopify order mirror (NEW)
 *   comments/{docId}  (top-level, queryable across all users)
 *
 * User identification: Shopify Customer GID (e.g. "gid://shopify/Customer/12345")
 * We use the numeric portion as the document path for cleaner URLs.
 *
 * Design notes:
 *   - persona / tasteProfile are written by server-side agents only (Firestore rules enforce this)
 *   - clients may read their own persona / tasteProfile
 *   - All new top-level fields are optional to preserve backward compatibility
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
// Persona & customer profile (new — shared by elxea-agent and elxea-webapp)
// ---------------------------------------------------------------------------

export type PersonaType = "serenity" | "explorer" | "sensory";
export type DepthLevel = "entry" | "explore" | "deep";
export type MembershipTier = "none" | "standard" | "premium";
export type OnboardingInitialAction = "view_tea" | "about" | "none";

/** Persona scores (0–100 each) inferred from behavior logs */
export type PersonaScores = {
  serenity: number;
  explorer: number;
  sensory: number;
};

export type PersonaProfile = {
  /** Highest-scoring persona. null when not enough data */
  primary: PersonaType | null;
  scores: PersonaScores;
  /** When the persona was last recalculated */
  lastUpdated: Timestamp;
};

export type TasteProfile = {
  /** Tea category slugs the customer prefers (e.g. "oolong", "green") */
  preferredCategories: string[];
  /** Flavor descriptors (e.g. "floral", "light") */
  flavorPreferences: string[];
  /** Preferred consumption scene (e.g. "evening") */
  scenePref: string | null;
};

export type OnboardingState = {
  completedAt: Timestamp | null;
  initialAction: OnboardingInitialAction | null;
  twoWeekQuestionAnswered: boolean;
  twoWeekAnswer: string | null;
};

/**
 * Top-level user document stored at users/{shopifyCustomerId}.
 * All fields are optional to maintain backward compatibility with existing
 * documents that were created before this schema was introduced.
 */
export type UserProfile = {
  lineUserId?: string | null;
  email?: string;
  displayName?: string;
  membershipTier?: MembershipTier;
  persona?: PersonaProfile;
  depthLevel?: DepthLevel;
  tasteProfile?: TasteProfile;
  onboarding?: OnboardingState;
  createdAt?: Timestamp;
  lastActiveAt?: Timestamp;
};

// ---------------------------------------------------------------------------
// BehaviorLog subcollection (new)
// users/{shopifyCustomerId}/behaviorLog/{docId}
// ---------------------------------------------------------------------------

export type BehaviorAction =
  | "tap_button"
  | "view_content"
  | "view_product"
  | "purchase"
  | "line_message"
  | "search"
  | "tea_mention"
  | "flavor_preference"
  | "topic_interest";

export type BehaviorChannel = "line" | "web";

export type BehaviorEventMetadata = {
  contentId?: string;
  productId?: string;
  query?: string;
  buttonLabel?: string;
  /** Reading duration in seconds (set by behavior-tracker for view_content) */
  durationSeconds?: number;
  /** Product tags from Shopify (set by order webhook for purchase events) */
  productTags?: string[];
  /** Product category from Shopify (set by order webhook for purchase events) */
  productCategory?: string;
};

export type BehaviorEvent = {
  action: BehaviorAction;
  channel: BehaviorChannel;
  metadata: BehaviorEventMetadata;
  /** Persona signal inferred from this event. null when ambiguous. */
  personaSignal: PersonaType | null;
  createdAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Conversations subcollection (new — migrated from Supabase)
// users/{shopifyCustomerId}/conversations/{docId}
// ---------------------------------------------------------------------------

export type ConversationRole = "user" | "assistant";

export type Conversation = {
  role: ConversationRole;
  content: string;
  createdAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Orders subcollection (new — mirrored from Shopify via Webhook)
// users/{shopifyCustomerId}/orders/{orderId}
// ---------------------------------------------------------------------------

export type OrderItem = {
  title: string;
  quantity: number;
  variantId: string;
};

export type OrderMirror = {
  orderNumber: string;
  items: OrderItem[];
  totalPrice: string;
  createdAt: Timestamp;
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

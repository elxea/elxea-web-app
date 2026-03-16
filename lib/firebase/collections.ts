/**
 * Firestore collection path constants.
 * Centralizes all collection references to avoid typos and enable easy refactoring.
 */

export const COLLECTIONS = {
  /** Top-level users collection */
  users: "users",
  /** Subcollection under users/{userId} — product / article favorites */
  favorites: "favorites",
  /** Subcollection under users/{userId} — farmer follows */
  follows: "follows",
  /** Subcollection under users/{userId} — event registrations */
  eventRegistrations: "eventRegistrations",
  /** Subcollection under users/{userId} — cross-channel behavior events (NEW) */
  behaviorLog: "behaviorLog",
  /** Subcollection under users/{userId} — LINE conversation history (NEW) */
  conversations: "conversations",
  /** Subcollection under users/{userId} — Shopify order mirror (NEW) */
  orders: "orders",
  /** Top-level comments collection */
  comments: "comments",
} as const;

/**
 * Build Firestore path helpers.
 */
export function userDoc(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}`;
}

export function favoritesCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.favorites}`;
}

export function followsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.follows}`;
}

export function eventRegistrationsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.eventRegistrations}`;
}

export function behaviorLogCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.behaviorLog}`;
}

export function conversationsCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.conversations}`;
}

export function ordersCol(customerId: string) {
  return `${COLLECTIONS.users}/${customerId}/${COLLECTIONS.orders}`;
}

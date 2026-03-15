/**
 * Firestore collection path constants.
 * Centralizes all collection references to avoid typos and enable easy refactoring.
 */

export const COLLECTIONS = {
  /** Top-level users collection */
  users: "users",
  /** Subcollection under users/{userId} */
  favorites: "favorites",
  /** Subcollection under users/{userId} */
  follows: "follows",
  /** Subcollection under users/{userId} */
  eventRegistrations: "eventRegistrations",
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

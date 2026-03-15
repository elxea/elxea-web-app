/**
 * Firebase Admin SDK configuration.
 * Used in API routes and Server Actions for privileged Firestore operations.
 *
 * Environment variables (server-only, no NEXT_PUBLIC_ prefix):
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (base64-encoded or raw PEM)
 */
import {
  initializeApp,
  getApps,
  cert,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.includes("\\n")
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : process.env.FIREBASE_PRIVATE_KEY;

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

let _adminDb: Firestore | null = null;

/**
 * Get the server-side Firestore Admin instance (singleton).
 * Only use in API routes, Server Actions, and server-only modules.
 */
export function getAdminFirestore(): Firestore {
  if (!_adminDb) {
    const app = getAdminApp();
    _adminDb = getFirestore(app);
  }
  return _adminDb;
}

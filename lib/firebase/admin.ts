/**
 * Firebase Admin SDK configuration.
 * Used in API routes and Server Actions for privileged Firestore operations.
 *
 * Environment variables (server-only, no NEXT_PUBLIC_ prefix):
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (escaped \n or base64-encoded PEM)
 */
import {
  initializeApp,
  getApps,
  cert,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Decode FIREBASE_PRIVATE_KEY from various storage formats:
 * 1. Base64-encoded PEM (recommended for Vercel)
 * 2. Escaped newlines (\\n → \n)
 * 3. Raw PEM with literal newlines (used as-is)
 */
export function decodePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Base64-encoded: starts with base64 chars, not "-----"
  if (!raw.startsWith("-----") && !raw.startsWith('"')) {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) {
        return decoded;
      }
    } catch {
      // Not valid base64, fall through
    }
  }

  // Escaped newlines (\\n stored as literal backslash-n)
  if (raw.includes("\\n")) {
    return raw.replace(/\\n/g, "\n");
  }

  // Already has literal newlines or no newlines needed
  return raw;
}

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase Admin SDK: missing required env vars. ` +
        `projectId=${!!projectId}, clientEmail=${!!clientEmail}, privateKey=${!!privateKey}`
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
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

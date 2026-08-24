/**
 * Firebase Client SDK configuration.
 * Used in client components for real-time Firestore operations.
 *
 * Environment variables (NEXT_PUBLIC_ prefix for client-side access):
 * - NEXT_PUBLIC_FIREBASE_API_KEY
 * - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 * - NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * - NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * - NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 * - NEXT_PUBLIC_FIREBASE_APP_ID
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

import { resolveClientFirestoreTarget, splitEmulatorHost } from "./firestore-target";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(firebaseConfig);
}

let _db: Firestore | null = null;

/**
 * Get the client-side Firestore instance (singleton).
 * Safe to call multiple times; the app is only initialized once.
 */
export function getClientFirestore(): Firestore {
  if (!_db) {
    /* サーバー側と同じ約束をブラウザ側にも敷く: 手元では既定で本番へ繋がない。
       判定の順番と理由は lib/firebase/firestore-target.ts に 1 か所だけ書いてある。
       本番ビルドでは NODE_ENV が "production" に畳まれるため、ここは常に
       { kind: "production" } を返す枝になる（= 挙動は従来どおり）。 */
    const target = resolveClientFirestoreTarget();

    const app = getFirebaseApp();
    const db = getFirestore(app);

    if (target.kind === "emulator") {
      const { host, port } = splitEmulatorHost(target.host);
      connectFirestoreEmulator(db, host, port);
    }

    _db = db;
  }
  return _db;
}

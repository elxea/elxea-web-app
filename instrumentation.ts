import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    await installE2eFirestoreIfRequested();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * E2E（Ring 2）のときだけ、プロセス内の偽 Firestore を差し込む。
 *
 * `register()` はリクエストを受け付ける前に 1 回だけ走ることが Next の契約なので、
 * 最初の route handler が `getAdminFirestore()` を呼ぶ時点では必ず差し込みが済んでいる。
 *
 * 3 重に閉じている:
 *   1. `E2E_FIRESTORE_STUB === "1"` … 既定では何もしない
 *   2. `NODE_ENV !== "production"` … ここでも見る（`setInjectedFirestoreForE2E` 側でも throw する）
 *   3. 偽物の import は **この分岐の中の動的 import** … 通常起動では読み込まれない
 *
 * 理由と安全性の議論は `lib/firebase/admin.ts` の差し込み口のコメントに置いてある
 * （二重に書かない）。
 */
async function installE2eFirestoreIfRequested(): Promise<void> {
  if (process.env.E2E_FIRESTORE_STUB !== "1") return;
  if (process.env.NODE_ENV === "production") return;

  const [{ createFakeFirestore }, { setInjectedFirestoreForE2E }] = await Promise.all([
    import("./__tests__/helpers/fake-firestore"),
    import("./lib/firebase/admin"),
  ]);

  setInjectedFirestoreForE2E(createFakeFirestore().db);
  console.warn(
    "[instrumentation] E2E_FIRESTORE_STUB=1 — in-memory Firestore installed. " +
      "No real Firestore is reachable from this process.",
  );
}

export const onRequestError = Sentry.captureRequestError;

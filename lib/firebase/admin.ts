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

import { env, isProduction } from "@/lib/config";
import { logger } from "@/lib/log";

import { resolveServerFirestoreTarget } from "./firestore-target";

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
    } catch (err) {
      /* 次の形式で読み直すので処理は続けるが、鍵が読めない状態は誰もログイン
         できない状態に直結するので、黙って落とさない。 */
      logger.error("firebase.admin.private-key-decode-failed", err, {
        operation: "decodePrivateKey",
        format: "base64",
      });
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
  /* 既に app が在っても、判定より先には返さない。
     「app が在れば即返す」を先頭に置くと、誰かが先に app を作った瞬間に
     下の fail-closed 判定が丸ごと飛ぶ。守りが「初期化されたのが自分が最初か」
     という順番次第になるのは、守りとして成立していない。判定は毎回通す。 */
  const existingApp = getApps().length > 0 ? getApps()[0] : null;

  /* エミュレーターが立っているなら、本物の資格情報を読む前に分岐する。
     エミュレーターは資格情報を要求しないので、ここで先に返さないと
     「手元で開発したいだけなのに本番の鍵が要る」という妙な依存が残る。
     Admin SDK は FIRESTORE_EMULATOR_HOST が立っていれば Firestore の通信先を
     そこへ固定するので、この app から本番へ出て行く経路は無い。 */
  if (env("FIRESTORE_EMULATOR_HOST")) {
    const target = resolveServerFirestoreTarget();
    if (target.kind === "emulator") {
      if (existingApp) return existingApp;
      console.warn(
        `[firebase/admin] FIRESTORE_EMULATOR_HOST=${target.host} — ` +
          `エミュレーターに接続します（project=${target.projectId}）。本番 Firestore には触れません。`,
      );
      return initializeApp({ projectId: target.projectId });
    }
  }

  const projectId = env("FIREBASE_PROJECT_ID");
  const clientEmail = env("FIREBASE_CLIENT_EMAIL");
  /* `FIREBASE_PRIVATE_KEY` は spec.ts で `raw` 宣言。PEM の改行が書式そのものなので
     trim せず byte 単位で渡し、デコードは従来どおり decodePrivateKey が一手に持つ。 */
  const privateKey = decodePrivateKey(env("FIREBASE_PRIVATE_KEY"));

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase Admin SDK: missing required env vars. ` +
        `projectId=${!!projectId}, clientEmail=${!!clientEmail}, privateKey=${!!privateKey}`
    );
  }

  /* ここまで来たということは「本番の資格情報が揃っている」。本番ランタイム
     （NODE_ENV=production / Vercel）ならそのまま通す＝従来と同じ。手元なら止める。
     資格情報の有無を見るより後に置いているのは、資格情報が無いときの文言を
     変えないため（lib/journal/popular-articles.ts がその文言で "未設定" を判定している）。 */
  resolveServerFirestoreTarget();

  if (existingApp) return existingApp;

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
 * E2E 用の差し込み口（本番では絶対に埋まらない）。
 *
 * ## なぜ必要か
 *
 * 「LINE ログイン → お気に入り → メールで連携 → 合体して見える」という受入シナリオは、
 * 途中で必ず Firestore に読み書きする。E2E は **別プロセスで動く dev サーバー**に対して
 * 回すので、単体テストのように `vi.mock("@/lib/firebase/admin")` では差し替えられない。
 * かといって本物の Firestore に向けたら「本番 DB に触らない」という前提が壊れ、資格情報を
 * CI に置くことにもなる。エミュレーターは Java と 60MB 超のダウンロードを CI の実行経路に
 * 持ち込む（＝ネットワーク起因の flaky を新しく作る）。
 *
 * よって「テスト用の env が立っているときだけ、プロセス内の偽 Firestore を使う」。偽物は
 * 単体テストと同じ 1 つ（`__tests__/helpers/fake-firestore.ts`）で、差し込みは
 * `instrumentation.ts` が起動時に 1 回だけ行う。
 *
 * ## なぜモジュール変数ではなく globalThis か
 *
 * Next の dev ビルドではルートごとにバンドルが分かれ、`instrumentation.ts` と route handler が
 * **同じモジュール実体を共有するとは限らない**。モジュール変数に置くと「差し込んだのに
 * route からは見えない」が起こる。プロセスに 1 つだけ在る `globalThis` に置くのが、Next で
 * dev シングルトンを持つときの定石。
 *
 * ## 裏口ではない
 *
 * 差し込みは `setInjectedFirestoreForE2E()` を通してしか行えず、`NODE_ENV=production` では
 * throw する。ヘッダー・クエリ・cookie といった **外部入力からは到達できない**
 * （同一プロセスでコードを動かせる者だけが呼べる）ので、権限昇格の経路にはならない。
 */
const E2E_FIRESTORE_GLOBAL = "__elxeaE2eFirestore";

type E2eFirestoreGlobal = typeof globalThis & {
  [E2E_FIRESTORE_GLOBAL]?: Firestore;
};

export function setInjectedFirestoreForE2E(db: Firestore): void {
  if (isProduction()) {
    throw new Error(
      "setInjectedFirestoreForE2E must never run in production. " +
        "The in-memory Firestore is a test double; using it in production would " +
        "silently discard every write.",
    );
  }
  (globalThis as E2eFirestoreGlobal)[E2E_FIRESTORE_GLOBAL] = db;
}

/** 差し込みが入っているか（テストからの確認用）。 */
export function hasInjectedFirestoreForE2E(): boolean {
  return Boolean((globalThis as E2eFirestoreGlobal)[E2E_FIRESTORE_GLOBAL]);
}

/**
 * Get the server-side Firestore Admin instance (singleton).
 * Only use in API routes, Server Actions, and server-only modules.
 */
export function getAdminFirestore(): Firestore {
  const injected = (globalThis as E2eFirestoreGlobal)[E2E_FIRESTORE_GLOBAL];
  if (injected) return injected;

  if (!_adminDb) {
    const app = getAdminApp();
    _adminDb = getFirestore(app);
  }
  return _adminDb;
}

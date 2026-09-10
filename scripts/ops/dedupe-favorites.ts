/**
 * 一度きりの是正: お気に入りの棚に残っている**同じものの 2 件目以降**を片付ける。
 *
 * ## なぜ要るのか (F16)
 *
 * 重複が生まれる形そのものは実装側で塞いだ (`lib/account-favorites.ts` の
 * `favoriteDocId` — ドキュメント ID を内容から決めるので、同時に書いても同じ
 * 1 件を上書きする)。ただし塞ぐ前に作られた重複は棚に残ったままで、放っておくと
 * 本人のマイページには同じ記事・同じ人がいつまでも 2 件並ぶ。
 *
 * 読み出し (`getFavorites`) にも自動修復を入れてあるので、**本人がマイページを
 * 開けばその人の棚は直る**。それでも本スクリプトを置くのは、開かない人の棚が
 * いつ直るか分からない状態を残さないため。ここで一度、全員分を先に片付ける。
 *
 * ## 何をするか
 *
 * 判定は `partitionFavoriteDuplicates` をそのまま呼ぶ。ここで別実装を起こすと
 * 「どれを残すか」の定義が 2 つに割れる (残すのは、内容から決まる ID を持つ 1 件
 * → 無ければいちばん古い 1 件)。本ファイルにあるのは棚の列挙と削除だけ。
 *
 * ## 安全性
 *
 * - 既定は下見。`--apply` を明示しない限り 1 バイトも書かない
 * - 消すのは「同じ (種類, 対象) の 2 件目以降」だけ。種類か対象が読めない行は
 *   どの組にも入れず必ず残す (判定できないものを消さない)
 * - 冪等。2 回流しても 2 回目は 0 件
 * - 出力に個人情報を出さない (利用者 ID は伏せ字・対象は slug・件数のみ)
 *
 * ## 使い方
 *
 *   npx tsx scripts/ops/dedupe-favorites.ts            # 下見 (既定)
 *   npx tsx scripts/ops/dedupe-favorites.ts --apply    # 実行
 *
 * 必要な環境変数 (`.env.local` から読む):
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 */
import { config } from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

config({ path: ".env.local" });
config({ path: ".env" });

/** ログに出す用の伏せ字 (識別子の生値を出さない)。 */
function mask(value: string): string {
  return value.startsWith("line:")
    ? `line:${value.slice(5, 8)}…`
    : `${value.slice(0, 3)}…`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** `lib/firebase/admin.ts` と同じ復号 (base64 / エスケープ改行 / 生 PEM)。 */
function decodePrivateKey(raw: string): string {
  if (!raw.startsWith("-----") && !raw.startsWith('"')) {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) return decoded;
    } catch {
      // base64 ではなかった。下のエスケープ改行として扱う。
    }
  }
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function initFirestore(): Firestore {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: requireEnv("FIREBASE_PROJECT_ID"),
        clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
        privateKey: decodePrivateKey(requireEnv("FIREBASE_PRIVATE_KEY")),
      }),
    });
  }
  return getFirestore();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { partitionFavoriteDuplicates } = await import(
    "@/lib/account-favorites"
  );

  const db = initFirestore();
  const users = await db.collection("users").listDocuments();

  console.log(
    `[dedupe-favorites] ${apply ? "APPLY" : "DRY-RUN"} — users=${users.length}`,
  );

  let shelvesWithDuplicates = 0;
  let duplicatesFound = 0;
  let duplicatesRemoved = 0;

  for (const userRef of users) {
    const snapshot = await userRef.collection("favorites").get();
    if (snapshot.empty) continue;

    const rows = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        type: data.type,
        targetId: data.targetId,
        createdAt:
          data.createdAt?.toDate?.()?.toISOString() ??
          (typeof data.createdAt === "string" ? data.createdAt : null),
      };
    });

    const { duplicates } = partitionFavoriteDuplicates(rows);
    if (duplicates.length === 0) continue;

    shelvesWithDuplicates += 1;
    duplicatesFound += duplicates.length;

    console.log(
      `  user=${mask(userRef.id)} docs=${snapshot.size} duplicates=${duplicates.length}`,
    );
    for (const duplicate of duplicates) {
      console.log(
        `    ${apply ? "delete" : "would delete"} type=${String(duplicate.type)} target=${String(duplicate.targetId)} id=${duplicate.id}`,
      );
      if (apply) {
        await userRef.collection("favorites").doc(duplicate.id).delete();
        duplicatesRemoved += 1;
      }
    }
  }

  console.log(
    `[dedupe-favorites] shelves=${shelvesWithDuplicates} found=${duplicatesFound} removed=${duplicatesRemoved}` +
      (apply ? "" : " (dry-run — nothing was written)"),
  );
}

main().catch((err) => {
  console.error("[dedupe-favorites] failed:", err);
  process.exitCode = 1;
});

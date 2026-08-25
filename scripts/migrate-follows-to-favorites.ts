/**
 * `follows` (フォロー中の農家) を `favorites` の 4 分類目 (`type: "farmer"`) へ移す。
 *
 * ## なぜ移すのか
 *
 * 農家だけが「フォローする」という**別の動詞・別のコレクション**で保存されていた。
 * 利用者から見ると「お気に入りの人」と「フォロー中の農家」が並び、内部の都合
 * (別コレクション・別 Sanity 型) がそのまま画面に露出していた。しかも農家を
 * フォローする入口が失われていたので、節だけが残って中身が増えない状態だった。
 * お気に入り 4 分類 (商品 / 読みもの / 人 / 農家) へ一本化する (J-5 決裁)。
 *
 * ## 使い方
 *
 *   # 何が起きるかだけ見る (書き込まない)
 *   npx tsx scripts/migrate-follows-to-favorites.ts --dry-run
 *
 *   # 実行する
 *   npx tsx scripts/migrate-follows-to-favorites.ts --apply
 *
 * `--apply` を付けない限り**絶対に書かない**。既定は dry-run。
 *
 * ## 安全のための約束
 *
 * - **冪等**。同じ農家が既に `favorites` にあれば作らない。何度流しても結果は同じ
 * - **元を消さない**。`follows` の行はそのまま残す (G2: copy → verify → delete の
 *   delete は別の判断。読む画面が無くなった時点で害は無く、取り消しの余地を残す)
 * - **推測しない**。`farmerSlug` / `farmerName` が欠けた行は移さず、理由付きで数える
 * - 読み書きは Firebase Admin SDK (既存の `lib/firebase/admin.ts` と同じ資格情報)
 *
 * ## 出力
 *
 * 1 行 1 件の進捗と、最後に集計 (対象ユーザー数 / 移した件数 / 既にあった件数 /
 * 移せなかった件数)。実行ログはそのまま EVIDENCE として残す。
 */
import { getAdminFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS, favoritesCol, followsCol } from "@/lib/firebase/collections";

type Counts = {
  users: number;
  migrated: number;
  alreadyPresent: number;
  skipped: number;
};

type SkipReason = "no-slug" | "no-name";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  console.log(
    dryRun
      ? "[migrate-follows] DRY RUN — 1 件も書き込みません (--apply で実行)"
      : "[migrate-follows] APPLY — Firestore に書き込みます",
  );

  const db = getAdminFirestore();
  const counts: Counts = { users: 0, migrated: 0, alreadyPresent: 0, skipped: 0 };
  const skips: Array<{ userKey: string; docId: string; reason: SkipReason }> = [];

  /* `users` の直下を舐める。`follows` はサブコレクションなので、
     collectionGroup で一気に引くと親 (= どの人の棚か) が分からなくなる。 */
  const users = await db.collection(COLLECTIONS.users).listDocuments();

  for (const userRef of users) {
    const userKey = userRef.id;
    const followsSnap = await db.collection(followsCol(userKey)).get();
    if (followsSnap.empty) continue;

    counts.users += 1;

    for (const doc of followsSnap.docs) {
      const data = doc.data() as {
        farmerSlug?: unknown;
        farmerName?: unknown;
        farmerImageUrl?: unknown;
        createdAt?: { toDate?: () => Date };
      };

      const slug = typeof data.farmerSlug === "string" ? data.farmerSlug.trim() : "";
      const name = typeof data.farmerName === "string" ? data.farmerName.trim() : "";

      if (!slug) {
        counts.skipped += 1;
        skips.push({ userKey, docId: doc.id, reason: "no-slug" });
        continue;
      }
      if (!name) {
        /* 見出しが無いと画面に出せない (`normalizeFavorites` が落とす)。
           農家名を Sanity から引き直すことはしない — 移行スクリプトが外部の
           現在値で過去の記録を補うと、履歴が静かに書き換わる。 */
        counts.skipped += 1;
        skips.push({ userKey, docId: doc.id, reason: "no-name" });
        continue;
      }

      /* 冪等性の要。同じ (type, targetId) が既にあれば作らない。
         API 側の `addFavorite` と同じ判定条件を使う。 */
      const existing = await db
        .collection(favoritesCol(userKey))
        .where("type", "==", "farmer")
        .where("targetId", "==", slug)
        .limit(1)
        .get();

      if (!existing.empty) {
        counts.alreadyPresent += 1;
        console.log(`[skip] ${userKey} farmer:${slug} — 既にお気に入りにある`);
        continue;
      }

      const payload = {
        type: "farmer" as const,
        targetId: slug,
        title: name,
        imageUrl:
          typeof data.farmerImageUrl === "string" && data.farmerImageUrl
            ? data.farmerImageUrl
            : null,
        /* 保存した日は引き継ぐ。移行日に揃えると「並びが全部今日になる」ので、
           お客さまの体感では一覧が作り直されたように見える。 */
        createdAt: data.createdAt?.toDate?.() ?? new Date(),
      };

      if (dryRun) {
        counts.migrated += 1;
        console.log(`[would-migrate] ${userKey} farmer:${slug} (${name})`);
        continue;
      }

      await db.collection(favoritesCol(userKey)).add(payload);
      counts.migrated += 1;
      console.log(`[migrated] ${userKey} farmer:${slug} (${name})`);
    }
  }

  console.log("");
  console.log("[migrate-follows] 集計");
  console.log(`  フォローを持っていた人   : ${counts.users}`);
  console.log(`  移した件数               : ${counts.migrated}${dryRun ? " (予定)" : ""}`);
  console.log(`  既にお気に入りにあった件数: ${counts.alreadyPresent}`);
  console.log(`  移せなかった件数         : ${counts.skipped}`);

  if (skips.length > 0) {
    console.log("");
    console.log("[migrate-follows] 移せなかった行 (推測で埋めない)");
    for (const skip of skips) {
      console.log(`  ${skip.userKey}/${skip.docId} — ${skip.reason}`);
    }
  }

  if (dryRun) {
    console.log("");
    console.log("[migrate-follows] DRY RUN のため 1 件も書き込んでいません。");
  }
}

main().catch((err) => {
  console.error("[migrate-follows] 失敗:", err);
  process.exitCode = 1;
});

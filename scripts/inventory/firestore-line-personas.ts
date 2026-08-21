/**
 * 現状棚卸し (1-1): Firestore の `line:` 人格を数える。read-only。
 *
 * ## 何のための数字か
 *
 * 確定設計書 v1.2 §0-2 の移行設計は「移行窓を何日にするか」を **実測してから決める**と
 * している。その入力がこれ: LINE ログインだけで作られた人格が何人分あり、そのうち
 * どれだけが最近も動いているか。全員が休眠なら移行窓は短くてよいし、直近 30 日に
 * まとまった人数がいるなら窓はその周期を跨ぐ必要がある。
 *
 * ## 出すもの・出さないもの
 *
 * 出すのは **集計値だけ**。userId・メール・表示名などの生値は一切出力しない
 * (レポートは Notion に載るため)。人格ごとの最終アクティビティは日数バケットに畳んで
 * 個人を特定できない形にする。
 *
 * ## 安全性
 *
 * 読み取り専用。書き込み API (`set` / `update` / `delete`) を一切呼ばない。
 * Firestore の本番プロジェクトに対して実行する前提で、対象プロジェクト ID を
 * 標準出力に明示してから走る (どこを数えたか分からない数字は使えない)。
 *
 * ## 使い方
 *
 *   cd elxea-web-app
 *   set -a && . .env.local && set +a
 *   npx tsx scripts/inventory/firestore-line-personas.ts            # 人間向け
 *   npx tsx scripts/inventory/firestore-line-personas.ts --json     # 機械向け
 *
 * 必要な env: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { decodePrivateKey } from "../../lib/firebase/admin";

/** LINE 由来の Firestore ユーザーキーの接頭辞 (`lib/firebase/auth-guard.ts` の名前空間)。 */
const LINE_KEY_PREFIX = "line:";

/**
 * 最終アクティビティを求めるために舐めるサブコレクション。
 *
 * `behaviorLog` は行数が桁違いに多く、かつ「本人が意図した操作」ではないものも入る。
 * 移行窓は「戻ってきて再ログインしてくれるか」で決めたいので、本人の意思が残る 3 つに絞る。
 * (必要になったら --with-behavior-log で足せるようにしてある)
 */
const ACTIVITY_COLLECTIONS = ["favorites", "follows", "eventRegistrations"] as const;

/** 最終アクティビティの日数バケット。個人を特定できない粒度に畳むための境界。 */
const DAY_BUCKETS = [7, 30, 90, 180, 365] as const;

type PersonaStats = {
  /** `users` 直下のドキュメント総数 (LINE 人格 + Shopify 人格)。 */
  totalUserKeys: number;
  /** `line:` 接頭辞を持つ人格数 = 移行対象の母数。 */
  linePersonas: number;
  /** Shopify 顧客番号キーの人格数 (対照)。 */
  shopifyPersonas: number;
  /** データ (お気に入り等) を 1 件でも持つ LINE 人格数。 */
  linePersonasWithData: number;
  /** データを持たない LINE 人格数 (移行しても運ぶものが無い)。 */
  linePersonasEmpty: number;
  /** 最終アクティビティの分布。キーは "<=7d" 等、値は人数。 */
  lastActivityBuckets: Record<string, number>;
  /** LINE 人格が保有するデータ件数の合計 (種別ごと)。 */
  itemCounts: Record<string, number>;
};

function initFirestore(): { db: Firestore; projectId: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY が必要です " +
        "(.env.local を読み込んでから実行してください)",
    );
  }

  const app =
    getApps()[0] ??
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  return { db: getFirestore(app), projectId };
}

/** バケット境界に落とす。`null` は「アクティビティ記録なし」。 */
function bucketFor(lastActiveAt: Date | null, now: Date): string {
  if (!lastActiveAt) return "no-activity";
  const days = Math.floor((now.getTime() - lastActiveAt.getTime()) / 86_400_000);
  for (const boundary of DAY_BUCKETS) {
    if (days <= boundary) return `<=${boundary}d`;
  }
  return `>${DAY_BUCKETS[DAY_BUCKETS.length - 1]}d`;
}

/**
 * `users` 配下の全人格を列挙する。
 *
 * `listDocuments()` を使うのは、**ドキュメント本体が存在せずサブコレクションだけを持つ**
 * ユーザーキーがあるため。`.get()` のクエリではそれが 1 件も返らず、LINE 人格を丸ごと
 * 見落とす (お気に入りは `users/{key}/favorites` に直接 add されるので、親 doc は
 * 作られないことがある)。
 */
async function listUserKeys(db: Firestore): Promise<string[]> {
  const refs = await db.collection("users").listDocuments();
  return refs.map((ref) => ref.id);
}

/**
 * サブコレクションを collectionGroup で 1 回ずつ舐め、ユーザーキーごとに
 * 「件数」と「最新の createdAt」を集める。
 *
 * 人格ごとに問い合わせると人数 × 3 回の往復になる。collectionGroup なら 3 回で済み、
 * `select("createdAt")` で本文 (商品名・メモ等) を一切取らずに済むのも重要 — 棚卸しに
 * 中身は要らないし、要らないものは読まないのが PII の扱いとして正しい。
 */
async function collectActivity(
  db: Firestore,
  collections: readonly string[],
): Promise<{
  lastActiveByKey: Map<string, Date>;
  itemsByKey: Map<string, number>;
  itemCounts: Record<string, number>;
}> {
  const lastActiveByKey = new Map<string, Date>();
  const itemsByKey = new Map<string, number>();
  const itemCounts: Record<string, number> = {};

  for (const name of collections) {
    const snapshot = await db.collectionGroup(name).select("createdAt").get();
    itemCounts[name] = snapshot.size;

    for (const doc of snapshot.docs) {
      /* `users/{userKey}/{name}/{docId}` の {userKey} を取り出す。collectionGroup は
       * 同名サブコレクションを全部拾うので、親が `users` でないものは弾く。 */
      const parent = doc.ref.parent.parent;
      if (!parent || parent.parent?.id !== "users") continue;
      const key = parent.id;

      itemsByKey.set(key, (itemsByKey.get(key) ?? 0) + 1);

      const raw = doc.get("createdAt");
      const createdAt: Date | null =
        raw && typeof raw.toDate === "function" ? raw.toDate() : raw instanceof Date ? raw : null;
      if (!createdAt) continue;

      const current = lastActiveByKey.get(key);
      if (!current || createdAt > current) lastActiveByKey.set(key, createdAt);
    }
  }

  return { lastActiveByKey, itemsByKey, itemCounts };
}

async function inventory(withBehaviorLog: boolean): Promise<PersonaStats & { projectId: string }> {
  const { db, projectId } = initFirestore();
  const now = new Date();

  const userKeys = await listUserKeys(db);
  const collections = withBehaviorLog
    ? ([...ACTIVITY_COLLECTIONS, "behaviorLog"] as const)
    : ACTIVITY_COLLECTIONS;
  const { lastActiveByKey, itemsByKey, itemCounts } = await collectActivity(db, collections);

  const stats: PersonaStats & { projectId: string } = {
    projectId,
    totalUserKeys: userKeys.length,
    linePersonas: 0,
    shopifyPersonas: 0,
    linePersonasWithData: 0,
    linePersonasEmpty: 0,
    lastActivityBuckets: {},
    itemCounts,
  };

  /* collectionGroup 側にしか現れないユーザーキー (親 doc も listDocuments も無い型) を
   * 取りこぼさないため、両方の集合を合わせてから数える。 */
  const allKeys = new Set<string>([...userKeys, ...itemsByKey.keys()]);
  stats.totalUserKeys = allKeys.size;

  for (const key of allKeys) {
    if (!key.startsWith(LINE_KEY_PREFIX)) {
      stats.shopifyPersonas += 1;
      continue;
    }
    stats.linePersonas += 1;

    const items = itemsByKey.get(key) ?? 0;
    if (items > 0) stats.linePersonasWithData += 1;
    else stats.linePersonasEmpty += 1;

    const bucket = bucketFor(lastActiveByKey.get(key) ?? null, now);
    stats.lastActivityBuckets[bucket] = (stats.lastActivityBuckets[bucket] ?? 0) + 1;
  }

  return stats;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const withBehaviorLog = argv.includes("--with-behavior-log");

  const stats = await inventory(withBehaviorLog);

  if (asJson) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`[firestore] project: ${stats.projectId}`);
  console.log(`[firestore] user keys (total)     : ${stats.totalUserKeys}`);
  console.log(`[firestore] line: personas        : ${stats.linePersonas}  <- 移行対象の母数`);
  console.log(`[firestore]   ...with data        : ${stats.linePersonasWithData}`);
  console.log(`[firestore]   ...empty            : ${stats.linePersonasEmpty}`);
  console.log(`[firestore] shopify personas      : ${stats.shopifyPersonas}`);
  console.log("[firestore] last activity (line personas):");
  for (const bucket of [...DAY_BUCKETS.map((d) => `<=${d}d`), ">365d", "no-activity"]) {
    const n = stats.lastActivityBuckets[bucket];
    if (n !== undefined) console.log(`[firestore]   ${bucket.padEnd(12)}: ${n}`);
  }
  console.log("[firestore] items by collection (all personas):");
  for (const [name, n] of Object.entries(stats.itemCounts)) {
    console.log(`[firestore]   ${name.padEnd(18)}: ${n}`);
  }
}

main().catch((err) => {
  console.error("[firestore] inventory failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

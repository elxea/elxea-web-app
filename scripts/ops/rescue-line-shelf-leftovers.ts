/**
 * 一度きりの救済: `users/line:{lineUserId}` に取り残された荷物を顧客の棚へ移す。
 *
 * ## なぜ要るのか
 *
 * 連携の成立とデータの合体は、長いあいだ別々のトリガーで動いていた（PR #100 / #101 で
 * 対にした）。対になる前に連携したお客さまの分は、**連携の瞬間に合体が走らなかった**ので
 * `users/line:*` に残ったままになっている。そこはどちらのログイン手段からも読めない場所で、
 * 本人には「読んだ記事の記録が消えた」ように見える。
 *
 * 直った実装では、連携済みの人がメールでログインするたびに `completeLineLinkage` が
 * 取りこぼしを拾い直す。つまり**放っておいてもいつかは回収される**。ただし「いつか」は
 * その人が次にメールでログインした日なので、今そこにある置き去りを待つ理由が無い。
 * 本スクリプトはその 1 回分を先に済ませるだけで、新しい移行の仕組みは作らない。
 *
 * ## 何をするか（合体のロジックは書かない）
 *
 * 移す処理そのものは `mergeLineIdentityIntoShopify` をそのまま呼ぶ。ここで別実装を
 * 起こすと「合体とは何か」の定義が 2 つに割れる。よってこのファイルにあるのは
 *   1. cx-agent の台帳から **今つながっている組** を読む（対象を推測しない）
 *   2. 実行前後の件数を数える
 *   3. `--apply` のときだけ合体を呼ぶ
 * だけ。衝突したら顧客の棚が勝つ・写しの検証が通った分しか元を消さない、という
 * 性質は合体側が持っている。
 *
 * ## 安全性
 *
 * - 既定は dry-run。`--apply` を明示しない限り 1 バイトも書かない
 * - 対象は **台帳に現存する連携の組だけ**。ID を推測して棚を開けない
 * - 冪等。2 回流しても増えない（合体が「引っ越し先にあるか」を見てから運ぶ）
 * - 出力に個人情報を出さない（ID は伏せ字・件数だけ）
 *
 * ## 使い方
 *
 *   npx tsx scripts/ops/rescue-line-shelf-leftovers.ts            # 下見（既定）
 *   npx tsx scripts/ops/rescue-line-shelf-leftovers.ts --apply    # 実行
 *
 * 必要な環境変数（`.env.local` から読む）:
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 *   CX_SUPABASE_URL / CX_SUPABASE_SERVICE_ROLE_KEY
 *     … cx-agent 側 Supabase の読み取り。台帳を読むだけで書かない。
 */
import { config } from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

config({ path: ".env.local" });
config({ path: ".env" });

/** 顧客の棚 / LINE の棚のどちらにも同じ名前で存在するサブコレクション。 */
const SUBCOLLECTIONS = [
  "favorites",
  "follows",
  "eventRegistrations",
  "behaviorLog",
  "conversations",
  "orders",
] as const;

/** 台帳に載っている「今つながっている組」。 */
type LinkedPair = { lineUserId: string; shopifyCustomerId: string };

/** ログに出す用の伏せ字（識別子の生値を出さない）。 */
function mask(value: string): string {
  return `${value.slice(0, 3)}…`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * cx-agent の台帳から、今つながっている組を読む（read-only）。
 *
 * 条件は `getLinkageByLineUser` と同じ「`shopify_customer_id IS NOT NULL`」。
 * **`unfollowed_at` では絞らない** — LINE をブロックしただけの人も連携は生きており、
 * その人の荷物こそ置き去りになりやすい（cx-agent P4 と同じ判断）。
 */
async function fetchLinkedPairs(): Promise<LinkedPair[]> {
  const url = requireEnv("CX_SUPABASE_URL");
  const key = requireEnv("CX_SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(
    `${url}/rest/v1/customer_linkages?select=line_user_id,shopify_customer_id&shopify_customer_id=not.is.null`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) {
    throw new Error(`customer_linkages read failed: ${res.status}`);
  }

  const rows = (await res.json()) as Array<{
    line_user_id?: string | null;
    shopify_customer_id?: string | null;
  }>;

  return rows
    .filter((r) => !!r.line_user_id && !!r.shopify_customer_id)
    .map((r) => ({
      lineUserId: String(r.line_user_id),
      shopifyCustomerId: String(r.shopify_customer_id),
    }));
}

function initFirestore(): Firestore {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: requireEnv("FIREBASE_PROJECT_ID"),
        clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
        privateKey: requireEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    });
  }
  return getFirestore();
}

/** ある棚のサブコレクション件数を数える（本文は読まない）。 */
async function countShelf(
  db: Firestore,
  userKey: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of SUBCOLLECTIONS) {
    const snap = await db.collection(`users/${userKey}/${name}`).count().get();
    counts[name] = snap.data().count;
  }
  return counts;
}

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** 0 件のサブコレクションは出さない（読みやすさ優先・情報量は落とさない）。 */
function describe(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}=${n}`);
  return parts.length > 0 ? parts.join(" ") : "(空)";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  console.log(
    apply
      ? "[rescue] APPLY モード: 置き去りを顧客の棚へ移します"
      : "[rescue] DRY-RUN（既定）: 何も書きません。実行するには --apply",
  );

  const pairs = await fetchLinkedPairs();
  console.log(`[rescue] 台帳の連携: ${pairs.length} 組`);

  const db = initFirestore();

  let movedTotal = 0;
  let retainedTotal = 0;

  for (const pair of pairs) {
    const lineKey = `line:${pair.lineUserId}`;
    const before = await countShelf(db, lineKey);
    const beforeCustomer = await countShelf(db, pair.shopifyCustomerId);

    const label = `line=${mask(pair.lineUserId)} shopify=${mask(pair.shopifyCustomerId)}`;

    if (total(before) === 0) {
      console.log(`[rescue] ${label}: 置き去り無し（何もしない）`);
      continue;
    }

    console.log(
      `[rescue] ${label}: 置き去り ${total(before)} 件 [${describe(before)}] / 顧客棚 ${total(beforeCustomer)} 件 [${describe(beforeCustomer)}]`,
    );

    if (!apply) continue;

    /* 合体そのものは既存の実装に任せる（衝突は顧客棚優先・写しを確かめてから元を消す）。 */
    const { mergeLineIdentityIntoShopify } = await import(
      "../../lib/auth/identity-merge"
    );
    const result = await mergeLineIdentityIntoShopify(
      pair.lineUserId,
      pair.shopifyCustomerId,
      db,
    );

    const after = await countShelf(db, lineKey);
    const afterCustomer = await countShelf(db, pair.shopifyCustomerId);

    console.log(
      `[rescue] ${label}: 移動 copied=${result.totals.copied} 既にあった deduped=${result.totals.deduped}` +
        ` 残した retained=${result.retained}`,
    );
    console.log(
      `[rescue] ${label}: 実測 置き去り ${total(before)} → ${total(after)} / 顧客棚 ${total(beforeCustomer)} → ${total(afterCustomer)} [${describe(afterCustomer)}]`,
    );

    movedTotal += result.totals.copied;
    retainedTotal += result.retained;
  }

  if (apply) {
    console.log(
      `[rescue] 完了: 移動 ${movedTotal} 件 / 残した ${retainedTotal} 件` +
        (retainedTotal > 0
          ? "（残した分は元の場所にあります。もう一度流せば再試行されます）"
          : ""),
    );
  }
}

main().catch((err) => {
  console.error("[rescue] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

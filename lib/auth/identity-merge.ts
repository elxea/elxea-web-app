import * as Sentry from "@sentry/nextjs";
import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  USER_SUBCOLLECTIONS,
  userDoc,
  userSubcollection,
  type UserSubcollection,
} from "@/lib/firebase/collections";

/**
 * Phase 1/2 identity merge — move a LINE-only user's Firestore data under their
 * Shopify `userKey` at the moment their linkage becomes real in the ledger.
 *
 * ## Why this is its own module
 *
 * It used to live inside `app/api/auth/callback/route.ts` as a private helper,
 * which meant the only way to exercise it was to drive a whole OAuth callback.
 * The bug below is a data-loss bug, so it needs tests that can name each case
 * directly; that requires the function to be importable with an injected
 * Firestore.
 *
 * ## いつ呼ばれるか（**呼ぶ側の責務**）
 *
 * この関数は「本人一致の確認」を **しない**。渡された 2 つの識別子が同じ人の
 * ものであることは、呼び出し側が連携台帳で確かめてから渡す約束になっている。
 * その確認と本関数の呼び出しを対で行う唯一の入口が
 * `lib/auth/identity-link.ts` の `completeLineLinkage`。**本関数を直接呼ぶ
 * 経路を新しく作らないこと** — cookie が同居しているだけで発火させると、
 * 共用端末で前の人のお気に入りが次の人の棚へ移る（PR #100 の B5）。
 *
 * ## The bug this replaces (QA audit D2)
 *
 * The previous loop was:
 *
 * ```
 * if (type && targetId) { ...copy if not duplicate... }
 * await doc.ref.delete();          // <- OUTSIDE the guard
 * ```
 *
 * The delete sat outside the "did we copy it?" guard, so a source document
 * missing a required field was **deleted without ever being copied**. The user's
 * favorite/follow/registration was destroyed by logging in. The same shape also
 * deleted the source when the copy threw, because the whole block was wrapped in
 * a single best-effort try/catch at the call site.
 *
 * ## The rule now enforced, per document
 *
 * copy -> verify -> delete, in that order, and the delete is reached only from
 * a *confirmed* destination read:
 *
 * 1. **Validate.** Required fields missing -> the source is RETAINED untouched
 *    and counted as `skippedInvalid`. Nothing is ever deleted that was not
 *    copied.
 * 2. **Copy if absent.** A destination lookup decides. Present already ->
 *    `deduped`, nothing written. (This doubles as the idempotency check: a
 *    re-run of a partially completed merge finds its own earlier copy and does
 *    not duplicate it.)
 * 3. **Verify.** After writing, the destination is read again. Firestore reads
 *    are strongly consistent, so this observes the write that was just
 *    acknowledged. Unconfirmed -> `failed`, source RETAINED.
 * 4. **Delete** the source only once the destination read has confirmed it.
 *
 * A failure on one document does not abort the rest, and never escalates into
 * deleting anything: every failure path retains its source, so a later run
 * merges it (step 2 makes that safe to repeat).
 *
 * ## 運ぶ荷物は `collections.ts` から導出する（書き忘れを型で止める）
 *
 * かつては favorites / follows / eventRegistrations の 3 つを本ファイルに直接
 * 書いていた。その後 `COLLECTIONS` に behaviorLog / conversations / orders が
 * 増えたが、ここは誰も直さなかった。連携したお客さまの行動ログ・会話履歴・
 * 注文ミラーは `users/line:<id>/` に取り残され、**連携後はどのログイン手段
 * からも読めない場所に消えた**（PR #100 の B2 が現状として固定していた挙動）。
 *
 * いまは `USER_SUBCOLLECTIONS` から仕事一覧を導出し、strategy 表を
 * `Record<UserSubcollection, MergeStrategy>` で受ける。**サブコレクションを
 * 足して strategy を書かなければ型エラー**になるので、同じ落とし方はできない。
 * ユーザードキュメント本体（`users/{key}`）も併せて運ぶ。
 *
 * ## 衝突は「既存（顧客の棚）優先」。LINE 側で上書きしない
 *
 * 引っ越し先に同じものが既にあるなら、それが正。LINE 側の値で塗り替えない。
 * 理由は非対称で、顧客の棚は本人がメールでログインして積み上げた本命の記録で
 * あるのに対し、`line:` 側は連携前の一時的な置き場だから。ユーザードキュメント
 * はフィールド単位で同じ規則を適用する（**欠けているフィールドだけ**を足す）。
 *
 * ## Failures are visible, not swallowed
 *
 * The call site used to catch and drop everything. Partial failure inside the
 * loop produced no signal at all. Now the result carries per-collection counters
 * and `retained` (= documents deliberately left under the LINE key), and a
 * non-zero `skippedInvalid`/`failed` emits a `console.warn` plus a Sentry
 * warning. Login is still never blocked — that stays a deliberate property —
 * but "it half worked" is no longer indistinguishable from "it worked".
 */

export type MergeCounters = {
  /** Written to the Shopify key, then the source was deleted. */
  copied: number;
  /** Destination already had it; nothing written, source deleted. */
  deduped: number;
  /** Required fields missing; nothing written, **source retained**. */
  skippedInvalid: number;
  /** Copy unconfirmed or delete threw; **source retained** for a later run. */
  failed: number;
};

export type IdentityMergeResult = {
  lineUserKey: string;
  shopifyCustomerId: string;
  /** サブコレクションごとの結果。キーは `USER_SUBCOLLECTIONS` と 1:1。 */
  collections: Record<UserSubcollection, MergeCounters>;
  /** `users/{key}` ドキュメント本体（フィールド単位で足りない分だけ移す）。 */
  userDocument: MergeCounters;
  totals: MergeCounters;
  /** Documents left in place under the LINE key (= skippedInvalid + failed). */
  retained: number;
  /** True when nothing was skipped and nothing failed. */
  complete: boolean;
};

/** One equality clause of a dedupe query. */
type DedupeClause = { field: string; value: string };

/**
 * Extract the dedupe key for a source document, or `null` when a required field
 * is absent. Returning `null` is what protects the document from deletion.
 */
type DedupeKeyOf = (data: Record<string, unknown>) => DedupeClause[] | null;

/**
 * コレクションごとの運び方。
 *
 *   - `dedupe-by-fields` … 「同じ内容が既にあるか」を**内容**で判定する。
 *     お気に入り・フォロー・イベント参加のように、ドキュメント ID に意味が無く
 *     内容の一意性だけが問題になるもの向け。ID は引っ越し先で振り直す。
 *   - `preserve-doc-id` … **ドキュメント ID を保ったまま**運ぶ。ID そのものが
 *     鍵（`orders/{orderId}`）か、追記されるだけのログで内容の重複が正当
 *     （同じ行動を 2 回した / 同じ言葉を 2 回言った）なもの向け。内容で重複
 *     判定すると正当な 2 件目を「重複」として消してしまうので使えない。ID を
 *     保つこと自体が再実行の冪等性になる。
 */
type MergeStrategy =
  | { kind: "dedupe-by-fields"; dedupeKeyOf: DedupeKeyOf }
  | { kind: "preserve-doc-id" };

function requireString(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 全サブコレクションの運び方。`Record<UserSubcollection, …>` なので
 * `USER_SUBCOLLECTIONS` に足したものを書き忘れると**コンパイルが通らない**。
 */
const STRATEGIES: Record<UserSubcollection, MergeStrategy> = {
  favorites: {
    kind: "dedupe-by-fields",
    dedupeKeyOf: (data) => {
      const type = requireString(data, "type");
      const targetId = requireString(data, "targetId");
      if (!type || !targetId) return null;
      return [
        { field: "type", value: type },
        { field: "targetId", value: targetId },
      ];
    },
  },
  follows: {
    kind: "dedupe-by-fields",
    dedupeKeyOf: (data) => {
      const farmerSlug = requireString(data, "farmerSlug");
      return farmerSlug ? [{ field: "farmerSlug", value: farmerSlug }] : null;
    },
  },
  eventRegistrations: {
    kind: "dedupe-by-fields",
    dedupeKeyOf: (data) => {
      const eventSlug = requireString(data, "eventSlug");
      return eventSlug ? [{ field: "eventSlug", value: eventSlug }] : null;
    },
  },
  /* 行動ログ・会話履歴は追記オンリーで、同じ内容の 2 件目が正当に存在する
     （同じ記事をもう一度読んだ / 同じ質問をもう一度した）。内容で重複判定すると
     その 2 件目を消すので、ID を保って運ぶ。 */
  behaviorLog: { kind: "preserve-doc-id" },
  conversations: { kind: "preserve-doc-id" },
  /* 注文ミラーはドキュメント ID が注文 ID（`users/{id}/orders/{orderId}`）。
     ID を保つことがそのまま「同じ注文を二重に作らない」になる。 */
  orders: { kind: "preserve-doc-id" },
};

function emptyCounters(): MergeCounters {
  return { copied: 0, deduped: 0, skippedInvalid: 0, failed: 0 };
}

function addCounters(a: MergeCounters, b: MergeCounters): MergeCounters {
  return {
    copied: a.copied + b.copied,
    deduped: a.deduped + b.deduped,
    skippedInvalid: a.skippedInvalid + b.skippedInvalid,
    failed: a.failed + b.failed,
  };
}

/** Is a document matching `key` already present at `dstPath`? */
async function destinationHas(
  db: Firestore,
  dstPath: string,
  key: DedupeClause[],
): Promise<boolean> {
  let query: Query<DocumentData> = db.collection(dstPath);
  for (const clause of key) {
    query = query.where(clause.field, "==", clause.value);
  }
  const snap = await query.limit(1).get();
  return !snap.empty;
}

/** 内容で重複判定して運ぶ（ID は引っ越し先で振り直す）。 */
async function mergeByFields(
  db: Firestore,
  srcPath: string,
  dstPath: string,
  dedupeKeyOf: DedupeKeyOf,
): Promise<MergeCounters> {
  const counters = emptyCounters();
  const srcSnap = await db.collection(srcPath).get();

  for (const doc of srcSnap.docs) {
    const data = doc.data();

    /* Step 1 — validate. A document we cannot key is a document we cannot
     * confirm we copied, so it is never deleted. This is the D2 fix. */
    const key = dedupeKeyOf(data);
    if (!key) {
      counters.skippedInvalid += 1;
      continue;
    }

    try {
      // Step 2 — copy only when the destination does not already hold it.
      const alreadyPresent = await destinationHas(db, dstPath, key);
      if (alreadyPresent) {
        counters.deduped += 1;
      } else {
        await db.collection(dstPath).add(data);

        /* Step 3 — verify. `add` resolving means the server acknowledged the
         * write; reading it back is what lets the delete below be justified by
         * an observation rather than by an assumption. */
        const confirmed = await destinationHas(db, dstPath, key);
        if (!confirmed) {
          counters.failed += 1;
          continue;
        }
        counters.copied += 1;
      }

      // Step 4 — the source is redundant now, and only now.
      await doc.ref.delete();
    } catch {
      /* Retain the source. A throw anywhere above (copy, verify, or delete)
       * leaves this document under the LINE key; the next run re-runs the
       * merge and step 2 makes that idempotent. */
      counters.failed += 1;
    }
  }

  return counters;
}

/**
 * ドキュメント ID を保ったまま運ぶ。
 *
 * 4 段（validate → copy if absent → verify → delete）の骨格は
 * `mergeByFields` と同じで、「既にあるか」の判定だけが**内容の一致**から
 * **同じ ID の存在**に変わる。ID が鍵なので validate 段で落ちる条件は無い
 * （どのドキュメントも必ず ID を持つ）ため `skippedInvalid` は増えない。
 *
 * 衝突時は**引っ越し先を残す**（上書きしない）。追記ログで同じ ID が両側に
 * あるのは再実行の痕跡でしかなく、そこで LINE 側の値を書き戻すと、前回の
 * 実行後に顧客の棚で更新された内容を巻き戻すことになる。
 */
async function mergeByDocId(
  db: Firestore,
  srcPath: string,
  dstPath: string,
): Promise<MergeCounters> {
  const counters = emptyCounters();
  const srcSnap = await db.collection(srcPath).get();

  for (const doc of srcSnap.docs) {
    try {
      const dstRef = db.collection(dstPath).doc(doc.id);

      const existing = await dstRef.get();
      if (existing.exists) {
        counters.deduped += 1;
      } else {
        await dstRef.set(doc.data());

        const confirmed = await dstRef.get();
        if (!confirmed.exists) {
          counters.failed += 1;
          continue;
        }
        counters.copied += 1;
      }

      await doc.ref.delete();
    } catch {
      counters.failed += 1;
    }
  }

  return counters;
}

/**
 * `users/{lineUserKey}` ドキュメント本体を `users/{shopifyCustomerId}` に畳む。
 *
 * サブコレクションと違い、こちらは 1 ドキュメントの**フィールド単位**の合流に
 * なる。規則は同じ「既存（顧客の棚）優先」で、**引っ越し先に無いフィールドだけ**
 * を足す。ペルソナ・嗜好プロファイルのように両側で育っている値を LINE 側で
 * 塗り替えないため（顧客の棚のほうが本命の記録）。
 *
 * 引っ越し先が存在しないときも同じ道を通る（全フィールドが「無い」だけ）。
 * 空の結果（すべて 0）は「移すものが無かった」を意味し、`complete` を汚さない。
 */
async function mergeUserDocument(
  db: Firestore,
  srcPath: string,
  dstPath: string,
): Promise<MergeCounters> {
  const counters = emptyCounters();

  try {
    const srcRef = db.doc(srcPath);
    const srcSnap = await srcRef.get();
    if (!srcSnap.exists) return counters;

    const srcData = (srcSnap.data() ?? {}) as Record<string, unknown>;
    const dstRef = db.doc(dstPath);
    const dstSnap = await dstRef.get();
    const dstData = (dstSnap.exists ? (dstSnap.data() ?? {}) : {}) as Record<
      string,
      unknown
    >;

    const missing: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(srcData)) {
      if (dstData[field] === undefined) missing[field] = value;
    }

    const fields = Object.keys(missing);
    if (fields.length === 0) {
      // 引っ越し先が既に全部持っている。LINE 側は畳んでよい。
      counters.deduped += 1;
    } else {
      await dstRef.set(missing, { merge: true });

      // verify — 足したフィールドが実際に読み戻せたときだけ元を消す。
      const confirmedSnap = await dstRef.get();
      const confirmedData = (confirmedSnap.exists
        ? (confirmedSnap.data() ?? {})
        : {}) as Record<string, unknown>;
      if (!fields.every((field) => confirmedData[field] !== undefined)) {
        counters.failed += 1;
        return counters;
      }
      counters.copied += 1;
    }

    await srcRef.delete();
  } catch {
    counters.failed += 1;
  }

  return counters;
}

/**
 * Move `users/line:{lineUserId}/**` under `users/{shopifyCustomerId}/**`.
 *
 * ⚠ **本人一致は呼び出し側の責務**（モジュール冒頭の doc を読むこと）。
 * 通常の入口は `lib/auth/identity-link.ts` の `completeLineLinkage`。
 *
 * Never throws for per-document problems — inspect the returned counters. A
 * throw from here means a collection listing itself failed.
 */
export async function mergeLineIdentityIntoShopify(
  lineUserId: string,
  shopifyCustomerId: string,
  db: Firestore = getAdminFirestore(),
): Promise<IdentityMergeResult> {
  const lineUserKey = `line:${lineUserId}`;

  const collections = Object.fromEntries(
    USER_SUBCOLLECTIONS.map((name) => [name, emptyCounters()]),
  ) as Record<UserSubcollection, MergeCounters>;
  let userDocument = emptyCounters();

  const result = (): IdentityMergeResult => {
    const totals = [...Object.values(collections), userDocument].reduce(
      addCounters,
      emptyCounters(),
    );
    const retained = totals.skippedInvalid + totals.failed;
    return {
      lineUserKey,
      shopifyCustomerId,
      collections,
      userDocument,
      totals,
      retained,
      complete: retained === 0,
    };
  };

  /* Merging a key into itself would delete every source document immediately
   * after "finding" it at the destination — the same document. */
  if (lineUserKey === shopifyCustomerId) return result();

  for (const name of USER_SUBCOLLECTIONS) {
    const strategy = STRATEGIES[name];
    const srcPath = userSubcollection(lineUserKey, name);
    const dstPath = userSubcollection(shopifyCustomerId, name);

    collections[name] =
      strategy.kind === "dedupe-by-fields"
        ? await mergeByFields(db, srcPath, dstPath, strategy.dedupeKeyOf)
        : await mergeByDocId(db, srcPath, dstPath);
  }

  userDocument = await mergeUserDocument(
    db,
    userDoc(lineUserKey),
    userDoc(shopifyCustomerId),
  );

  const merged = result();
  reportMergeOutcome(merged);
  return merged;
}

/**
 * Surface the outcome. A clean merge is a breadcrumb; anything retained is a
 * warning, because "some of this user's data is still under the old key" is a
 * condition someone has to be able to see without reproducing the login.
 */
export function reportMergeOutcome(result: IdentityMergeResult): void {
  const data = {
    subsystem: "identity-merge",
    lineUserKey: result.lineUserKey,
    shopifyCustomerId: result.shopifyCustomerId,
    collections: result.collections,
    userDocument: result.userDocument,
    retained: result.retained,
  };

  if (result.complete) {
    Sentry.addBreadcrumb({
      category: "identity-merge",
      level: "info",
      message: "Merged LINE identity into Shopify user",
      data,
    });
    return;
  }

  console.warn(
    `[identity-merge] partial merge: ${result.retained} document(s) retained under ${result.lineUserKey}` +
      ` (skippedInvalid=${result.totals.skippedInvalid}, failed=${result.totals.failed})`,
  );
  Sentry.captureMessage("Identity merge incomplete; source documents retained", {
    level: "warning",
    tags: { subsystem: "identity-merge" },
    extra: data,
  });
}

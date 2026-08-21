import * as Sentry from "@sentry/nextjs";
import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  eventRegistrationsCol,
  favoritesCol,
  followsCol,
} from "@/lib/firebase/collections";

/**
 * Phase 1/2 identity merge — move a LINE-only user's Firestore data under their
 * Shopify `userKey` at the moment they finish Shopify OAuth.
 *
 * ## Why this is its own module
 *
 * It used to live inside `app/api/auth/callback/route.ts` as a private helper,
 * which meant the only way to exercise it was to drive a whole OAuth callback.
 * The bug below is a data-loss bug, so it needs tests that can name each case
 * directly; that requires the function to be importable with an injected
 * Firestore.
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
 * 2. **Copy if absent.** A destination query on the dedupe key decides. Present
 *    already -> `deduped`, nothing written. (This doubles as the idempotency
 *    check: a re-run of a partially completed merge finds its own earlier copy
 *    and does not duplicate it.)
 * 3. **Verify.** After writing, the destination is read again. Firestore queries
 *    are strongly consistent, so this observes the write that was just
 *    acknowledged. Unconfirmed -> `failed`, source RETAINED.
 * 4. **Delete** the source only once the destination read has confirmed it.
 *
 * A failure on one document does not abort the rest, and never escalates into
 * deleting anything: every failure path retains its source, so a later login
 * merges it (step 2 makes that safe to repeat).
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
  favorites: MergeCounters;
  follows: MergeCounters;
  eventRegistrations: MergeCounters;
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

function requireString(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === "string" && value.length > 0 ? value : null;
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

async function mergeCollection(
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
       * leaves this document under the LINE key; the next login re-runs the
       * merge and step 2 makes that idempotent. */
      counters.failed += 1;
    }
  }

  return counters;
}

/**
 * Move `users/line:{lineUserId}/**` under `users/{shopifyCustomerId}/**`.
 *
 * Never throws for per-document problems — inspect the returned counters. A
 * throw from here means the collection listing itself failed.
 */
export async function mergeLineIdentityIntoShopify(
  lineUserId: string,
  shopifyCustomerId: string,
  db: Firestore = getAdminFirestore(),
): Promise<IdentityMergeResult> {
  const lineUserKey = `line:${lineUserId}`;

  const favorites = emptyCounters();
  const follows = emptyCounters();
  const eventRegistrations = emptyCounters();

  const result = (): IdentityMergeResult => {
    const totals = addCounters(addCounters(favorites, follows), eventRegistrations);
    const retained = totals.skippedInvalid + totals.failed;
    return {
      lineUserKey,
      shopifyCustomerId,
      favorites,
      follows,
      eventRegistrations,
      totals,
      retained,
      complete: retained === 0,
    };
  };

  /* Merging a key into itself would delete every source document immediately
   * after "finding" it at the destination — the same document. */
  if (lineUserKey === shopifyCustomerId) return result();

  Object.assign(
    favorites,
    await mergeCollection(
      db,
      favoritesCol(lineUserKey),
      favoritesCol(shopifyCustomerId),
      (data) => {
        const type = requireString(data, "type");
        const targetId = requireString(data, "targetId");
        if (!type || !targetId) return null;
        return [
          { field: "type", value: type },
          { field: "targetId", value: targetId },
        ];
      },
    ),
  );

  Object.assign(
    follows,
    await mergeCollection(db, followsCol(lineUserKey), followsCol(shopifyCustomerId), (data) => {
      const farmerSlug = requireString(data, "farmerSlug");
      return farmerSlug ? [{ field: "farmerSlug", value: farmerSlug }] : null;
    }),
  );

  Object.assign(
    eventRegistrations,
    await mergeCollection(
      db,
      eventRegistrationsCol(lineUserKey),
      eventRegistrationsCol(shopifyCustomerId),
      (data) => {
        const eventSlug = requireString(data, "eventSlug");
        return eventSlug ? [{ field: "eventSlug", value: eventSlug }] : null;
      },
    ),
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
    favorites: result.favorites,
    follows: result.follows,
    eventRegistrations: result.eventRegistrations,
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

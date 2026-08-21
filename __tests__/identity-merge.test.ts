/**
 * Tests for `lib/auth/identity-merge.ts` — QA audit D2 (data loss on merge).
 *
 * The defect: the LINE -> Shopify merge deleted every source document it
 * iterated, including ones it had NOT copied, because `doc.ref.delete()` sat
 * outside the `if (type && targetId)` guard. A favorite missing a field was
 * destroyed by logging in.
 *
 * These tests are written as invariants about deletion, not about counters:
 *
 *   I1. Nothing is deleted from the source unless a read of the DESTINATION
 *       confirmed it is there.
 *   I2. A document that fails validation is retained, untouched.
 *   I3. A failure on one document does not delete it, and does not stop the
 *       others.
 *   I4. Re-running the merge is safe (it is the retry path for I2/I3).
 *
 * `console.warn` is asserted because "some of the user's data is still under the
 * old key" has to be visible without reproducing the login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

/* The module imports `getAdminFirestore` for its default argument. Every test
 * injects a fake db, so the real one must never be constructed — stub it to
 * throw, which turns "the test accidentally hit Firebase" into a failure rather
 * than a hang. */
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => {
    throw new Error("real Firestore must not be used in this test");
  },
}));

import { mergeLineIdentityIntoShopify } from "@/lib/auth/identity-merge";
import {
  eventRegistrationsCol,
  favoritesCol,
  followsCol,
} from "@/lib/firebase/collections";

const LINE_USER_ID = "U0123456789";
const LINE_KEY = `line:${LINE_USER_ID}`;
const SHOPIFY_ID = "7654321";

// --- Minimal in-memory Firestore -------------------------------------------

type DocData = Record<string, unknown>;
type Seed = Record<string, DocData[]>;

type Hooks = {
  /** Throw to simulate a copy that fails. */
  beforeAdd?: (path: string, data: DocData) => void;
  /** Throw to simulate a delete that fails after a successful copy. */
  beforeDelete?: (path: string, id: string) => void;
  /** Return true to make a write be acknowledged but not land (unverifiable copy). */
  dropWrite?: (path: string, data: DocData) => boolean;
};

function createFakeFirestore(seed: Seed, hooks: Hooks = {}) {
  const store = new Map<string, Map<string, DocData>>();
  let counter = 0;

  const colOf = (path: string) => {
    let col = store.get(path);
    if (!col) {
      col = new Map();
      store.set(path, col);
    }
    return col;
  };

  for (const [path, docs] of Object.entries(seed)) {
    for (const data of docs) colOf(path).set(`seed-${++counter}`, { ...data });
  }

  function makeQuery(path: string, clauses: [string, unknown][], limit: number | null) {
    return {
      where(field: string, _op: string, value: unknown) {
        return makeQuery(path, [...clauses, [field, value] as [string, unknown]], limit);
      },
      limit(n: number) {
        return makeQuery(path, clauses, n);
      },
      async get() {
        let entries = [...colOf(path).entries()];
        for (const [field, value] of clauses) {
          entries = entries.filter(([, data]) => data[field] === value);
        }
        if (limit !== null) entries = entries.slice(0, limit);
        return {
          empty: entries.length === 0,
          docs: entries.map(([id, data]) => ({
            id,
            data: () => ({ ...data }),
            ref: {
              async delete() {
                hooks.beforeDelete?.(path, id);
                colOf(path).delete(id);
              },
            },
          })),
        };
      },
      async add(data: DocData) {
        hooks.beforeAdd?.(path, data);
        if (hooks.dropWrite?.(path, data)) return { id: "dropped" };
        const id = `added-${++counter}`;
        colOf(path).set(id, { ...data });
        return { id };
      },
    };
  }

  const db = {
    collection: (path: string) => makeQuery(path, [], null),
  } as unknown as Firestore;

  const contents = (path: string) => [...(store.get(path)?.values() ?? [])];

  return { db, contents };
}

// --- Fixtures ---------------------------------------------------------------

const VALID_FAVORITE = { type: "product", targetId: "gid://shopify/Product/1", note: "keep" };
const INVALID_FAVORITE = { type: "product", note: "targetId is missing" };
const VALID_FOLLOW = { farmerSlug: "yamada-farm" };
const INVALID_FOLLOW = { note: "farmerSlug is missing" };
const VALID_REGISTRATION = { eventSlug: "marche-2026-08" };
const INVALID_REGISTRATION = { note: "eventSlug is missing" };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.clearAllMocks();
});

// --- I2: invalid documents are retained -------------------------------------

describe("documents missing required fields", () => {
  it("leaves a favorite with no targetId in place instead of deleting it", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [INVALID_FAVORITE],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    // The regression: this used to be [] because the delete ran anyway.
    expect(contents(favoritesCol(LINE_KEY))).toEqual([INVALID_FAVORITE]);
    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([]);
    expect(result.favorites.skippedInvalid).toBe(1);
    expect(result.retained).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("applies the same protection to follows and event registrations", async () => {
    const { db, contents } = createFakeFirestore({
      [followsCol(LINE_KEY)]: [INVALID_FOLLOW],
      [eventRegistrationsCol(LINE_KEY)]: [INVALID_REGISTRATION],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(followsCol(LINE_KEY))).toEqual([INVALID_FOLLOW]);
    expect(contents(eventRegistrationsCol(LINE_KEY))).toEqual([INVALID_REGISTRATION]);
    expect(contents(followsCol(SHOPIFY_ID))).toEqual([]);
    expect(contents(eventRegistrationsCol(SHOPIFY_ID))).toEqual([]);
    expect(result.retained).toBe(2);
  });

  it("treats an empty-string required field as missing", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [{ type: "product", targetId: "" }],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(LINE_KEY))).toHaveLength(1);
    expect(result.favorites.skippedInvalid).toBe(1);
  });
});

// --- I1: only confirmed copies are deleted ----------------------------------

describe("only documents confirmed at the destination are deleted", () => {
  it("copies then deletes the valid document while retaining the invalid one", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [VALID_FAVORITE, INVALID_FAVORITE],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([VALID_FAVORITE]);
    expect(contents(favoritesCol(LINE_KEY))).toEqual([INVALID_FAVORITE]);
    expect(result.favorites).toMatchObject({ copied: 1, skippedInvalid: 1, failed: 0 });
  });

  it("retains the source when the write is acknowledged but does not land", async () => {
    /* The verify step exists for exactly this: `add` resolved, so the old code
     * would have deleted the source, but a destination read does not find it. */
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: [VALID_FAVORITE] },
      { dropWrite: () => true },
    );

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(LINE_KEY))).toEqual([VALID_FAVORITE]);
    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([]);
    expect(result.favorites).toMatchObject({ copied: 0, failed: 1 });
  });

  it("moves every valid document and empties the source when all succeed", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [VALID_FAVORITE],
      [followsCol(LINE_KEY)]: [VALID_FOLLOW],
      [eventRegistrationsCol(LINE_KEY)]: [VALID_REGISTRATION],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(LINE_KEY))).toEqual([]);
    expect(contents(followsCol(LINE_KEY))).toEqual([]);
    expect(contents(eventRegistrationsCol(LINE_KEY))).toEqual([]);
    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([VALID_FAVORITE]);
    expect(contents(followsCol(SHOPIFY_ID))).toEqual([VALID_FOLLOW]);
    expect(contents(eventRegistrationsCol(SHOPIFY_ID))).toEqual([VALID_REGISTRATION]);
    expect(result.complete).toBe(true);
    expect(result.retained).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// --- I3: partial failure retains the remainder and warns --------------------

describe("partial failure", () => {
  it("retains the failed document, still merges the rest, and warns", async () => {
    const failing = { type: "article", targetId: "boom" };
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: [failing, VALID_FAVORITE] },
      {
        beforeAdd: (_path, data) => {
          if (data.targetId === "boom") throw new Error("firestore write rejected");
        },
      },
    );

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    // The failure did not abort the loop...
    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([VALID_FAVORITE]);
    // ...and did not cost the user the document it could not copy.
    expect(contents(favoritesCol(LINE_KEY))).toEqual([failing]);
    expect(result.favorites).toMatchObject({ copied: 1, failed: 1 });
    expect(result.retained).toBe(1);
  });

  it("retains the source when the copy succeeded but the delete threw", async () => {
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: [VALID_FAVORITE] },
      {
        beforeDelete: () => {
          throw new Error("delete rejected");
        },
      },
    );

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([VALID_FAVORITE]);
    expect(contents(favoritesCol(LINE_KEY))).toEqual([VALID_FAVORITE]);
    expect(result.favorites.failed).toBe(1);
  });

  it("makes an incomplete merge visible on console.warn", async () => {
    const { db } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [INVALID_FAVORITE],
    });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain("[identity-merge]");
    expect(message).toContain("1 document(s) retained");
    expect(message).toContain(LINE_KEY);
  });
});

// --- I4: the merge is safe to repeat ----------------------------------------

describe("idempotency", () => {
  it("does not duplicate a document the destination already holds", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [VALID_FAVORITE],
      [favoritesCol(SHOPIFY_ID)]: [VALID_FAVORITE],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(SHOPIFY_ID))).toHaveLength(1);
    expect(contents(favoritesCol(LINE_KEY))).toEqual([]);
    expect(result.favorites).toMatchObject({ copied: 0, deduped: 1 });
  });

  it("completes a merge whose delete failed on the previous run", async () => {
    /* Run 1 copies but cannot delete; run 2 must recognise its own earlier copy
     * rather than writing a second one. */
    let failDelete = true;
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: [VALID_FAVORITE] },
      {
        beforeDelete: () => {
          if (failDelete) throw new Error("delete rejected");
        },
      },
    );

    const first = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);
    expect(first.favorites.failed).toBe(1);

    failDelete = false;
    const second = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(second.favorites).toMatchObject({ copied: 0, deduped: 1, failed: 0 });
    expect(contents(favoritesCol(SHOPIFY_ID))).toHaveLength(1);
    expect(contents(favoritesCol(LINE_KEY))).toEqual([]);
    expect(second.complete).toBe(true);
  });

  it("running twice on a clean merge changes nothing the second time", async () => {
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [VALID_FAVORITE],
    });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);
    const second = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([VALID_FAVORITE]);
    expect(second.totals).toMatchObject({ copied: 0, deduped: 0, failed: 0 });
  });
});

describe("degenerate keys", () => {
  it("does nothing when the LINE key and the Shopify key are the same", async () => {
    const selfKey = `line:${LINE_USER_ID}`;
    const { db, contents } = createFakeFirestore({
      [favoritesCol(selfKey)]: [VALID_FAVORITE],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, selfKey, db);

    expect(contents(favoritesCol(selfKey))).toEqual([VALID_FAVORITE]);
    expect(result.totals).toMatchObject({ copied: 0, deduped: 0, failed: 0 });
  });
});

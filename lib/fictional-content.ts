/**
 * Fictional / placeholder Sanity content deny-list (single source of truth).
 *
 * The production Sanity dataset still contains fictional documents that were
 * persisted by the development seed scripts, because
 * `scripts/seed-dummy-content.ts` resolves its dataset as
 * `NEXT_PUBLIC_SANITY_DATASET || "production"` — i.e. running it without an
 * explicit dataset writes the dummies straight into production:
 *   - scripts/seed-farmers.ts       farmer  (青山 修一 / 陳 玉芬 / ラジャン・メータ)
 *   - scripts/seed-dummy-content.ts farmer  (山田農園 / 田中茶園)
 *                                   teaMenu (春の煎茶 / 宇治玉露 / 加賀ほうじ茶)
 *
 * Two further `farmer` docs (山田 健一 / 佐藤 美咲, created 2026-03-07) are not
 * seed-script output but are equally invented — Setaka confirmed on 2026-08-22
 * that elxea has no real producer profiles published yet, so every farmer doc
 * currently in production is fictional. They are listed below too.
 *                                   playlist (Morning Forest / Rain on Tea Leaves —
 *                                             tracks point at a placeholder bgm.mp3
 *                                             titled "テスト音源")
 *                                   event   (both bodies literally contain "ダミー")
 *
 * These docs describe invented producers, invented tea and invented events that
 * do NOT correspond to anything elxea actually sells or hosts, yet they render
 * publicly and are listed in the public sitemap.xml (which sits outside the
 * site password gate). Until real content is approved for publication we hide
 * them at the READ LAYER ONLY, WITHOUT touching Sanity data (no draft, no
 * unpublish, no deletes) so the change is fully reversible in code and carries
 * zero data-mutation risk.
 *
 * This is a DENY-LIST by fixed `_id` / slug per document type: it only ever
 * hides these known fictional documents. Any real document added later is
 * unaffected and shows normally, so there is no risk of accidentally hiding
 * genuine content.
 *
 * Deliberately NOT listed here:
 *   - `author` (author-setaka / author-roji): "Setaka" may be a real person, so
 *     these are left visible pending Setaka's confirmation.
 *   - `article` / `journal` seed docs: not confirmed fictional by observation.
 *
 * This module replaces the former `lib/fictional-farmers.ts`. It started out
 * byte-identical for `farmer`; the two 2026-03-07 docs above are the only
 * additions since. Every entry is guarded by
 * __tests__/fictional-content.test.ts, which also asserts — at source level —
 * that each read path still consults this list.
 */

/** Sanity `_type`s that currently have known fictional seed documents. */
export type FictionalDocType = "farmer" | "teaMenu" | "playlist" | "event";

type DenyEntry = { readonly ids: readonly string[]; readonly slugs: readonly string[] };

/**
 * Fixed Sanity `_id`s and slugs of the known fictional documents, grouped by
 * `_type`. `_id` and slug are both listed for defense in depth: list views
 * normally have `_id`, detail routes and the sitemap only have the slug.
 */
const FICTIONAL_DOCS: Readonly<Record<FictionalDocType, DenyEntry>> = {
  farmer: {
    ids: [
      // scripts/seed-farmers.ts
      "farmer-aoyama-shuichi",
      "farmer-chen-yufen",
      "farmer-rajan-mehta",
      // scripts/seed-dummy-content.ts
      "farmer-yamada",
      "farmer-tanaka",
      // Hand-created 2026-03-07, confirmed fictional by Setaka 2026-08-22.
      // Auto-generated Sanity ids, so the name is spelled out here.
      "ChPy2hTrLaycRwOtl4DGV5", // 山田 健一
      "ChPy2hTrLaycRwOtl4DGZd", // 佐藤 美咲
    ],
    slugs: [
      // scripts/seed-farmers.ts
      "aoyama-shuichi",
      "chen-yufen",
      "rajan-mehta",
      // scripts/seed-dummy-content.ts
      "yamada-farm",
      "tanaka-tea-garden",
      // Hand-created 2026-03-07, confirmed fictional by Setaka 2026-08-22.
      "yamada-kenichi",
      "sato-misaki",
    ],
  },
  teaMenu: {
    // scripts/seed-dummy-content.ts — all three teaMenu docs in production are seeds
    ids: ["tea-sencha-spring", "tea-gyokuro", "tea-hojicha"],
    slugs: ["spring-sencha", "uji-gyokuro", "kaga-hojicha"],
  },
  playlist: {
    // scripts/seed-dummy-content.ts — tracks are the placeholder bgm.mp3
    ids: ["playlist-morning-forest", "playlist-rain-on-leaves"],
    slugs: ["morning-forest", "rain-on-tea-leaves"],
  },
  event: {
    // scripts/seed-dummy-content.ts — bodies contain the word "ダミー"
    ids: ["event-tea-tasting", "event-brewing-workshop"],
    slugs: ["spring-tea-tasting-2026", "beginners-tea-workshop"],
  },
} as const;

function toSets(
  pick: (entry: DenyEntry) => readonly string[],
): Readonly<Record<FictionalDocType, ReadonlySet<string>>> {
  const sets = {} as Record<FictionalDocType, ReadonlySet<string>>;
  for (const type of Object.keys(FICTIONAL_DOCS) as FictionalDocType[]) {
    sets[type] = new Set(pick(FICTIONAL_DOCS[type]));
  }
  return Object.freeze(sets);
}

const ID_SETS = toSets((entry) => entry.ids);
const SLUG_SETS = toSets((entry) => entry.slugs);

/** The known fictional `_id`s for one document type (read-only). */
export function fictionalIds(type: FictionalDocType): ReadonlySet<string> {
  return ID_SETS[type];
}

/** The known fictional slugs for one document type (read-only). */
export function fictionalSlugs(type: FictionalDocType): ReadonlySet<string> {
  return SLUG_SETS[type];
}

/** True when an `_id` belongs to a known fictional document of that type. */
export function isFictionalId(
  type: FictionalDocType,
  id: string | null | undefined,
): boolean {
  return typeof id === "string" && ID_SETS[type].has(id);
}

/** True when a slug belongs to a known fictional document of that type. */
export function isFictionalSlug(
  type: FictionalDocType,
  slug: string | null | undefined,
): boolean {
  return typeof slug === "string" && SLUG_SETS[type].has(slug);
}

/**
 * Remove known fictional documents from a fetched list. Matches on either `_id`
 * or `slug.current` for defense in depth. Real documents pass through
 * untouched, and a null/undefined fetch result becomes an empty list.
 *
 * `T` is intentionally unconstrained so the element type of a Sanity fetch
 * (often `any`, sometimes a locally declared shape) survives the call and the
 * caller's `.map` callback keeps its own narrower parameter type. The two fields
 * we read are narrowed structurally instead. The first overload exists so that
 * inference still has a candidate for `T` when the argument is a bare array
 * (matching `any` against the nullable union yields no candidate, which would
 * collapse the result to `unknown[]` at every call site).
 */
export function filterOutFictional<T>(type: FictionalDocType, docs: T[]): T[];
export function filterOutFictional<T>(
  type: FictionalDocType,
  docs: T[] | null | undefined,
): T[];
export function filterOutFictional<T>(
  type: FictionalDocType,
  docs: T[] | null | undefined,
): T[] {
  const list = docs ?? [];
  return list.filter((doc) => {
    const { _id, slug } =
      (doc ?? {}) as { _id?: unknown; slug?: { current?: unknown } | null };
    const id = typeof _id === "string" ? _id : undefined;
    const current = typeof slug?.current === "string" ? slug.current : undefined;
    return !isFictionalId(type, id) && !isFictionalSlug(type, current);
  });
}

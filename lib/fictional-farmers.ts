/**
 * Fictional / placeholder farmer deny-list.
 *
 * The production Sanity dataset still contains fictional farmer documents that
 * were persisted by the development seed scripts:
 *   - scripts/seed-farmers.ts       (青山 修一 / 陳 玉芬 / ラジャン・メータ)
 *   - scripts/seed-dummy-content.ts (山田農園 / 田中茶園)
 *
 * These docs describe invented individuals ("Fictional profiles — no real
 * personal data") that do NOT correspond to elxea's real suppliers, yet they
 * currently render publicly on /farmers. Until the real producer stories are
 * approved for publication, we hide them at the read layer WITHOUT touching
 * Sanity data (no draft/unpublish, no deletes) so the change is fully
 * reversible in code and carries zero data-mutation risk.
 *
 * This is a DENY-LIST by fixed `_id` / slug: it only ever hides these known
 * fictional documents. Any real farmer added later is unaffected and shows
 * normally, so there is no risk of accidentally hiding a genuine producer.
 */

/** Fixed Sanity `_id`s of the known fictional farmer documents. */
export const FICTIONAL_FARMER_IDS: ReadonlySet<string> = new Set([
  // scripts/seed-farmers.ts
  "farmer-aoyama-shuichi",
  "farmer-chen-yufen",
  "farmer-rajan-mehta",
  // scripts/seed-dummy-content.ts
  "farmer-yamada",
  "farmer-tanaka",
]);

/** Fixed slugs of the known fictional farmer documents (detail-route / sitemap). */
export const FICTIONAL_FARMER_SLUGS: ReadonlySet<string> = new Set([
  // scripts/seed-farmers.ts
  "aoyama-shuichi",
  "chen-yufen",
  "rajan-mehta",
  // scripts/seed-dummy-content.ts
  "yamada-farm",
  "tanaka-tea-garden",
]);

/** True when an `_id` belongs to a known fictional farmer document. */
export function isFictionalFarmerId(id: string | null | undefined): boolean {
  return typeof id === "string" && FICTIONAL_FARMER_IDS.has(id);
}

/** True when a slug belongs to a known fictional farmer document. */
export function isFictionalFarmerSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && FICTIONAL_FARMER_SLUGS.has(slug);
}

/**
 * Remove known fictional farmers from a fetched list. Matches on either `_id`
 * or `slug.current` for defense in depth. Real farmers pass through untouched.
 */
export function filterOutFictionalFarmers<
  T extends { _id?: string; slug?: { current?: string } },
>(farmers: T[] | null | undefined): T[] {
  const list = farmers ?? [];
  return list.filter(
    (f) =>
      !isFictionalFarmerId(f._id) &&
      !isFictionalFarmerSlug(f.slug?.current),
  );
}

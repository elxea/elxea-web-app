/**
 * scratch: apply provisional relatedProducts (Shopify handles) to Sanity articles.
 * pnpm tsx scripts/scratch/relprod-apply.ts --dry-run
 * pnpm tsx scripts/scratch/relprod-apply.ts
 *
 * Only touches the relatedProducts field. Article bodies are never modified.
 *
 * Excluded from the candidate pool (documented policy):
 *  - subscription handles (tea-sub-g-fp / tea-sub-b-fp / subscription-plan_sohi_first-purchase-v2)
 *  - products whose Shopify description is 【準備中】 (tea-ats-g-04 / b-05 / o-03 / o-04 / o-05)
 */
import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

const cfg = JSON.parse(
  readFileSync(join(process.env.HOME || "", ".config/sanity/config.json"), "utf-8")
);

const sanity = createClient({
  projectId: "5s8ahx87",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: false,
  token: cfg.authToken,
});

const ALLOWED = new Set([
  "tea-ats-g-01",
  "tea-ats-g-02",
  "tea-ats-g-03",
  "tea-ats-g-05",
  "tea-ats-b-01",
  "tea-ats-b-02",
  "tea-ats-b-03",
  "tea-ats-b-04",
  "tea-ats-o-01",
  "tea-ats-o-02",
]);

// slug -> handles (empty array = intentionally unlinked)
const MAP: Record<string, string[]> = {
  "autumn-outdoor-tea-ceremony-matcha": [],
  "chiran-fukamushi-tea-kagoshima": ["tea-ats-g-01", "tea-ats-g-05"],
  "homemade-hojicha-latte-recipe-guide": [],
  "japanese-sweets-tea-pairing-seasonal": ["tea-ats-g-01", "tea-ats-g-03", "tea-ats-b-02"],
  "makinohara-tea-region-shizuoka": ["tea-ats-g-01", "tea-ats-g-03"],
  "matcha-tiramisu-east-meets-west-dessert": [],
  "mizudashi-green-tea-summer-afternoon": ["tea-ats-g-01", "tea-ats-g-03"],
  "oolong-tea-braised-pork-belly-recipe": ["tea-ats-o-01", "tea-ats-o-02"],
  "seasonal-japanese-tea-nijushi-sekki": ["tea-ats-g-01", "tea-ats-b-04", "tea-ats-o-01"],
  "tea-and-ambient-music-harmony": ["tea-ats-g-01", "tea-ats-g-02", "tea-ats-g-03"],
  "tea-culture-around-the-world": ["tea-ats-g-01", "tea-ats-b-01", "tea-ats-o-01"],
  "tea-fields-four-seasons-365days": ["tea-ats-g-02", "tea-ats-g-05"],
  "tea-gift-guide-for-special-people": ["tea-ats-g-01", "tea-ats-b-02", "tea-ats-o-01"],
  "tea-journey-single-origin-terroir": ["tea-ats-g-05", "tea-ats-o-02"],
  "tea-time-as-luxury-slow-life-practice": ["tea-ats-g-01", "tea-ats-o-02"],
  "three-generation-tea-farmer-organic-conversion-challenge": ["tea-ats-g-05"],
  "tsushima-oishi-farm-interview": [],
  "uji-tea-master-good-tea-quality": ["tea-ats-g-01", "tea-ats-g-03"],
  "wazuka-tea-fields-walk-kyoto": [],
  "winter-solstice-warming-tea-guide": ["tea-ats-b-01", "tea-ats-b-03", "tea-ats-o-02"],
  "winter-wazuka-tea-fields": [],
  "women-tea-farmers-perspective-gender": [],
};

const dry = process.argv.includes("--dry-run");

async function main() {
  // guard: no handle outside the vetted pool, max 3 per article
  for (const [slug, hs] of Object.entries(MAP)) {
    if (hs.length > 3) throw new Error(`${slug}: more than 3 handles`);
    for (const h of hs) if (!ALLOWED.has(h)) throw new Error(`${slug}: handle not allowed: ${h}`);
  }

  const docs: { _id: string; slug: string }[] = await sanity.fetch(
    `*[_type == "article"]{_id, "slug": slug.current}`
  );
  const bySlug = new Map(docs.map((d) => [d.slug, d._id]));

  const missing = Object.keys(MAP).filter((s) => !bySlug.has(s));
  if (missing.length) throw new Error(`slug not found in Sanity: ${missing.join(", ")}`);
  const unmapped = docs.filter((d) => !(d.slug in MAP)).map((d) => d.slug);
  if (unmapped.length) throw new Error(`article not covered by MAP: ${unmapped.join(", ")}`);

  let written = 0;
  let skipped = 0;
  const tx = sanity.transaction();
  for (const [slug, hs] of Object.entries(MAP)) {
    const id = bySlug.get(slug)!;
    if (hs.length === 0) {
      skipped++;
      console.log(`[SKIP-EMPTY] ${slug}`);
      continue;
    }
    written++;
    console.log(`[SET] ${slug} -> ${hs.join(", ")}`);
    if (!dry) tx.patch(id, (p) => p.set({ relatedProducts: hs }));
  }

  if (dry) {
    console.log(`\nDRY RUN: would set ${written} articles, leave ${skipped} empty`);
    return;
  }
  await tx.commit();
  console.log(`\ncommitted: ${written} articles set, ${skipped} left empty`);

  // verify
  const after = await sanity.fetch(
    `*[_type == "article"]|order(slug.current asc){"slug": slug.current, relatedProducts}`
  );
  const nonEmpty = after.filter(
    (a: { relatedProducts?: string[] }) => (a.relatedProducts || []).length > 0
  );
  console.log(`verified: ${nonEmpty.length}/${after.length} articles have relatedProducts`);
  for (const a of after) {
    console.log(`  ${a.slug}: ${JSON.stringify(a.relatedProducts ?? null)}`);
  }
}
main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

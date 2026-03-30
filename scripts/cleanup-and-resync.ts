/**
 * Cleanup old Sanity documents after category/tag migration.
 *
 * What needs cleanup:
 * - Old hash-based categories (notion-category-{hex12}) — replaced by slug-based IDs
 * - Old manual categories (cat-*) and tags (tag-*) — replaced by sync-generated docs
 * - Old manual articles (article-*) — not in Content Hub, orphaned data
 * - Journal documents that reference old articles
 *
 * Tags with notion-tag-{hex12} IDs do NOT need cleanup — they are the same IDs
 * that the sync script generates (hash is deterministic from title).
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

const envPath = join(process.cwd(), ".env");
const envContent = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const SANITY_PROJECT_ID = env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const SANITY_DATASET = env.NEXT_PUBLIC_SANITY_DATASET || "production";

const sanityConfigPath = join(process.env.HOME || "", ".config/sanity/config.json");
let sanityAuthToken = "";
try {
  const sanityConfig = JSON.parse(readFileSync(sanityConfigPath, "utf-8"));
  sanityAuthToken = sanityConfig.authToken;
} catch {
  console.error("Could not read Sanity CLI config.");
  process.exit(1);
}

const sanity = createClient({
  projectId: SANITY_PROJECT_ID!,
  dataset: SANITY_DATASET,
  apiVersion: "2024-01-01",
  useCdn: false,
  token: sanityAuthToken,
});

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Cleaning up old documents...\n`);

  const hashCatPattern = /^notion-category-[0-9a-f]{12}$/;

  const [categories, tags, oldArticles, journals] = await Promise.all([
    sanity.fetch<{ _id: string; title: string }[]>(`*[_type == "category"]{ _id, title }`),
    sanity.fetch<{ _id: string; title: string }[]>(`*[_type == "tag"]{ _id, title }`),
    sanity.fetch<{ _id: string; title: string }[]>(`*[_type == "article" && _id match "article-*"]{ _id, title }`),
    sanity.fetch<{ _id: string }[]>(`*[_type == "journal"]{ _id }`),
  ]);

  // Only hash-based categories and manual cat-* need deletion
  const oldHashCats = categories.filter(c => hashCatPattern.test(c._id));
  const oldManualCats = categories.filter(c => c._id.startsWith("cat-"));
  // Manual tag-* IDs need deletion too
  const oldManualTags = tags.filter(t => t._id.startsWith("tag-"));

  console.log("To delete:");
  console.log(`  ${journals.length} journals (reference old articles)`);
  console.log(`  ${oldArticles.length} old manual articles (article-*)`);
  console.log(`  ${oldHashCats.length} hash-based categories`);
  console.log(`  ${oldManualCats.length} manual categories (cat-*)`);
  console.log(`  ${oldManualTags.length} manual tags (tag-*)`);

  if (DRY_RUN) {
    for (const c of [...oldHashCats, ...oldManualCats]) console.log(`    cat: ${c._id} (${c.title})`);
    for (const t of oldManualTags) console.log(`    tag: ${t._id} (${t.title})`);
    for (const a of oldArticles) console.log(`    article: ${a._id} (${a.title})`);
    console.log("\n[DRY RUN] No changes made.");
    return;
  }

  // Delete in dependency order within a single transaction
  let tx = sanity.transaction();

  // 1. Journals first (they reference articles)
  for (const j of journals) tx = tx.delete(j._id);
  // 2. Old articles (they reference old cats/tags)
  for (const a of oldArticles) tx = tx.delete(a._id);
  // 3. Old categories
  for (const c of [...oldHashCats, ...oldManualCats]) tx = tx.delete(c._id);
  // 4. Old manual tags
  for (const t of oldManualTags) tx = tx.delete(t._id);

  const result = await tx.commit();
  console.log(`\nCleanup complete. Transaction: ${result.transactionId}`);
}

main().catch(console.error);

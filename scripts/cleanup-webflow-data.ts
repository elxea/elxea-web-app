/**
 * Cleanup script: Remove all Webflow-migrated data from Sanity
 * Run with: npx tsx scripts/cleanup-webflow-data.ts
 *
 * Deletes all article, category, tag, and author documents that were
 * created during the Webflow → Sanity migration (Phase 1-7).
 *
 * IMPORTANT: Run `npx sanity dataset export production backup-before-cleanup` first!
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

// Load env vars
const envPath = join(process.cwd(), ".env");
const envContent = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

// Get Sanity CLI auth token
const sanityConfigPath = join(
  process.env.HOME || "",
  ".config/sanity/config.json"
);
let authToken = "";
try {
  const sanityConfig = JSON.parse(readFileSync(sanityConfigPath, "utf-8"));
  authToken = sanityConfig.authToken;
} catch {
  console.error(
    "Could not read Sanity CLI config. Run `npx sanity login` first."
  );
  process.exit(1);
}

const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = env.NEXT_PUBLIC_SANITY_DATASET || "production";

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: "2024-01-01",
  useCdn: false,
  token: authToken,
});

const DRY_RUN = process.argv.includes("--dry-run");

async function cleanup() {
  if (DRY_RUN) {
    console.log("=== DRY RUN MODE (no deletions) ===\n");
  }

  console.log(`Cleaning up Sanity project: ${projectId} / ${dataset}`);
  console.log("---\n");

  // Query all documents by type
  const types = ["article", "category", "tag", "author"] as const;
  const counts: Record<string, number> = {};

  for (const type of types) {
    const docs = await client.fetch<{ _id: string; title?: string; name?: string }[]>(
      `*[_type == "${type}"]{ _id, title, name }`
    );

    counts[type] = docs.length;
    console.log(`${type}: ${docs.length} documents found`);

    for (const doc of docs) {
      const label = doc.title || doc.name || doc._id;
      if (DRY_RUN) {
        console.log(`  [dry-run] would delete: ${label}`);
      } else {
        await client.delete(doc._id);
        console.log(`  - deleted: ${label}`);
      }
    }
    console.log();
  }

  console.log("---");
  if (DRY_RUN) {
    console.log("DRY RUN complete. No documents were deleted.");
  } else {
    console.log("Cleanup complete!");
  }
  console.log(`  Articles: ${counts.article}`);
  console.log(`  Categories: ${counts.category}`);
  console.log(`  Tags: ${counts.tag}`);
  console.log(`  Authors: ${counts.author}`);
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});

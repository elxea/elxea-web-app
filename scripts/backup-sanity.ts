/**
 * Sanity dataset backup script.
 *
 * Exports the Sanity dataset to a local .tar.gz file using the
 * `sanity dataset export` CLI command.
 *
 * Usage:
 *   npx tsx scripts/backup-sanity.ts
 *   npx tsx scripts/backup-sanity.ts --dataset staging
 *   npx tsx scripts/backup-sanity.ts --output ./backups
 *
 * Requirements:
 *   - Sanity CLI installed (`pnpm add -D sanity` or global `npm i -g sanity`)
 *   - Logged in to Sanity CLI (`npx sanity login`)
 *   - NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET in .env (optional)
 *
 * Output:
 *   ./backups/sanity-{dataset}-{YYYY-MM-DD}.tar.gz
 *
 * Recovery procedure:
 *   See the "Recovery" section at the bottom of this file.
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

// ─── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PROJECT_ID =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "5s8ahx87";
const DATASET = getArg("--dataset", process.env.NEXT_PUBLIC_SANITY_DATASET || "production");
const OUTPUT_DIR = getArg("--output", join(process.cwd(), "backups"));

// ─── Helpers ──────────────────────────────────────────────────────────

function isoDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

function run(cmd: string, label: string): void {
  console.log(`\n[${label}] ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Sanity Dataset Backup ===");
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Dataset: ${DATASET}`);
  console.log(`Output:  ${OUTPUT_DIR}`);
  console.log("");

  ensureDir(OUTPUT_DIR);

  const filename = `sanity-${DATASET}-${isoDate()}.tar.gz`;
  const outputPath = join(OUTPUT_DIR, filename);

  // sanity dataset export <dataset> <outputFile> --overwrite
  // Exports all documents, assets, and drafts in the dataset.
  run(
    `npx sanity@latest dataset export ${DATASET} "${outputPath}" --overwrite`,
    "Export"
  );

  console.log(`\nBackup completed: ${outputPath}`);
  console.log(`\nTo verify the archive contents:`);
  console.log(`  tar -tzf "${outputPath}" | head -20`);
  console.log(`\nTo restore (see recovery procedure below):`);
  console.log(
    `  npx sanity dataset import "${outputPath}" ${DATASET} --replace`
  );
}

main().catch((err) => {
  console.error("\nBackup failed:", err.message);
  process.exit(1);
});

/*
 * ─── Recovery Procedure ───────────────────────────────────────────────
 *
 * IMPORTANT: Dataset import replaces ALL documents in the target dataset.
 * Always test with a separate dataset first before restoring to production.
 *
 * ## Step 1: Identify the backup file
 *   ls -la backups/sanity-production-*.tar.gz
 *
 * ## Step 2: Create a staging dataset (recommended)
 *   npx sanity dataset create staging-restore
 *
 * ## Step 3: Import to staging first
 *   npx sanity dataset import backups/sanity-production-YYYY-MM-DD.tar.gz staging-restore --replace
 *
 * ## Step 4: Verify content in Sanity Studio
 *   npx sanity start
 *   # Navigate to the staging-restore dataset in Studio settings
 *
 * ## Step 5: Restore to production (if confirmed correct)
 *   npx sanity dataset import backups/sanity-production-YYYY-MM-DD.tar.gz production --replace
 *   # This operation is IRREVERSIBLE for any content created after the backup date.
 *   # Confirm with the team before proceeding.
 *
 * ## Notes
 * - Asset files (images) are included in the .tar.gz export.
 * - Drafts are included unless --no-drafts flag is used.
 * - Sanity import is idempotent for existing _id values (uses last-write-wins).
 */

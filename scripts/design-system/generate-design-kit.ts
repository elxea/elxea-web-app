/**
 * generate-design-kit.ts
 *
 * Generates the elxea Web App design-kit JSON from code.
 * Run: pnpm generate:design-kit
 *
 * Why this exists
 * ---------------
 * The design-kit used to be written by hand. A hand-written kit starts rotting
 * the moment it is saved: the same token ended up with two different values in
 * two different documents, and nothing detected it. Deriving the value sections
 * from the code makes that class of drift impossible rather than merely
 * discouraged.
 *
 * Outputs (both written; the first is what CI diffs against):
 *   1. scripts/design-system/design-kit.generated.json  — in-repo mirror,
 *      volatile fields normalized, committed. `pnpm validate:design-kit` fails
 *      the build when a regeneration does not reproduce it byte for byte.
 *   2. $DESIGN_KIT_OUTPUT (default:
 *      ~/.claude/progress/deliverables/elxea-web-app-design-kit.json)
 *      — the canonical deliverable per Design Ops Spec v18 §00, with the real
 *      timestamp and HEAD commit. Skipped when the directory does not exist
 *      (i.e. in CI), which is not an error.
 *
 * Hand-maintained input: scripts/design-system/design-kit.manual.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildKit,
  DELIVERABLE_PATH,
  MANUAL_PATH,
  REPO_MIRROR_PATH,
  serialize,
} from "./design-kit-lib.ts";

function main(): void {
  const stable = buildKit({ volatile: false });

  if (stable.collisions.length > 0) {
    console.error(
      "❌ ERROR: design-kit.manual.json が生成値と同じパスに値を書いている (手書きがコードを上書きしようとしている):",
    );
    for (const c of stable.collisions) console.error(`   - ${c}`);
    console.error(
      `\n   手動注記は生成側に存在しないキーだけを足せる。値そのものは ${MANUAL_PATH} に書かず、コード側 (tokens/*.json 等) を直すこと。`,
    );
    process.exit(1);
  }

  if (stable.manualMissingVerifiedAt.length > 0) {
    console.error(
      "❌ ERROR: 手動エントリに verified_at (最終確認日) が無い:",
    );
    for (const m of stable.manualMissingVerifiedAt) console.error(`   - ${m}`);
    process.exit(1);
  }

  writeFileSync(REPO_MIRROR_PATH, serialize(stable.kit));
  console.log(`✅ repo mirror  : ${REPO_MIRROR_PATH}`);

  const deliverable = buildKit({ volatile: true });
  const dir = dirname(DELIVERABLE_PATH);
  if (existsSync(dir)) {
    writeFileSync(DELIVERABLE_PATH, serialize(deliverable.kit));
    console.log(`✅ deliverable  : ${DELIVERABLE_PATH}`);
  } else if (process.env.DESIGN_KIT_OUTPUT) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(DELIVERABLE_PATH, serialize(deliverable.kit));
    console.log(`✅ deliverable  : ${DELIVERABLE_PATH} (dir created)`);
  } else {
    console.log(
      `ℹ️  deliverable skipped (${dir} not present — expected in CI)`,
    );
  }

  const counts = stable.kit.counts as Record<string, unknown>;
  console.log(
    `   tokens=${(stable.kit.tokens as Record<string, Record<string, unknown>>)._generated.token_count} ` +
      `components=${counts.code_ui_components} conflicts=${counts.conflicts} ` +
      `(auto=${counts.conflicts_auto_detected}/manual=${counts.conflicts_manual}) ` +
      `known_gaps=${counts.known_gaps}`,
  );
}

main();

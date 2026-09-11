/**
 * figma-snapshot.ts  (package.json: `snapshot:figma`)
 *
 * 経済化施策② の取得側。Proposals ページの @/<route> section subtree を Figma REST
 * API で取得し、決定論的に正規化した baseline snapshot を repo 内に書き出す。
 * このファイルを git に commit すると次回 diff の基準 (baseline) になる。
 *
 * ── これは検証の置換ではない ───────────────────────────────────────────────
 * snapshot / change-manifest は「どこが変わったか」を絞り込むだけのツール。
 * fidelity gate (EVIDENCE: fidelity-table) と ds-instance-report の検証義務は
 * 一切不変。「manifest に無い = 検証済み」と読み替えてはならない。
 *
 * Usage:
 *   npx tsx scripts/design-system/figma-snapshot.ts            # 既定 out に書く
 *   npx tsx scripts/design-system/figma-snapshot.ts --json     # stdout に JSON
 *   npx tsx scripts/design-system/figma-snapshot.ts --out path/to.json
 *   npx tsx scripts/design-system/figma-snapshot.ts --file-key XXXX
 *
 * Read-only (GET only). Token: .env.local FIGMA_PERSONAL_ACCESS_TOKEN.
 * Exit: 0=成功 / 1=致命 (token/API/ページ不在/部分取得)。fail-loud。
 * CI 非配線 (トークン不在の CI では fail するため。ローカル/反映セッション用)。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_FILE_KEY,
  buildSnapshot,
  fetchProposalSections,
  loadToken,
  serializeSnapshot,
} from "./figma-snapshot-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(__dirname, "snapshots/proposals.snapshot.json");

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const fileKey = argValue(args, "--file-key") || process.env.FIGMA_FILE_KEY || DEFAULT_FILE_KEY;
  const outPath = argValue(args, "--out") || DEFAULT_OUT;

  const token = loadToken();
  const fetched = await fetchProposalSections(fileKey, token);
  const snap = buildSnapshot(fetched, fileKey);
  const serialized = serializeSnapshot(snap);

  if (jsonMode) {
    process.stdout.write(serialized);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf-8");

  console.log(`figma-snapshot: wrote ${outPath}`);
  console.log(
    `  file: ${snap.file_name} / page: ${snap.meta.page.name} (last modified ${snap.meta.file_last_modified})`
  );
  console.log(
    `  routes: ${snap.counts.routes}, nodes: ${snap.counts.nodes}, excluded sections (no @/route): ${snap.counts.excluded_sections}`
  );
  if (snap.excluded.sections_without_route.length > 0) {
    console.log(`  excluded (reported, not silently dropped):`);
    for (const s of snap.excluded.sections_without_route) {
      console.log(`    - ${s.id} ${JSON.stringify(s.name)}`);
    }
  }
  console.log(
    `  NOTE: change-manifest narrows change candidates only — fidelity gate & ds-instance-report obligations unchanged.`
  );
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

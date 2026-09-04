/**
 * figma-change-manifest.ts  (package.json: `diff:figma`)
 *
 * 経済化施策② の差分側。live Figma を再取得して baseline snapshot と決定論 diff を
 * とり、変更ページ (route) / 変更 node を added/removed/modified で機械可読に出力する。
 * baseline は上書きしない (冪等: 変更が無ければ再実行しても diff=0)。baseline を
 * 進めたいときは figma-snapshot.ts を再実行して snapshot を commit し直す。
 *
 * ── これは検証の置換ではない (再掲・重要) ──────────────────────────────────
 * この manifest は「どこを見るべきか」を絞り込む CHANGE-CANDIDATE NARROWER。
 * fidelity gate (EVIDENCE: fidelity-table) と ds-instance-report の検証義務は不変。
 * 「manifest に無い = 検証済み・変更なし」と読み替えることは禁止。
 *
 * ── silent-drop 保護 (circl-qa 条件 C4) ────────────────────────────────────
 *   - baseline が壊れ JSON / 不在 → exit 1 (壊れた基準で「変更なし」と誤判定しない)。
 *   - live 取得が部分/失敗 → exit 1 (lib が throw)。
 *   - 除外 (対象外) node/section の件数と理由を manifest に明示 (silent truncation 禁止)。
 *   - completeness シグナル: file が baseline 以降に更新されているのに diff が空なら
 *     「変更が snapshot の捕捉外にある可能性」を警告する (belt-and-suspenders)。
 *     既定は警告 (out-of-scope な別ページ編集でも file lastModified は進むため
 *     hard-fail は誤検知源)。--strict-completeness で exit 1 に昇格できる。
 *
 * Usage:
 *   npx tsx scripts/design-system/figma-change-manifest.ts
 *   npx tsx scripts/design-system/figma-change-manifest.ts --json
 *   npx tsx scripts/design-system/figma-change-manifest.ts --baseline path/to.snapshot.json
 *   npx tsx scripts/design-system/figma-change-manifest.ts --out path/to.manifest.json
 *   npx tsx scripts/design-system/figma-change-manifest.ts --strict-completeness
 *
 * Read-only. Token: .env.local FIGMA_PERSONAL_ACCESS_TOKEN.
 * Exit: 0=成功 (diff 有無は問わない) / 1=致命 (baseline 壊れ/不在, API, 部分取得,
 *       または --strict-completeness で completeness 警告発火)。CI 非配線。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_FILE_KEY,
  buildSnapshot,
  diffSnapshots,
  fetchProposalSections,
  loadToken,
  stableStringify,
  type Snapshot,
} from "./figma-snapshot-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = resolve(__dirname, "snapshots/proposals.snapshot.json");
const DEFAULT_OUT = resolve(__dirname, "snapshots/change-manifest.json");

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function loadBaseline(path: string): Snapshot {
  if (!existsSync(path)) {
    throw new Error(
      `baseline snapshot not found at ${path}. Run \`pnpm snapshot:figma\` first to create it. ` +
        `(fail-loud: refusing to diff against a missing baseline — that would report every node as "added")`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(
      `baseline snapshot is not valid JSON (${path}): ${err instanceof Error ? err.message : err}`
    );
  }
  const s = parsed as Partial<Snapshot>;
  if (
    !s ||
    s.tool !== "figma-snapshot" ||
    typeof s.nodes !== "object" ||
    s.nodes === null ||
    !s.meta ||
    typeof s.meta.file_last_modified !== "string"
  ) {
    throw new Error(
      `baseline snapshot has unexpected shape (${path}): expected {tool:"figma-snapshot", meta.file_last_modified, nodes:{...}}. ` +
        `Refusing to diff a malformed baseline (silent-drop protection).`
    );
  }
  return s as Snapshot;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const strictCompleteness = args.includes("--strict-completeness");
  const fileKey = argValue(args, "--file-key") || process.env.FIGMA_FILE_KEY || DEFAULT_FILE_KEY;
  const baselinePath = argValue(args, "--baseline") || DEFAULT_BASELINE;
  const outPath = argValue(args, "--out") || DEFAULT_OUT;

  const baseline = loadBaseline(baselinePath);

  const token = loadToken();
  const fetched = await fetchProposalSections(fileKey, token);
  const live = buildSnapshot(fetched, fileKey);

  const diff = diffSnapshots(baseline.nodes, live.nodes);

  // 変更のあった route を集約 (added/removed/modified から)。
  const changedRoutes = [
    ...new Set([
      ...diff.added.map((n) => n.route),
      ...diff.removed.map((n) => n.route),
      ...diff.modified.map((n) => n.route),
    ]),
  ].sort();

  const diffEmpty =
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.modified.length === 0;
  const fileChangedSinceBaseline =
    live.meta.file_last_modified !== baseline.meta.file_last_modified;

  // completeness シグナル (C4): file は進んだのに diff 空 = 捕捉外の変更の疑い。
  const completenessWarning =
    fileChangedSinceBaseline && diffEmpty
      ? `Figma file lastModified advanced (${baseline.meta.file_last_modified} → ${live.meta.file_last_modified}) but the deterministic diff is EMPTY. ` +
        `The change may be outside the @/<route> snapshot scope, OR a class the snapshot does not capture (variable value not affecting resolved paint, branch edits, etc.). ` +
        `Do NOT treat this as "no change" — inspect the file manually. (silent-drop guard)`
      : null;

  const manifest = {
    tool: "figma-change-manifest",
    schema_version: 1 as const,
    disclaimer:
      "CHANGE-CANDIDATE NARROWER ONLY. Narrows where to look; does NOT discharge verification. fidelity gate (EVIDENCE: fidelity-table) と ds-instance-report の検証義務は不変。'manifest に無い = 検証済み' と読み替えない。",
    file_key: fileKey,
    file_name: live.file_name,
    generated_at: new Date().toISOString(),
    baseline: {
      path: baselinePath,
      captured_at: baseline.meta.captured_at,
      file_last_modified: baseline.meta.file_last_modified,
      nodes: Object.keys(baseline.nodes).length,
    },
    live: {
      fetched_at: live.meta.captured_at,
      file_last_modified: live.meta.file_last_modified,
      nodes: live.counts.nodes,
    },
    changed_routes: changedRoutes,
    added: diff.added,
    removed: diff.removed,
    modified: diff.modified,
    // 対象外 (silent truncation 禁止): frozen-sections.json に載らない Layouts 直下 section。
    excluded: {
      reason: live.excluded.reason,
      sections_without_route: live.excluded.sections_without_route,
      count: live.excluded.sections_without_route.length,
    },
    completeness: {
      file_changed_since_baseline: fileChangedSinceBaseline,
      diff_empty: diffEmpty,
      warning: completenessWarning,
    },
    counts: {
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      unchanged: diff.unchanged,
      changed_routes: changedRoutes.length,
      excluded_sections: live.excluded.sections_without_route.length,
      baseline_nodes: Object.keys(baseline.nodes).length,
      live_nodes: live.counts.nodes,
    },
  };

  const serialized = stableStringify(manifest, 2) + "\n";

  if (jsonMode) {
    process.stdout.write(serialized);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serialized, "utf-8");
    console.log(`figma-change-manifest: wrote ${outPath}`);
    console.log(
      `  added: ${manifest.counts.added}, removed: ${manifest.counts.removed}, modified: ${manifest.counts.modified}, unchanged: ${manifest.counts.unchanged}`
    );
    console.log(
      `  changed routes (${changedRoutes.length}): ${changedRoutes.join(", ") || "(none)"}`
    );
    console.log(
      `  excluded sections (not in frozen-sections.json, reported): ${manifest.counts.excluded_sections}`
    );
    if (completenessWarning) {
      console.log(`  [WARN] completeness: ${completenessWarning}`);
    }
    console.log(
      `  NOTE: narrows change candidates only — fidelity gate & ds-instance-report obligations unchanged.`
    );
  }

  if (completenessWarning && strictCompleteness) {
    console.error(
      "Error: completeness warning under --strict-completeness → exit 1 (silent-drop guard)."
    );
    process.exit(1);
  }
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

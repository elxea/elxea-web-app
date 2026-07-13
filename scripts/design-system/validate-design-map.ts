/**
 * validate-design-map.ts
 *
 * Validates scripts/design-system/design-map.json — the Figma node ⇄ code path
 * correspondence table that lets automation edit the *correct* source file for a
 * given Figma component (Decision Log 39c70c9d064c81079145f69744e7b8f5, 施策①).
 *
 * SoT policy (案 B): Code is the source of truth; Figma is reference. This map is
 * a lookup index, not a second store of values — so validation is purely
 * existence/shape checking (no value duplication).
 *
 * Two modes:
 *   1. static (default)  — schema shape + code_path exists on disk. NO network.
 *      Wired into CI `static-checks` (package.json `validate:design-map`), same
 *      shape as `validate:tokens`. Runs offline so CI needs no Figma token.
 *   2. --figma           — additionally verifies every non-null figma_node_id
 *      resolves to a live node via ONE batched Figma nodes API call (chunked).
 *      This is the "鮮度検証 (freshness)" the design-drift weekly detector runs
 *      (~/.config/admin-pipeline/scripts/drift-audit-design.sh 検査④). Requires
 *      FIGMA_PERSONAL_ACCESS_TOKEN in .env.local (read-only GET only).
 *
 * Flags:
 *   --figma   enable Figma node existence check (needs token)
 *   --json    emit machine-readable JSON report (for the shell detector)
 *
 * Exit codes: 0 = all green (0 mismatches) / 1 = schema error, missing code_path,
 * or (with --figma) a figma_node_id that no longer resolves. Fail-loud.
 *
 * Rationale for freshness (quality-audit condition): a stale map makes an AI
 * "confidently edit the wrong file". Wiring the node-existence check into the
 * existing weekly detector makes drift detected, not silently trusted.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const MAP_PATH = resolve(__dirname, "design-map.json");

const FIGMA_API_BASE = "https://api.figma.com";
const NODE_ID_RE = /^\d+:\d+$/;
const VALID_KINDS = new Set(["ds-component", "module", "shadcn"]);

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------

const errors: string[] = [];
const warnings: string[] = [];

function error(where: string, msg: string) {
  errors.push(`ERROR: [${where}] ${msg}`);
}
function warn(where: string, msg: string) {
  warnings.push(`WARNING: [${where}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Entry {
  figma_node_id: string | null;
  figma_name: string;
  code_path: string;
  kind: string;
  notes?: string;
}

interface DesignMap {
  description?: string;
  figma_file_key?: string;
  updated_at?: string;
  conventions?: Record<string, unknown>;
  entries?: Entry[];
}

// ---------------------------------------------------------------------------
// Figma token loader (same method as figma-ds-instance-rate.ts)
// ---------------------------------------------------------------------------

function loadToken(): string {
  const envPath = resolve(ROOT, ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    console.error("Error: .env.local not found at", envPath, "(needed for --figma)");
    process.exit(1);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "FIGMA_PERSONAL_ACCESS_TOKEN") return value;
  }
  console.error("Error: FIGMA_PERSONAL_ACCESS_TOKEN not found in .env.local (needed for --figma)");
  process.exit(1);
}

interface FigmaNodesResponse {
  nodes: Record<string, { document?: { id: string } } | null>;
}

async function figmaNodesExist(
  fileKey: string,
  ids: string[],
  token: string
): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await fetch(
      `${FIGMA_API_BASE}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(chunk.join(","))}`,
      { headers: { "X-Figma-Token": token } }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Figma API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as FigmaNodesResponse;
    for (const id of chunk) {
      const entry = data.nodes[id];
      if (entry && entry.document && entry.document.id === id) found.add(id);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Static validation (schema + code_path existence)
// ---------------------------------------------------------------------------

function validateStatic(map: DesignMap): Entry[] {
  if (!Array.isArray(map.entries) || map.entries.length === 0) {
    error("root", "`entries` must be a non-empty array");
    return [];
  }
  if (!map.figma_file_key || typeof map.figma_file_key !== "string") {
    error("root", "`figma_file_key` (string) is required");
  }

  const seenNodeIds = new Map<string, number>();
  const seenCodePaths = new Map<string, number>();

  map.entries.forEach((e, i) => {
    const at = `entries[${i}]${e.figma_name ? ` ${e.figma_name}` : ""}`;

    // required string fields
    if (typeof e.figma_name !== "string" || !e.figma_name.trim())
      error(at, "`figma_name` (non-empty string) is required");
    if (typeof e.code_path !== "string" || !e.code_path.trim())
      error(at, "`code_path` (non-empty string) is required");
    if (typeof e.kind !== "string" || !VALID_KINDS.has(e.kind))
      error(at, `\`kind\` must be one of ${[...VALID_KINDS].join(" | ")} (got ${JSON.stringify(e.kind)})`);

    // figma_node_id: null allowed ONLY for shadcn (name 1:1 convention); else must match N:M
    if (e.figma_node_id === null || e.figma_node_id === undefined) {
      if (e.kind !== "shadcn")
        error(at, "`figma_node_id` may be null only for kind=shadcn (name 1:1 convention)");
    } else if (typeof e.figma_node_id !== "string" || !NODE_ID_RE.test(e.figma_node_id)) {
      error(at, `\`figma_node_id\` must match /\\d+:\\d+/ or be null (got ${JSON.stringify(e.figma_node_id)})`);
    } else {
      const prev = seenNodeIds.get(e.figma_node_id);
      if (prev !== undefined)
        error(at, `duplicate figma_node_id ${e.figma_node_id} (also entries[${prev}])`);
      else seenNodeIds.set(e.figma_node_id, i);
    }

    // code_path existence (resolve from repo root)
    if (typeof e.code_path === "string" && e.code_path.trim()) {
      const abs = resolve(ROOT, e.code_path);
      if (!existsSync(abs)) error(at, `code_path does not exist on disk: ${e.code_path}`);
      const prev = seenCodePaths.get(e.code_path);
      if (prev !== undefined)
        warn(at, `code_path ${e.code_path} also mapped by entries[${prev}] (multiple Figma nodes → one file is allowed but note it)`);
      else seenCodePaths.set(e.code_path, i);
    }
  });

  return map.entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const figmaMode = args.includes("--figma");
  const jsonMode = args.includes("--json");

  if (!existsSync(MAP_PATH)) {
    const msg = `design-map.json not found at ${MAP_PATH}`;
    if (jsonMode) console.log(JSON.stringify({ status: "error", errors: [msg], warnings: [], checked: 0, figma_checked: 0, mismatches: 1 }));
    else console.error("ERROR:", msg);
    process.exit(1);
  }

  let map: DesignMap;
  try {
    map = JSON.parse(readFileSync(MAP_PATH, "utf-8")) as DesignMap;
  } catch (err) {
    const msg = `design-map.json is not valid JSON: ${err instanceof Error ? err.message : err}`;
    if (jsonMode) console.log(JSON.stringify({ status: "error", errors: [msg], warnings: [], checked: 0, figma_checked: 0, mismatches: 1 }));
    else console.error("ERROR:", msg);
    process.exit(1);
  }

  const entries = validateStatic(map);

  let figmaChecked = 0;
  if (figmaMode && errors.length === 0) {
    const fileKey = map.figma_file_key!;
    const ids = entries
      .map((e) => e.figma_node_id)
      .filter((id): id is string => typeof id === "string" && NODE_ID_RE.test(id));
    const uniqueIds = [...new Set(ids)];
    try {
      const token = loadToken();
      const found = await figmaNodesExist(fileKey, uniqueIds, token);
      figmaChecked = uniqueIds.length;
      for (const e of entries) {
        if (typeof e.figma_node_id === "string" && NODE_ID_RE.test(e.figma_node_id) && !found.has(e.figma_node_id)) {
          error(
            `${e.figma_name} (${e.figma_node_id})`,
            `figma_node_id no longer resolves in file ${fileKey} — map is stale (delete/rename/renumber)`
          );
        }
      }
    } catch (err) {
      error("figma", `node existence check failed (実行不能): ${err instanceof Error ? err.message : err}`);
    }
  } else if (figmaMode) {
    warn("figma", "skipped Figma node check because static validation already failed");
  }

  const status = errors.length > 0 ? "error" : "ok";
  const mismatches = errors.length;

  if (jsonMode) {
    console.log(
      JSON.stringify({
        status,
        tool: "validate-design-map",
        figma_mode: figmaMode,
        checked: entries.length,
        figma_checked: figmaChecked,
        mismatches,
        errors,
        warnings,
      })
    );
  } else {
    for (const w of warnings) console.log(w);
    for (const e of errors) console.log(e);
    console.log("");
    if (errors.length === 0) {
      console.log(
        `OK: design-map valid — ${entries.length} entries checked` +
          (figmaMode ? `, ${figmaChecked} figma nodes verified live` : " (static: schema + code_path)")
      );
    } else {
      console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s), ${entries.length} entries checked`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

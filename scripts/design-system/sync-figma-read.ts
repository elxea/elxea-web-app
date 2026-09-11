/**
 * sync-figma-read.ts
 *
 * Reads Figma file structure, styles, and components via the REST API
 * and outputs a human-readable report or JSON.
 *
 * Usage:
 *   npx tsx scripts/design-system/sync-figma-read.ts
 *   npx tsx scripts/design-system/sync-figma-read.ts --json
 *   FIGMA_FILE_KEY=xxx npx tsx scripts/design-system/sync-figma-read.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// elxea Design System 正本ファイル (Setaka 承認済, Decision Log 36f70c9d)。
// 旧ファイル alDl0i3hZvRlqCxH9Li5Q4 は使用しない。
const DEFAULT_FILE_KEY = "AWLnI0XF07e8rScuxPYPc7";
const FIGMA_API_BASE = "https://api.figma.com";

// ---------------------------------------------------------------------------
// Token loader
// ---------------------------------------------------------------------------

function loadToken(): string {
  const envPath = resolve(process.cwd(), ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    console.error("Error: .env.local not found at", envPath);
    process.exit(1);
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "FIGMA_PERSONAL_ACCESS_TOKEN") return value;
  }

  console.error("Error: FIGMA_PERSONAL_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Figma API helpers
// ---------------------------------------------------------------------------

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const url = `${FIGMA_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types (minimal subset)
// ---------------------------------------------------------------------------

interface FigmaFileResponse {
  name: string;
  lastModified: string;
  document: {
    children: Array<{ id: string; name: string; type: string }>;
  };
}

interface FigmaStyleMeta {
  key: string;
  name: string;
  style_type: string;
  description: string;
}

interface FigmaStylesResponse {
  meta: { styles: FigmaStyleMeta[] };
}

interface FigmaComponentMeta {
  key: string;
  name: string;
  description: string;
  containing_frame?: { name: string };
}

interface FigmaComponentsResponse {
  meta: { components: FigmaComponentMeta[] };
}

interface ReportData {
  fileName: string;
  lastModified: string;
  pages: Array<{ id: string; name: string }>;
  styles: Array<{ name: string; type: string }>;
  components: Array<{ name: string; description: string }>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const fileKey =
    args.find((a) => !a.startsWith("--")) ||
    process.env.FIGMA_FILE_KEY ||
    DEFAULT_FILE_KEY;

  const token = loadToken();

  // Fetch all three endpoints in parallel
  const [fileData, stylesData, componentsData] = await Promise.all([
    figmaGet<FigmaFileResponse>(`/v1/files/${fileKey}?depth=1`, token),
    figmaGet<FigmaStylesResponse>(`/v1/files/${fileKey}/styles`, token),
    figmaGet<FigmaComponentsResponse>(
      `/v1/files/${fileKey}/components`,
      token
    ),
  ]);

  const report: ReportData = {
    fileName: fileData.name,
    lastModified: fileData.lastModified,
    pages: fileData.document.children.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    styles: stylesData.meta.styles.map((s) => ({
      name: s.name,
      type: s.style_type,
    })),
    components: componentsData.meta.components.map((c) => ({
      name: c.name,
      description: c.description,
    })),
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  const lines: string[] = [];

  lines.push("");
  lines.push("\u{1F4CA} Figma File Report");
  lines.push("====================");
  lines.push(`File: ${report.fileName}`);
  lines.push(`Last modified: ${report.lastModified}`);

  lines.push("");
  lines.push(`\u{1F4C4} Pages (${report.pages.length}):`);
  for (const p of report.pages) {
    lines.push(`  - ${p.name}`);
  }

  lines.push("");
  lines.push(`\u{1F3A8} Styles (${report.styles.length}):`);
  for (const s of report.styles) {
    lines.push(`  - ${s.name} (${s.type})`);
  }

  lines.push("");
  lines.push(`\u{1F9E9} Components (${report.components.length}):`);
  for (const c of report.components) {
    lines.push(`  - ${c.name}`);
  }

  lines.push("");
  lines.push(
    `\u{1F4C8} Summary: ${report.pages.length} pages, ${report.styles.length} styles, ${report.components.length} components`
  );

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

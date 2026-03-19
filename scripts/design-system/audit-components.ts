/**
 * audit-components.ts
 *
 * Scans components/ui/ for all component files and reports
 * where each component is imported across the codebase.
 *
 * Usage: npx tsx scripts/design-system/audit-components.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const UI_DIR = path.join(ROOT, "components/ui");

// 1. Collect all component file names (excluding stories)
const uiFiles = fs
  .readdirSync(UI_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".stories."));

// 2. Extract exported component names from each file
interface ComponentInfo {
  file: string; // e.g. "button.tsx"
  slug: string; // e.g. "button"
  exportedNames: string[];
  importedBy: string[];
}

function extractExportedNames(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const names: string[] = [];

  // Match: export { Foo, Bar, Baz }
  const reExportBlock = /export\s*\{([^}]+)\}/g;
  for (const m of content.matchAll(reExportBlock)) {
    const items = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim());
    names.push(...items.filter(Boolean));
  }

  // Match: export function Foo / export const Foo / export default function Foo
  const reExportDecl =
    /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/g;
  for (const m of content.matchAll(reExportDecl)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }

  return names;
}

const components: ComponentInfo[] = uiFiles.map((file) => {
  const slug = file.replace(/\.tsx$/, "");
  const exportedNames = extractExportedNames(path.join(UI_DIR, file));
  return { file, slug, exportedNames, importedBy: [] };
});

// 3. Collect all .tsx/.ts files under app/ and components/ then search for imports
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

const searchDirs = [path.join(ROOT, "app"), path.join(ROOT, "components")];
const allFiles = searchDirs.flatMap((d) => collectFiles(d, [".tsx", ".ts"]));

// Pre-read all files once and build a map of file -> content
const fileContents = new Map<string, string>();
for (const file of allFiles) {
  fileContents.set(file, fs.readFileSync(file, "utf-8"));
}

function findImporters(slug: string): string[] {
  const importPattern = new RegExp(
    `from\\s+["']@/components/ui/${slug}["']|from\\s+["'][.][.].*components/ui/${slug}["']`,
  );
  const results: string[] = [];
  for (const [file, content] of fileContents) {
    const rel = path.relative(ROOT, file);
    // Exclude the component's own file and its stories file
    if (
      rel === `components/ui/${slug}.tsx` ||
      rel === `components/ui/${slug}.stories.tsx`
    ) {
      continue;
    }
    if (importPattern.test(content)) {
      results.push(rel);
    }
  }
  return results;
}

for (const comp of components) {
  comp.importedBy = findImporters(comp.slug);
}

// 4. Classify and print report
const active = components
  .filter((c) => c.importedBy.length > 0)
  .sort((a, b) => b.importedBy.length - a.importedBy.length);
const unused = components
  .filter((c) => c.importedBy.length === 0)
  .sort((a, b) => a.slug.localeCompare(b.slug));

console.log("");
console.log("Component Usage Audit");
console.log("========================");
console.log("");

if (active.length > 0) {
  console.log("Active (used in app/ or components/):");
  const maxNameLen = Math.max(...active.map((c) => c.slug.length));
  for (const comp of active) {
    const preview = comp.importedBy.slice(0, 3).join(", ");
    const more = comp.importedBy.length > 3 ? `, ... (+${comp.importedBy.length - 3})` : "";
    console.log(
      `  ${comp.slug.padEnd(maxNameLen)}  -> ${comp.importedBy.length} files (${preview}${more})`,
    );
  }
}

console.log("");

if (unused.length > 0) {
  console.log("Unused (0 imports):");
  for (const comp of unused) {
    console.log(`  ${comp.slug}`);
  }
}

console.log("");
console.log(
  `Summary: ${active.length}/${components.length} components actively used`,
);
console.log("");

/**
 * diff-tokens.ts
 *
 * Compares tokens/base.json against a git ref and displays
 * a human-readable summary of added, modified, and removed tokens.
 *
 * Usage:
 *   npx tsx scripts/design-system/diff-tokens.ts          # compare vs HEAD
 *   npx tsx scripts/design-system/diff-tokens.ts HEAD~3   # compare vs HEAD~3
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TOKEN_FILE = "tokens/base.json";

const ref = process.argv[2] || "HEAD";

// ---------------------------------------------------------------------------
// 1. Get the old version of tokens/base.json from git
// ---------------------------------------------------------------------------
function getOldTokens(): Record<string, unknown> | null {
  try {
    const raw = execSync(`git -C ${ROOT} show ${ref}:${TOKEN_FILE}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch {
    // File did not exist at that ref
    return null;
  }
}

function getCurrentTokens(): Record<string, unknown> | null {
  try {
    const raw = execSync(`git -C ${ROOT} show HEAD:${TOKEN_FILE}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Flatten nested token object into dot-path -> $value map
// ---------------------------------------------------------------------------
type FlatTokens = Map<string, string>;

function flatten(
  obj: Record<string, unknown>,
  prefix: string = "",
  result: FlatTokens = new Map(),
): FlatTokens {
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("$")) continue; // skip $type, $description etc.
    const path = prefix ? `${prefix}/${key}` : key;
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      "$value" in (val as Record<string, unknown>)
    ) {
      const v = (val as Record<string, unknown>)["$value"];
      result.set(path, typeof v === "object" ? JSON.stringify(v) : String(v));
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      flatten(val as Record<string, unknown>, path, result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Compute diff
// ---------------------------------------------------------------------------
interface TokenDiff {
  added: Array<{ path: string; value: string }>;
  modified: Array<{ path: string; oldValue: string; newValue: string }>;
  removed: Array<{ path: string }>;
}

function computeDiff(oldFlat: FlatTokens, newFlat: FlatTokens): TokenDiff {
  const added: TokenDiff["added"] = [];
  const modified: TokenDiff["modified"] = [];
  const removed: TokenDiff["removed"] = [];

  for (const [path, newVal] of newFlat) {
    if (!oldFlat.has(path)) {
      added.push({ path, value: newVal });
    } else if (oldFlat.get(path) !== newVal) {
      modified.push({ path, oldValue: oldFlat.get(path)!, newValue: newVal });
    }
  }

  for (const [path] of oldFlat) {
    if (!newFlat.has(path)) {
      removed.push({ path });
    }
  }

  return { added, modified, removed };
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------
async function main() {
  const oldTokens = getOldTokens();

  // For current state: use working tree if ref is HEAD, otherwise use HEAD from git
  let currentTokens: Record<string, unknown> | null;
  if (ref === "HEAD") {
    try {
      const raw = fs.readFileSync(path.join(ROOT, TOKEN_FILE), "utf-8");
      currentTokens = JSON.parse(raw);
    } catch {
      currentTokens = null;
    }
  } else {
    currentTokens = getCurrentTokens();
  }

  if (!oldTokens && !currentTokens) {
    console.log("No token file found at either ref.");
    process.exit(1);
  }

  if (!oldTokens) {
    console.log(`Token file did not exist at ${ref}. All tokens are new.`);
    if (currentTokens) {
      const flat = flatten(currentTokens);
      console.log(`\nTotal tokens: ${flat.size}`);
    }
    process.exit(0);
  }

  if (!currentTokens) {
    console.log("Current token file not found.");
    process.exit(1);
  }

  const oldFlat = flatten(oldTokens);
  const newFlat = flatten(currentTokens);
  const diff = computeDiff(oldFlat, newFlat);

  const totalChanges = diff.added.length + diff.modified.length + diff.removed.length;

  if (totalChanges === 0) {
    console.log("");
    console.log("No token changes");
    console.log("");
    process.exit(0);
  }

  console.log("");
  console.log(`Token Changes (vs ${ref})`);
  console.log("===========================");
  console.log("");

  if (diff.added.length > 0) {
    console.log("Added:");
    for (const { path, value } of diff.added) {
      console.log(`  + ${path}: ${value}`);
    }
    console.log("");
  }

  if (diff.modified.length > 0) {
    console.log("Modified:");
    for (const { path, oldValue, newValue } of diff.modified) {
      console.log(`  ~ ${path}: ${oldValue} -> ${newValue}`);
    }
    console.log("");
  }

  if (diff.removed.length > 0) {
    console.log("Removed:");
    for (const { path } of diff.removed) {
      console.log(`  - ${path}: (removed)`);
    }
    console.log("");
  }

  console.log(
    `Summary: ${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed`,
  );
  console.log("");
}

main();

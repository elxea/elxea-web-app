/**
 * validate-tokens.ts
 *
 * Validates tokens/base.json (and overrides) against W3C DTCG format rules.
 * Run: npx tsx scripts/design-system/validate-tokens.ts
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
const BASE_PATH = resolve(ROOT, "tokens/base.json");
const CJK_PATH = resolve(ROOT, "tokens/overrides/cjk.json");

// ---------------------------------------------------------------------------
// DTCG valid types
// ---------------------------------------------------------------------------

const VALID_DTCG_TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "string",
  "composite",
  "shadow",
  "typography",
]);

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------

const errors: string[] = [];
const warnings: string[] = [];
let tokenCount = 0;

function error(path: string, msg: string) {
  errors.push(`\u274C ERROR: [${path}] ${msg}`);
}

function warn(path: string, msg: string) {
  warnings.push(`\u26A0\uFE0F WARNING: [${path}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLeafNode(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  return "$value" in obj;
}

function isGroupNode(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  return !("$value" in obj);
}

/** Check if a string is kebab-case (allow digits-only keys like "0", "0.5", "2xl") */
function isKebabCase(key: string): boolean {
  // Digit-only (including decimals like "0.5") -- always allowed
  if (/^[\d.]+$/.test(key)) return true;
  // kebab-case: lowercase letters, digits, hyphens
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key);
}

function isCamelCase(key: string): boolean {
  return /^[a-z]+[A-Z]/.test(key);
}

/** Resolve the effective $type for a node by walking up the group hierarchy */
function resolveType(
  node: Record<string, unknown>,
  groupTypes: string[],
): string | undefined {
  if (typeof node.$type === "string") return node.$type;
  // Walk from innermost group outward
  for (let i = groupTypes.length - 1; i >= 0; i--) {
    if (groupTypes[i]) return groupTypes[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Value validators per $type
// ---------------------------------------------------------------------------

const COLOR_RE =
  /^(oklch\(.*\)|#[0-9a-fA-F]{3,8}|rgb\(.*\)|rgba\(.*\)|hsl\(.*\)|hsla\(.*\))$/;

const DIMENSION_RE = /^-?[\d.]+\s*(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|dvh|svh|lvh)$/;

const DURATION_RE = /^[\d.]+(ms|s)$/;

function validateValue(
  path: string,
  type: string,
  value: unknown,
): void {
  switch (type) {
    case "color": {
      if (typeof value === "string") {
        // Allow reference syntax
        if (value.startsWith("{") && value.endsWith("}")) break;
        if (!COLOR_RE.test(value.trim())) {
          warn(path, `color value "${value}" may not be a valid color format`);
        }
      } else {
        error(path, `color $value should be a string, got ${typeof value}`);
      }
      break;
    }
    case "dimension": {
      if (typeof value === "string") {
        if (value.startsWith("{") && value.endsWith("}")) break;
        if (!DIMENSION_RE.test(value.trim())) {
          warn(path, `dimension value "${value}" may not include a valid unit`);
        }
      } else {
        error(path, `dimension $value should be a string, got ${typeof value}`);
      }
      break;
    }
    case "fontFamily": {
      if (typeof value !== "string") {
        error(path, `fontFamily $value should be a string, got ${typeof value}`);
      }
      break;
    }
    case "fontWeight": {
      if (typeof value !== "string" && typeof value !== "number") {
        error(path, `fontWeight $value should be a string or number, got ${typeof value}`);
      }
      break;
    }
    case "duration": {
      if (typeof value === "string") {
        if (value.startsWith("{") && value.endsWith("}")) break;
        if (!DURATION_RE.test(value.trim())) {
          warn(path, `duration value "${value}" may not be a valid duration`);
        }
      } else {
        error(path, `duration $value should be a string, got ${typeof value}`);
      }
      break;
    }
    case "cubicBezier": {
      if (!Array.isArray(value) || value.length !== 4) {
        error(path, `cubicBezier $value should be an array of 4 numbers`);
      } else if (!value.every((v) => typeof v === "number")) {
        error(path, `cubicBezier $value array entries should all be numbers`);
      }
      break;
    }
    case "number": {
      const parsed = typeof value === "string" ? Number(value) : value;
      if (typeof parsed !== "number" || Number.isNaN(parsed)) {
        error(path, `number $value "${value}" is not a valid number`);
      }
      break;
    }
    case "shadow": {
      // Single shadow object or array of shadow objects
      const shadows = Array.isArray(value) ? value : [value];
      for (const s of shadows) {
        if (typeof s !== "object" || s === null) {
          error(path, `shadow $value entry should be an object`);
        }
      }
      break;
    }
    case "typography": {
      // Composite: should be an object with typography sub-properties
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        error(path, `typography $value should be an object`);
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        error(path, `string $value should be a string, got ${typeof value}`);
      }
      break;
    }
    case "composite": {
      if (typeof value !== "object" || value === null) {
        error(path, `composite $value should be an object`);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

function collectAllPaths(obj: unknown, prefix: string, paths: Set<string>): void {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (key.startsWith("$")) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    paths.add(p);
    collectAllPaths(val, p, paths);
  }
}

const REFERENCE_RE = /\{([^}]+)\}/g;

function checkReferences(
  value: unknown,
  path: string,
  allPaths: Set<string>,
): void {
  if (typeof value === "string") {
    let match: RegExpExecArray | null;
    REFERENCE_RE.lastIndex = 0;
    while ((match = REFERENCE_RE.exec(value)) !== null) {
      const ref = match[1];
      if (!allPaths.has(ref)) {
        error(path, `reference {${ref}} does not resolve to an existing token`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main walk
// ---------------------------------------------------------------------------

function walkTokens(
  obj: Record<string, unknown>,
  path: string,
  groupTypes: string[],
  allPaths: Set<string>,
): void {
  for (const [key, val] of Object.entries(obj)) {
    // Skip DTCG meta properties
    if (key.startsWith("$")) continue;

    const currentPath = path ? `${path}.${key}` : key;

    // Naming check
    if (!isKebabCase(key)) {
      if (isCamelCase(key)) {
        warn(currentPath, `key "${key}" is camelCase, prefer kebab-case`);
      }
      // Alphanumeric keys starting with digit + letters (like "2xl") are common -- allow silently
    }

    if (typeof val !== "object" || val === null) {
      // Primitive at non-leaf location -- probably a mistake
      error(currentPath, `unexpected primitive value at non-leaf location`);
      continue;
    }

    const node = val as Record<string, unknown>;

    if (isLeafNode(node)) {
      tokenCount++;

      // $type check
      const nodeType = resolveType(node, groupTypes);
      if (node.$type !== undefined && !VALID_DTCG_TYPES.has(node.$type as string)) {
        error(currentPath, `invalid $type "${node.$type}"`);
      }
      if (!nodeType) {
        error(currentPath, `no $type resolved (neither on node nor inherited from group)`);
      }

      // Empty value check
      if (node.$value === "" || node.$value === null || node.$value === undefined) {
        error(currentPath, `$value is empty or null`);
      } else if (nodeType) {
        // Value-type consistency
        validateValue(currentPath, nodeType, node.$value);
        // Reference check
        checkReferences(node.$value, currentPath, allPaths);
      }
    } else if (isGroupNode(node)) {
      // Propagate group-level $type
      const groupType = typeof node.$type === "string" ? (node.$type as string) : "";
      if (groupType && !VALID_DTCG_TYPES.has(groupType)) {
        error(currentPath, `invalid group $type "${groupType}"`);
      }
      walkTokens(node, currentPath, [...groupTypes, groupType], allPaths);
    }
  }
}

// ---------------------------------------------------------------------------
// CJK override consistency check
// ---------------------------------------------------------------------------

function walkCjkOverrides(
  overrideObj: Record<string, unknown>,
  baseObj: Record<string, unknown>,
  path: string,
): void {
  for (const [key, val] of Object.entries(overrideObj)) {
    if (key.startsWith("$")) continue;
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof val !== "object" || val === null) continue;
    const node = val as Record<string, unknown>;

    if (isLeafNode(node)) {
      // Check this path exists in base
      const segments = currentPath.split(".");
      let cursor: unknown = baseObj;
      let found = true;
      for (const seg of segments) {
        if (typeof cursor === "object" && cursor !== null && seg in (cursor as Record<string, unknown>)) {
          cursor = (cursor as Record<string, unknown>)[seg];
        } else {
          found = false;
          break;
        }
      }
      if (!found) {
        error(currentPath, `CJK override key does not exist in base.json`);
      }
    } else {
      // Group -- recurse
      walkCjkOverrides(node, baseObj, currentPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  // 1. JSON syntax check -- base.json
  let baseData: Record<string, unknown>;
  try {
    const raw = readFileSync(BASE_PATH, "utf-8");
    baseData = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error("tokens/base.json", `Failed to parse JSON: ${msg}`);
    printSummary();
    process.exit(1);
  }

  // 2. Collect all token paths for reference resolution
  const allPaths = new Set<string>();
  collectAllPaths(baseData, "", allPaths);

  // 3. Walk and validate base tokens
  walkTokens(baseData, "", [], allPaths);

  // 4. CJK override checks
  if (existsSync(CJK_PATH)) {
    let cjkData: Record<string, unknown>;
    try {
      const raw = readFileSync(CJK_PATH, "utf-8");
      cjkData = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error("tokens/overrides/cjk.json", `Failed to parse JSON: ${msg}`);
      printSummary();
      process.exit(1);
    }

    walkCjkOverrides(cjkData, baseData, "");
  }

  // 5. Duplicate check -- JSON.parse handles this natively (last wins),
  //    but we do a manual scan for duplicate keys in raw text
  checkDuplicateKeys(BASE_PATH, "tokens/base.json");
  if (existsSync(CJK_PATH)) {
    checkDuplicateKeys(CJK_PATH, "tokens/overrides/cjk.json");
  }

  printSummary();
  process.exit(errors.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Duplicate key detection (raw text scan)
// ---------------------------------------------------------------------------

function checkDuplicateKeys(filePath: string, label: string): void {
  const raw = readFileSync(filePath, "utf-8");
  try {
    const reviver = createDuplicateKeyReviver(label);
    JSON.parse(raw, reviver);
  } catch {
    // parse errors already caught above
  }
}

function createDuplicateKeyReviver(label: string) {
  const seen = new Map<string, Set<string>>();
  let objectId = 0;

  return function reviver(this: unknown, key: string, value: unknown): unknown {
    if (key === "") return value; // root
    // Use the parent object identity to track keys per object
    // JSON.parse calls reviver bottom-up, so we track by stringified parent path
    const parentId =
      typeof this === "object" && this !== null
        ? (((this as Record<string, unknown>).__dup_id as string) ??
          (() => {
            const id = `obj_${objectId++}`;
            try {
              Object.defineProperty(this, "__dup_id", {
                value: id,
                enumerable: false,
                writable: false,
                configurable: true,
              });
            } catch {
              // frozen object
            }
            return id;
          })())
        : "root";

    if (!seen.has(parentId)) seen.set(parentId, new Set());
    const keys = seen.get(parentId)!;
    if (keys.has(key)) {
      warn(label, `duplicate key "${key}" detected (last value wins)`);
    }
    keys.add(key);
    return value;
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(): void {
  for (const w of warnings) console.log(w);
  for (const e of errors) console.log(e);
  console.log("");

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`\u2705 All tokens valid (${tokenCount} tokens checked)`);
  } else {
    console.log(
      `Summary: ${errors.length} error(s), ${warnings.length} warning(s), ${tokenCount} token(s) checked`,
    );
  }
}

main();

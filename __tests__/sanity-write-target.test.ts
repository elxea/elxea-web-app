import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DATASET_ENV_VAR,
  PRODUCTION_CONFIRM_FLAG,
  WriteTargetError,
  isProductionDataset,
  resolveWriteDataset,
} from "@/lib/sanity/write-target";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");

/**
 * Any of these in a script means "the write target has an implicit default",
 * which is the exact bug that put fictional documents into production.
 */
const IMPLICIT_DEFAULT_PATTERNS = [
  /(?:\|\||\?\?)\s*["'`]prod(?:uction)?["'`]/, // env.X || "production"
  /dataset\s*:\s*["'`]prod(?:uction)?["'`]/, // dataset: "production"
];

/**
 * Files that still carry the old pattern and are owned by another in-flight PR.
 * Each entry MUST be removed once that PR lands — this suite fails if an entry
 * is stale, so the exemption cannot outlive its reason.
 */
// 空でよい。scripts/sync-notion-to-sanity.ts は #64 のマージで
// 暗黙の本番既定を持たなくなったため、この検査の免除を外した
// (下の "keeps the exemption list honest" が古い免除を赤で知らせる設計)。
const KNOWN_UNFIXED: Record<string, string> = {};

/** Directories that are local scratch space, not shipped code. */
const IGNORED_DIRS = new Set(["scratch", "node_modules"]);

function collectScripts(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) collectScripts(full, acc);
      continue;
    }
    if (/\.(ts|mts|mjs|js)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("resolveWriteDataset — no target means no run", () => {
  it("throws when neither --dataset nor the env var is set", () => {
    expect(() =>
      resolveWriteDataset({ scriptName: "scripts/x.ts", env: {}, argv: [] })
    ).toThrow(WriteTargetError);
  });

  it("throws when the env var is present but blank", () => {
    expect(() =>
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: { [DATASET_ENV_VAR]: "   " },
        argv: [],
      })
    ).toThrow(WriteTargetError);
  });

  it("names the env var and the flag in the error so the operator can recover", () => {
    let message = "";
    try {
      resolveWriteDataset({ scriptName: "scripts/x.ts", env: {}, argv: [] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(DATASET_ENV_VAR);
    expect(message).toContain("--dataset");
    expect(message).toContain(PRODUCTION_CONFIRM_FLAG);
    expect(message).toContain("Nothing was written.");
  });

  it("never silently falls back to production", () => {
    // Regression guard: the old code returned "production" here.
    expect(() =>
      resolveWriteDataset({ scriptName: "scripts/x.ts", env: {}, argv: [] })
    ).toThrow();
  });
});

describe("resolveWriteDataset — production needs a second opt-in", () => {
  it("refuses a production target without the confirmation flag", () => {
    expect(() =>
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: { [DATASET_ENV_VAR]: "production" },
        argv: [],
      })
    ).toThrow(/refusing to write to the production dataset/);
  });

  it("refuses production supplied via --dataset without the flag", () => {
    expect(() =>
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: {},
        argv: ["--dataset", "production"],
      })
    ).toThrow(WriteTargetError);
  });

  it("allows production only with the explicit confirmation flag", () => {
    expect(
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: { [DATASET_ENV_VAR]: "production" },
        argv: [PRODUCTION_CONFIRM_FLAG],
      })
    ).toBe("production");
  });

  it("does not require the flag for a non-production dataset", () => {
    expect(
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: { [DATASET_ENV_VAR]: "staging" },
        argv: [],
      })
    ).toBe("staging");
  });

  it("does not require the flag for read-only scripts", () => {
    expect(
      resolveWriteDataset({
        scriptName: "scripts/backup-sanity.ts",
        env: { [DATASET_ENV_VAR]: "production" },
        argv: [],
        writes: false,
      })
    ).toBe("production");
  });

  it("still fails closed for read-only scripts with no target", () => {
    expect(() =>
      resolveWriteDataset({
        scriptName: "scripts/backup-sanity.ts",
        env: {},
        argv: [],
        writes: false,
      })
    ).toThrow(WriteTargetError);
  });

  it("treats production aliases case-insensitively", () => {
    expect(isProductionDataset("Production")).toBe(true);
    expect(isProductionDataset(" prod ")).toBe(true);
    expect(isProductionDataset("staging")).toBe(false);
  });

  it("prefers an explicit --dataset over the env var", () => {
    expect(
      resolveWriteDataset({
        scriptName: "scripts/x.ts",
        env: { [DATASET_ENV_VAR]: "production" },
        argv: ["--dataset=staging"],
      })
    ).toBe("staging");
  });
});

describe("no script may default its write target to production", () => {
  const files = collectScripts(SCRIPTS_DIR);

  it("finds scripts to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("has no implicit production default outside the known exemptions", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relPath = rel(file);
      if (relPath in KNOWN_UNFIXED) continue;
      const source = readFileSync(file, "utf-8");
      if (IMPLICIT_DEFAULT_PATTERNS.some((re) => re.test(source))) {
        offenders.push(relPath);
      }
    }
    expect(
      offenders,
      `These scripts default their write target to production. Use ` +
        `resolveWriteDatasetOrExit() from lib/sanity/write-target.ts instead.`
    ).toEqual([]);
  });

  it("keeps the exemption list honest (delete entries once fixed)", () => {
    for (const [relPath, reason] of Object.entries(KNOWN_UNFIXED)) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
      const stillOffends = IMPLICIT_DEFAULT_PATTERNS.some((re) =>
        re.test(source)
      );
      expect(
        stillOffends,
        `${relPath} no longer has an implicit production default ` +
          `(${reason}). Remove it from KNOWN_UNFIXED in this test.`
      ).toBe(true);
    }
  });

  it("routes every Sanity-writing script through the guard", () => {
    const guarded = [
      "scripts/seed-dummy-content.ts",
      "scripts/seed-farmers.ts",
      "scripts/cleanup-webflow-data.ts",
      "scripts/cleanup-and-resync.ts",
      "scripts/migrate-webflow-to-sanity.ts",
      "scripts/migrate-webflow-bodies.ts",
      "scripts/fix-broken-refs.ts",
      "scripts/backup-sanity.ts",
    ];
    for (const relPath of guarded) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
      expect(source, `${relPath} must resolve its dataset via the guard`).toMatch(
        /resolveWriteDatasetOrExit\(/
      );
    }
  });
});

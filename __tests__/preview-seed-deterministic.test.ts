import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  previewImageAt,
  previewImageForKey,
  previewSeedDeterministic,
} from "@/lib/preview-seed";

/**
 * `PREVIEW_SEED_DETERMINISTIC=1` — screenshot-regression mode for the preview
 * placeholder photo pool.
 *
 * The pool spans three aspect ratios (1920x1200 / 1920x1440 / 1024x1024), so
 * which image lands on which card moves total page height. Selection is already
 * deterministic per key, but the keys come from the live Sanity dataset and drift
 * between runs, which is what made screenshot diffing unusable on the journal SP
 * routes (C16-1). This flag pins every key to one image so height stops depending
 * on which documents came back.
 *
 * The env var is read at call time rather than captured at module load, which is
 * what lets these cases flip it in-process. If a future refactor hoists the
 * lookup to module scope these tests will start failing — that is intended, the
 * call-time read is part of the contract.
 */

const ENV_KEY = "PREVIEW_SEED_DETERMINISTIC";

let original: string | undefined;

beforeEach(() => {
  original = process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe("previewSeedDeterministic", () => {
  it("is off unless the flag is exactly \"1\"", () => {
    delete process.env[ENV_KEY];
    expect(previewSeedDeterministic()).toBe(false);

    process.env[ENV_KEY] = "0";
    expect(previewSeedDeterministic()).toBe(false);

    // Guard against a truthy-string bug: "true" must NOT enable the flag, so the
    // documented contract stays a single literal value.
    process.env[ENV_KEY] = "true";
    expect(previewSeedDeterministic()).toBe(false);

    process.env[ENV_KEY] = "1";
    expect(previewSeedDeterministic()).toBe(true);
  });
});

describe("placeholder photo selection", () => {
  it("spreads across the pool when the flag is off (the C16-1 failure mode)", () => {
    delete process.env[ENV_KEY];

    // More than one distinct image must be reachable, otherwise the flag below
    // would be testing nothing.
    const byIndex = new Set([0, 1, 2, 3, 4, 5].map(previewImageAt));
    expect(byIndex.size).toBeGreaterThan(1);

    const byKey = new Set(
      ["seed-journal-0", "seed-journal-1", "seed-journal-2", "seed-journal-3"].map(
        previewImageForKey,
      ),
    );
    expect(byKey.size).toBeGreaterThan(1);
  });

  it("collapses every index and every key to one image when the flag is on", () => {
    process.env[ENV_KEY] = "1";

    const pinned = previewImageAt(0);

    // Indices, including negative and out-of-range ones, all resolve to it.
    for (const i of [-7, -1, 0, 1, 2, 3, 4, 5, 6, 41]) {
      expect(previewImageAt(i)).toBe(pinned);
    }

    // Keys resolve through previewImageAt, so they collapse too. These stand in
    // for ids whose composition drifts with the live dataset.
    for (const key of [
      "seed-journal-0",
      "seed-journal-5",
      "abc123",
      "",
      "a-very-long-sanity-document-id-0000",
    ]) {
      expect(previewImageForKey(key)).toBe(pinned);
    }
  });

  it("still returns a real /public asset path when pinned", () => {
    process.env[ENV_KEY] = "1";

    // Must stay a local asset — the seed helpers promise no remote hosts.
    expect(previewImageAt(0)).toMatch(/^\/[\w-]+\.jpg$/);
  });
});

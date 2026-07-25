/**
 * Tests for the M33 Phase C site-asset read side (lib/site-assets).
 *
 * The contract this guards:
 *   1. resolveSiteAsset returns the manifest url ONLY for a present, non-empty
 *      string url; every other case (unassigned slot, null/malformed manifest,
 *      empty/whitespace/non-string url) resolves to the caller's fallbackSrc so
 *      an unassigned frame keeps its current static image — the look never breaks.
 *   2. getSiteManifest is best-effort: network error, non-200, invalid JSON, or a
 *      non-object body all resolve to {} (never throws), which then falls back.
 *   3. getSiteAsset composes the two: manifest hit -> assigned url, otherwise the
 *      fallback.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveSiteAsset,
  getSiteManifest,
  getSiteAsset,
  type SiteManifest,
} from "@/lib/site-assets";

const FALLBACK = "/hero-day.jpg";
const SLOT = "site:top:hero-01";
const ASSIGNED =
  "https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/ELX/site_top_hero-01.jpg";

const manifestWith = (url: unknown): SiteManifest =>
  ({
    [SLOT]: { url, asset_id: "elx-asset-1", updated_at: "2026-07-25T00:00:00Z" },
  }) as unknown as SiteManifest;

describe("resolveSiteAsset", () => {
  it("returns the assigned url when the slot has a non-empty string url", () => {
    expect(resolveSiteAsset(manifestWith(ASSIGNED), SLOT, FALLBACK)).toBe(
      ASSIGNED,
    );
  });

  it("falls back when the slot is unassigned (not in manifest)", () => {
    expect(resolveSiteAsset(manifestWith(ASSIGNED), "site:top:other-99", FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("falls back when the manifest is empty", () => {
    expect(resolveSiteAsset({}, SLOT, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the manifest is null or undefined", () => {
    expect(resolveSiteAsset(null, SLOT, FALLBACK)).toBe(FALLBACK);
    expect(resolveSiteAsset(undefined, SLOT, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the entry url is empty or whitespace-only", () => {
    expect(resolveSiteAsset(manifestWith(""), SLOT, FALLBACK)).toBe(FALLBACK);
    expect(resolveSiteAsset(manifestWith("   "), SLOT, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the entry url is not a string (malformed manifest)", () => {
    expect(resolveSiteAsset(manifestWith(null), SLOT, FALLBACK)).toBe(FALLBACK);
    expect(resolveSiteAsset(manifestWith(123), SLOT, FALLBACK)).toBe(FALLBACK);
    expect(resolveSiteAsset(manifestWith(undefined), SLOT, FALLBACK)).toBe(
      FALLBACK,
    );
  });
});

describe("getSiteManifest (best-effort)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the parsed manifest on 200 + valid object body", async () => {
    const body = manifestWith(ASSIGNED);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    await expect(getSiteManifest()).resolves.toEqual(body);
  });

  it("returns {} on a non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    await expect(getSiteManifest()).resolves.toEqual({});
  });

  it("returns {} when the body is not a JSON object (array / invalid)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([1, 2, 3]), { status: 200 }),
    );
    await expect(getSiteManifest()).resolves.toEqual({});
  });

  it("returns {} (never throws) on a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getSiteManifest()).resolves.toEqual({});
  });
});

describe("getSiteAsset (compose)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the assigned url when the manifest fetch succeeds with a hit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(manifestWith(ASSIGNED)), { status: 200 }),
    );
    await expect(getSiteAsset(SLOT, FALLBACK)).resolves.toBe(ASSIGNED);
  });

  it("returns the fallback when the manifest fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(getSiteAsset(SLOT, FALLBACK)).resolves.toBe(FALLBACK);
  });
});

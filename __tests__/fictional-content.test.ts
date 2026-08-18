/**
 * Tests for the fictional-content deny-list (lib/fictional-content).
 *
 * The contract this guards — it is a production-exposure guard, so every one of
 * these assertions goes red the moment a dummy stops being blocked:
 *   1. Every seed document confirmed to exist in the production Sanity dataset
 *      is blocked by BOTH its `_id` and its slug (list views have the `_id`,
 *      detail routes and the sitemap only have the slug).
 *   2. Real documents are never blocked: unknown ids/slugs, and the two farmers
 *      that are NOT seeds, pass through untouched.
 *   3. The farmer entries are unchanged from the former lib/fictional-farmers.ts
 *      (that module was folded into this one; farmer behaviour must not move).
 *   4. `author` seed docs are deliberately NOT in the deny-list — "setaka" may
 *      be a real person, so that call is Setaka's, not the code's.
 *   5. Every read path that renders or lists these types actually consults the
 *      deny-list (source-level assertion, so a new page cannot silently ship an
 *      unfiltered fetch of a denied type).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  type FictionalDocType,
  fictionalIds,
  fictionalSlugs,
  isFictionalId,
  isFictionalSlug,
  filterOutFictional,
} from "@/lib/fictional-content";

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * The seed documents observed in the production dataset, keyed by `_type`.
 * Sources: scripts/seed-farmers.ts and scripts/seed-dummy-content.ts.
 */
const MUST_BLOCK: Record<FictionalDocType, Array<[id: string, slug: string]>> = {
  farmer: [
    ["farmer-aoyama-shuichi", "aoyama-shuichi"],
    ["farmer-chen-yufen", "chen-yufen"],
    ["farmer-rajan-mehta", "rajan-mehta"],
    ["farmer-yamada", "yamada-farm"],
    ["farmer-tanaka", "tanaka-tea-garden"],
  ],
  teaMenu: [
    ["tea-sencha-spring", "spring-sencha"],
    ["tea-gyokuro", "uji-gyokuro"],
    ["tea-hojicha", "kaga-hojicha"],
  ],
  playlist: [
    ["playlist-morning-forest", "morning-forest"],
    ["playlist-rain-on-leaves", "rain-on-tea-leaves"],
  ],
  event: [
    ["event-tea-tasting", "spring-tea-tasting-2026"],
    ["event-brewing-workshop", "beginners-tea-workshop"],
  ],
};

const TYPES = Object.keys(MUST_BLOCK) as FictionalDocType[];

describe("fictional-content deny-list", () => {
  describe.each(TYPES)("%s", (type) => {
    const cases = MUST_BLOCK[type];

    it.each(cases)("blocks _id %s and slug %s", (id, slug) => {
      expect(isFictionalId(type, id)).toBe(true);
      expect(isFictionalSlug(type, slug)).toBe(true);
    });

    it("blocks exactly the known seed docs and nothing more", () => {
      expect([...fictionalIds(type)].sort()).toEqual(cases.map(([id]) => id).sort());
      expect([...fictionalSlugs(type)].sort()).toEqual(cases.map(([, s]) => s).sort());
    });

    it("removes every seed doc from a fetched list, by _id or by slug alone", () => {
      const byId = cases.map(([id]) => ({ _id: id }));
      const bySlug = cases.map(([, slug]) => ({ slug: { current: slug } }));
      expect(filterOutFictional(type, byId)).toEqual([]);
      expect(filterOutFictional(type, bySlug)).toEqual([]);
    });

    it("lets real documents through", () => {
      const real = [
        { _id: `${type}-real-1`, slug: { current: "a-real-one" } },
        { _id: `${type}-real-2`, slug: { current: "another-real-one" } },
      ];
      expect(filterOutFictional(type, real)).toEqual(real);
      expect(isFictionalId(type, `${type}-real-1`)).toBe(false);
      expect(isFictionalSlug(type, "a-real-one")).toBe(false);
    });

    it("treats null/undefined/empty input safely", () => {
      expect(filterOutFictional(type, null)).toEqual([]);
      expect(filterOutFictional(type, undefined)).toEqual([]);
      expect(isFictionalId(type, null)).toBe(false);
      expect(isFictionalId(type, undefined)).toBe(false);
      expect(isFictionalSlug(type, null)).toBe(false);
      expect(isFictionalSlug(type, undefined)).toBe(false);
      expect(isFictionalSlug(type, "")).toBe(false);
    });
  });

  it("keeps deny-lists per type: a farmer slug does not block a teaMenu", () => {
    expect(isFictionalSlug("teaMenu", "yamada-farm")).toBe(false);
    expect(isFictionalSlug("farmer", "spring-sencha")).toBe(false);
  });

  it("does NOT block the real (non-seed) farmers", () => {
    // Sanity farmer docs created 2026-03-07 — pending Setaka's confirmation but
    // never seed output, so they must keep rendering.
    const realFarmers = [
      { _id: "farmer-yamada-kenichi-real", slug: { current: "yamada-kenichi" } },
      { _id: "farmer-sato-misaki", slug: { current: "sato-misaki" } },
    ];
    expect(filterOutFictional("farmer", realFarmers)).toEqual(realFarmers);
  });

  it("does NOT block author docs (Setaka's call, not the code's)", () => {
    // "author" is intentionally absent from FictionalDocType, and no existing
    // type's deny-list may smuggle the author seed ids/slugs in. If someone adds
    // them without Setaka's sign-off, this assertion fails.
    expect(TYPES).not.toContain("author");
    for (const type of TYPES) {
      for (const id of ["author-setaka", "author-roji"]) {
        expect(isFictionalId(type, id)).toBe(false);
      }
      for (const slug of ["setaka", "roji-editorial"]) {
        expect(isFictionalSlug(type, slug)).toBe(false);
      }
    }
  });
});

describe("read paths consult the deny-list", () => {
  /** `guard("filterOutFictional", "event")` -> matches across line breaks. */
  const guard = (fn: string, type: FictionalDocType) =>
    new RegExp(`${fn}\\(\\s*"${type}"`);

  const cases: Array<[file: string, fn: string, type: FictionalDocType]> = [
    // sitemap: one skip per denied type (farmer/event/teaMenu/playlist)
    ["app/sitemap.ts", "isFictionalSlug", "farmer"],
    ["app/sitemap.ts", "isFictionalSlug", "event"],
    ["app/sitemap.ts", "isFictionalSlug", "teaMenu"],
    ["app/sitemap.ts", "isFictionalSlug", "playlist"],
    // list views
    // R2 確定版では農家一覧の専用ルート (farmers/page.tsx) は無くなり、
    // つくり手の一覧は About ページ (「つくり手」節) が担う。ガードの要件は
    // 変わらないので、対象ファイルだけを実在する一覧ビューに差し替える。
    ["app/[locale]/(reading)/about/page.tsx", "filterOutFictional", "farmer"],
    ["app/[locale]/(reading)/tea-menu/page.tsx", "filterOutFictional", "teaMenu"],
    ["app/[locale]/(reading)/playlists/page.tsx", "filterOutFictional", "playlist"],
    ["app/[locale]/events/page.tsx", "filterOutFictional", "event"],
    ["app/[locale]/page.tsx", "filterOutFictional", "event"],
    // detail routes
    ["app/[locale]/(reading)/farmers/[slug]/page.tsx", "isFictionalSlug", "farmer"],
    ["app/[locale]/(reading)/tea-menu/[slug]/page.tsx", "isFictionalSlug", "teaMenu"],
    ["app/[locale]/(reading)/playlists/[slug]/page.tsx", "isFictionalSlug", "playlist"],
    ["app/[locale]/events/[slug]/page.tsx", "isFictionalSlug", "event"],
    // journal issues must not link to fictional tea / playlists
    ["app/[locale]/(reading)/elxea-journal/[slug]/page.tsx", "filterOutFictional", "teaMenu"],
    ["app/[locale]/(reading)/elxea-journal/[slug]/page.tsx", "isFictionalSlug", "playlist"],
  ];

  it.each(cases)("%s guards with %s(%s)", (file, fn, type) => {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    expect(source).toMatch(guard(fn, type));
  });

  it("detail routes block before the fetch, in both the page and its metadata", () => {
    const detail: Array<[string, FictionalDocType]> = [
      ["app/[locale]/(reading)/farmers/[slug]/page.tsx", "farmer"],
      ["app/[locale]/(reading)/tea-menu/[slug]/page.tsx", "teaMenu"],
      ["app/[locale]/(reading)/playlists/[slug]/page.tsx", "playlist"],
      ["app/[locale]/events/[slug]/page.tsx", "event"],
    ];
    for (const [file, type] of detail) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      // generateMetadata: no title/OG for a hidden doc
      expect(source).toContain(`if (isFictionalSlug("${type}", slug)) return {};`);
      // page: 404 instead of rendering
      expect(source).toContain(`if (isFictionalSlug("${type}", slug)) notFound();`);
    }
  });

  it("no read path still imports the removed lib/fictional-farmers module", () => {
    const source = readFileSync(path.join(REPO_ROOT, "app/sitemap.ts"), "utf8");
    expect(source).toContain('from "@/lib/fictional-content"');
    expect(source).not.toContain("fictional-farmers");
  });
});

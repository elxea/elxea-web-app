/**
 * Tests for the fictional-content deny-list (lib/fictional-content).
 *
 * The contract this guards — it is a production-exposure guard, so every one of
 * these assertions goes red the moment a dummy stops being blocked:
 *   1. Every fictional document confirmed to exist in the production Sanity
 *      dataset is blocked by BOTH its `_id` and its slug (list views have the
 *      `_id`, detail routes and the sitemap only have the slug).
 *   2. Real documents are never blocked: unknown ids/slugs pass through
 *      untouched, and the deny-list stays a fixed list rather than a rule that
 *      could swallow a genuine farmer added later.
 *   3. `author` seed docs are deliberately NOT in the deny-list — "setaka" may
 *      be a real person, so that call is Setaka's, not the code's.
 *   4. Every read path that renders, lists, or emails about these types actually
 *      consults the deny-list (source-level assertion, so a new page cannot
 *      silently ship an unfiltered fetch of a denied type).
 *
 * On `farmer` specifically: all four farmer docs in production are fictional.
 * Three come from seed scripts; 山田 健一 / 佐藤 美咲 were hand-created on
 * 2026-03-07 and were left visible pending confirmation. Setaka confirmed them
 * fictional on 2026-08-22, so they are blocked too and the old "does NOT block
 * the real (non-seed) farmers" assertion is gone — it asserted the opposite.
 *
 * On `playlist` specifically: it was denied here from 2026-08-22 to 2026-08-26,
 * then Setaka reversed the call — the playlists and their audio are content he
 * wants public. The type is gone from the deny-list rather than emptied, and
 * "playlist is deliberately visible" below pins that so a later change cannot
 * re-hide it by quietly re-adding the entry.
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
 * The fictional documents observed in the production dataset, keyed by `_type`.
 * Sources: scripts/seed-farmers.ts, scripts/seed-dummy-content.ts, and — for the
 * last two farmers — a live GROQ query against the production dataset
 * (`*[_type=="farmer"]{_id,name,"slug":slug.current}`, 2026-08-22).
 */
const MUST_BLOCK: Record<FictionalDocType, Array<[id: string, slug: string]>> = {
  farmer: [
    ["farmer-aoyama-shuichi", "aoyama-shuichi"],
    ["farmer-chen-yufen", "chen-yufen"],
    ["farmer-rajan-mehta", "rajan-mehta"],
    ["farmer-yamada", "yamada-farm"],
    ["farmer-tanaka", "tanaka-tea-garden"],
    // 山田 健一 / 佐藤 美咲 — hand-created 2026-03-07, confirmed fictional
    // by Setaka 2026-08-22. Sanity auto-generated the ids.
    ["ChPy2hTrLaycRwOtl4DGV5", "yamada-kenichi"],
    ["ChPy2hTrLaycRwOtl4DGZd", "sato-misaki"],
  ],
  teaMenu: [
    ["tea-sencha-spring", "spring-sencha"],
    ["tea-gyokuro", "uji-gyokuro"],
    ["tea-hojicha", "kaga-hojicha"],
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

  it("blocks every farmer doc currently in the production dataset", () => {
    // Live GROQ against production on 2026-08-22 returned exactly these four,
    // and Setaka confirmed elxea has no real published producer profiles yet.
    // So the whole set must be denied — if a genuine producer is published
    // later it will carry a new _id/slug and pass straight through.
    const production = [
      { _id: "ChPy2hTrLaycRwOtl4DGV5", slug: { current: "yamada-kenichi" } },
      { _id: "ChPy2hTrLaycRwOtl4DGZd", slug: { current: "sato-misaki" } },
      { _id: "farmer-yamada", slug: { current: "yamada-farm" } },
      { _id: "farmer-tanaka", slug: { current: "tanaka-tea-garden" } },
    ];
    expect(filterOutFictional("farmer", production)).toEqual([]);
  });

  it("still lets a future, genuinely-real farmer through", () => {
    // The deny-list must stay a fixed list, not "hide all farmers".
    const realFarmer = [
      { _id: "a-brand-new-sanity-id", slug: { current: "a-real-producer" } },
    ];
    expect(filterOutFictional("farmer", realFarmer)).toEqual(realFarmer);
  });

  it("playlist is deliberately visible (Setaka reversed the hide on 2026-08-26)", () => {
    // The two production playlists were denied here between 2026-08-22 and
    // 2026-08-26. Setaka then asked for them back, together with the
    // self-built sticky player, so `playlist` must not be a denied type at all
    // and no other type's list may smuggle its ids/slugs in through the back
    // door. If someone re-hides them without Setaka's sign-off, this fails.
    expect(TYPES as string[]).not.toContain("playlist");
    for (const type of TYPES) {
      for (const id of ["playlist-morning-forest", "playlist-rain-on-leaves"]) {
        expect(isFictionalId(type, id)).toBe(false);
      }
      for (const slug of ["morning-forest", "rain-on-tea-leaves"]) {
        expect(isFictionalSlug(type, slug)).toBe(false);
      }
    }
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
    // sitemap: one skip per denied type (farmer/event/teaMenu)
    ["app/sitemap.ts", "isFictionalSlug", "farmer"],
    ["app/sitemap.ts", "isFictionalSlug", "event"],
    ["app/sitemap.ts", "isFictionalSlug", "teaMenu"],
    // list views
    // R2 確定版では農家一覧の専用ルート (farmers/page.tsx) は無くなり、
    // つくり手の一覧は About ページ (「つくり手」節) が担う。ガードの要件は
    // 変わらないので、対象ファイルだけを実在する一覧ビューに差し替える。
    ["app/[locale]/(reading)/about/page.tsx", "filterOutFictional", "farmer"],
    ["app/[locale]/(reading)/tea-menu/page.tsx", "filterOutFictional", "teaMenu"],
    ["app/[locale]/events/page.tsx", "filterOutFictional", "event"],
    ["app/[locale]/page.tsx", "filterOutFictional", "event"],
    // トップの VOICES 節 (TOP_FARMER_VOICES_QUERY)。引くのは `quote` のある農家だけ
    // なので現時点では架空 4 件とも釣れないが、Studio で一言が入った瞬間に
    // トップの一等地へ出てしまう。ほかの farmer 経路と同じくガードを通す。
    ["app/[locale]/page.tsx", "filterOutFictional", "farmer"],
    // detail routes
    ["app/[locale]/(reading)/farmers/[slug]/page.tsx", "isFictionalSlug", "farmer"],
    ["app/[locale]/(reading)/tea-menu/[slug]/page.tsx", "isFictionalSlug", "teaMenu"],
    ["app/[locale]/events/[slug]/page.tsx", "isFictionalSlug", "event"],
    // journal issues must not link to fictional tea (playlists are public again)
    ["app/[locale]/(reading)/elxea-journal/[slug]/page.tsx", "filterOutFictional", "teaMenu"],
    // フォロワー向けメール。公開ページではないが、架空の生産者名を実在の顧客に
    // 断言したうえリンク先は 404 になるので、遮断の必要はむしろ強い。
    ["app/api/cron/farmer-notification/route.ts", "filterOutFictional", "farmer"],
  ];

  it.each(cases)("%s guards with %s(%s)", (file, fn, type) => {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    expect(source).toMatch(guard(fn, type));
  });

  it("detail routes block before the fetch, in both the page and its metadata", () => {
    const detail: Array<[string, FictionalDocType]> = [
      ["app/[locale]/(reading)/farmers/[slug]/page.tsx", "farmer"],
      ["app/[locale]/(reading)/tea-menu/[slug]/page.tsx", "teaMenu"],
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

  it("the playlist read paths no longer filter through the deny-list", () => {
    // Counterpart to "playlist is deliberately visible": that one pins the data,
    // this one pins the read paths. Re-adding a filter here would hide the
    // playlists again even with an empty deny-list entry, so assert the calls
    // are gone from the source rather than only checking the list's contents.
    const files = [
      "app/[locale]/(reading)/playlists/page.tsx",
      "app/[locale]/(reading)/playlists/[slug]/page.tsx",
      "app/[locale]/(reading)/elxea-journal/[slug]/page.tsx",
      "app/sitemap.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(source).not.toMatch(/(?:filterOutFictional|isFictional\w+)\(\s*"playlist"/);
    }
  });

  it("no read path still imports the removed lib/fictional-farmers module", () => {
    const source = readFileSync(path.join(REPO_ROOT, "app/sitemap.ts"), "utf8");
    expect(source).toContain('from "@/lib/fictional-content"');
    expect(source).not.toContain("fictional-farmers");
  });
});

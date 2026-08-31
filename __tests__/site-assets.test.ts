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
 *   4. resolveSiteSurfaces resolves **per declared surface**, with the fallback
 *      chain surface url -> representative url -> fallbackSrc, so a manifest in
 *      the old shape (`url` only), the new shape (`surfaces`), or a half-baked one
 *      (missing a surface) all render something valid. `artDirected` stays false
 *      whenever one image suffices, which is what keeps an unassigned frame
 *      rendering exactly as it does today.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveSiteAsset,
  resolveSiteSurfaces,
  representativeUrl,
  getSiteManifest,
  getSiteAsset,
  getSiteImage,
  type SiteManifest,
} from "@/lib/site-assets";
import type { SiteSlot } from "@/lib/site-slots";

const FALLBACK = "/hero-day.jpg";
const SLOT = "site:top:hero-01";
const R2 = "https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/ELX";
const ASSIGNED = `${R2}/site_top_hero-01.jpg`;
const SP_URL = `${R2}/site_top_hero-01__sp.jpg`;
const PC_URL = `${R2}/site_top_hero-01__pc.jpg`;

const manifestWith = (url: unknown): SiteManifest =>
  ({
    [SLOT]: { url, asset_id: "elx-asset-1", updated_at: "2026-07-25T00:00:00Z" },
  }) as unknown as SiteManifest;

/**
 * 実物と同じ形の宣言: 既定の面 (media なし) = SP、条件付きの面 = PC。
 * 宣言はサイト側の SoT なので、マニフェストが何を知っていようと面の集合はこれで決まる。
 */
const DECL: SiteSlot = {
  id: SLOT,
  label: "トップ Hero (KV)",
  page: "top",
  required: true,
  order: 10,
  surfaces: [
    { id: "sp", label: "スマホ表示", ratio: { width: 5, height: 4 }, fit: "cover" },
    {
      id: "pc",
      label: "PC 表示",
      ratio: { width: 864, height: 560 },
      fit: "cover",
      media: "(min-width: 1024px)",
    },
  ],
};

/** surface 別 url を持つ新形式のエントリ。`url` (代表) の有無を切り替えられる。 */
const surfaceManifest = (
  surfaces: Record<string, { url: unknown; ratio?: { width: number; height: number } }>,
  representative?: string,
): SiteManifest =>
  ({
    [SLOT]: {
      ...(representative === undefined ? {} : { url: representative }),
      surfaces,
      asset_id: "elx-asset-1",
      updated_at: "2026-08-31T00:00:00Z",
    },
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

  /**
   * asset-hub は当面 `url` に代表 1 枚を入れ続けるが、落とせるようになったあとも
   * 1 枚しか読めない呼び出し側が壊れないようにしておく。
   */
  it("falls back to the most portrait surface when the entry has no representative url", () => {
    const manifest = surfaceManifest({
      // 864:560 (1.54) より 5:4 (1.25) のほうが縦長 = 代表。
      pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
      sp: { url: SP_URL, ratio: { width: 5, height: 4 } },
    });
    expect(resolveSiteAsset(manifest, SLOT, FALLBACK)).toBe(SP_URL);
  });

  it("prefers the explicit representative url over the surfaces", () => {
    const manifest = surfaceManifest(
      { sp: { url: SP_URL }, pc: { url: PC_URL } },
      ASSIGNED,
    );
    expect(resolveSiteAsset(manifest, SLOT, FALLBACK)).toBe(ASSIGNED);
  });
});

describe("representativeUrl", () => {
  it("ignores surfaces whose url is empty or not a string", () => {
    expect(
      representativeUrl({
        surfaces: {
          sp: { url: "  ", ratio: { width: 5, height: 4 } },
          pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
        },
      }),
    ).toBe(PC_URL);
  });

  it("returns undefined when nothing is assigned", () => {
    expect(representativeUrl(undefined)).toBeUndefined();
    expect(representativeUrl({})).toBeUndefined();
    expect(representativeUrl({ url: "", surfaces: {} })).toBeUndefined();
  });

  it("keeps a surface without a readable ratio only as a last resort", () => {
    // 比率が読めない面は「一番縦長」の競争に勝たない。ただし他に候補が無ければ通る。
    expect(
      representativeUrl({
        surfaces: {
          unknown: { url: PC_URL },
          sp: { url: SP_URL, ratio: { width: 5, height: 4 } },
        },
      }),
    ).toBe(SP_URL);
    expect(representativeUrl({ surfaces: { unknown: { url: PC_URL } } })).toBe(
      PC_URL,
    );
  });
});

describe("resolveSiteSurfaces — 面ごとの出し分け", () => {
  it("旧形式 (url のみ・surfaces 無し): 全面が代表 1 枚に解決し、picture を組まない", () => {
    const r = resolveSiteSurfaces(manifestWith(ASSIGNED), DECL, FALLBACK);
    expect(r.src).toBe(ASSIGNED);
    expect(r.sources.map((s) => s.url)).toEqual([ASSIGNED]);
    // surface id で引けたわけではない = 代表への後退。
    expect(r.base.assigned).toBe(false);
    expect(r.sources[0].assigned).toBe(false);
    expect(r.artDirected).toBe(false);
  });

  it("新形式 (surfaces): 既定の面が img、media を持つ面が source になる", () => {
    const manifest = surfaceManifest(
      {
        sp: { url: SP_URL, ratio: { width: 5, height: 4 } },
        pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
      },
      SP_URL,
    );
    const r = resolveSiteSurfaces(manifest, DECL, FALLBACK);
    expect(r.base.id).toBe("sp");
    expect(r.base.media).toBeUndefined();
    expect(r.src).toBe(SP_URL);
    expect(r.sources).toEqual([
      { id: "pc", url: PC_URL, media: "(min-width: 1024px)", assigned: true },
    ]);
    expect(r.artDirected).toBe(true);
  });

  it("欠損 surface: 焼かれていない面だけが代表 url に後退する", () => {
    // PC だけ焼けている状態 (宣言に面を足した直後など)。
    const manifest = surfaceManifest(
      { pc: { url: PC_URL, ratio: { width: 864, height: 560 } } },
      ASSIGNED,
    );
    const r = resolveSiteSurfaces(manifest, DECL, FALLBACK);
    expect(r.src).toBe(ASSIGNED);
    expect(r.base.assigned).toBe(false);
    expect(r.sources[0]).toMatchObject({ id: "pc", url: PC_URL, assigned: true });
    expect(r.artDirected).toBe(true);
  });

  it("欠損 surface + 代表なし: 焼けている面が全面に回り、picture を組まない", () => {
    const manifest = surfaceManifest({
      pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
    });
    const r = resolveSiteSurfaces(manifest, DECL, FALLBACK);
    expect(r.src).toBe(PC_URL);
    expect(r.sources[0].url).toBe(PC_URL);
    expect(r.artDirected).toBe(false);
  });

  it("surface の url が空文字なら代表へ、代表も無ければ静的画像へ後退する", () => {
    const blank = surfaceManifest({ sp: { url: "" }, pc: { url: "  " } }, ASSIGNED);
    expect(resolveSiteSurfaces(blank, DECL, FALLBACK).src).toBe(ASSIGNED);

    const nothing = surfaceManifest({ sp: { url: "" }, pc: { url: null } });
    const r = resolveSiteSurfaces(nothing, DECL, FALLBACK);
    expect(r.src).toBe(FALLBACK);
    expect(r.sources[0].url).toBe(FALLBACK);
    expect(r.artDirected).toBe(false);
  });

  it("未割当 / マニフェスト不達: 全面が今の静的画像のまま (今日と同じ描画)", () => {
    for (const manifest of [{}, null, undefined] as const) {
      const r = resolveSiteSurfaces(manifest, DECL, FALLBACK);
      expect(r.src).toBe(FALLBACK);
      expect(r.sources.every((s) => s.url === FALLBACK)).toBe(true);
      expect(r.artDirected).toBe(false);
    }
  });

  it("別の枠の割当を拾わない", () => {
    const other = surfaceManifest({ sp: { url: SP_URL } }, ASSIGNED);
    const r = resolveSiteSurfaces(other, { ...DECL, id: "site:top:other-99" }, FALLBACK);
    expect(r.src).toBe(FALLBACK);
  });

  /**
   * 宣言が壊れていても描画は止めない (直すのは build ゲートの仕事で、公開ページを
   * 白くする理由ではない)。既定の面が無ければ先頭を繰り上げる。
   */
  it("既定の面が無い壊れた宣言でも、先頭の面を img に繰り上げて描き続ける", () => {
    const broken: SiteSlot = {
      ...DECL,
      surfaces: DECL.surfaces.map((s) => ({ ...s, media: "(min-width: 1px)" })),
    };
    const manifest = surfaceManifest({ sp: { url: SP_URL }, pc: { url: PC_URL } });
    const r = resolveSiteSurfaces(manifest, broken, FALLBACK);
    expect(r.base.id).toBe("sp");
    expect(r.src).toBe(SP_URL);
    // 繰り上げた面は source からは外す (img と二重に出さない)。
    expect(r.sources.map((s) => s.id)).toEqual(["pc"]);
  });

  it("surfaces を 1 件も持たない宣言でも例外を投げない", () => {
    const r = resolveSiteSurfaces(manifestWith(ASSIGNED), { ...DECL, surfaces: [] }, FALLBACK);
    expect(r.src).toBe(ASSIGNED);
    expect(r.sources).toEqual([]);
    expect(r.artDirected).toBe(false);
  });
});

/**
 * `assigned` — 写真が「当たっている」か「後退先で埋まっている」かの区別。
 *
 * これを間違えると、今日は灰色の面 (`ImagePlaceholder`) で置かれている写真枠が
 * 未割当のまま `fallbackSrc` を描き始める (= 静かな見た目の退行)。`src` を見ても
 * 区別できないので、由来そのものを測る。
 */
describe("resolveSiteSurfaces — assigned (割当の有無)", () => {
  it("未割当 (マニフェストに枠が無い) は false", () => {
    expect(resolveSiteSurfaces({}, DECL, FALLBACK).assigned).toBe(false);
    expect(resolveSiteSurfaces(null, DECL, FALLBACK).assigned).toBe(false);
  });

  it("面別 url が 1 つでもあれば true", () => {
    const manifest = surfaceManifest({ sp: { url: SP_URL } });
    expect(resolveSiteSurfaces(manifest, DECL, FALLBACK).assigned).toBe(true);
  });

  it("旧形式 (代表 url だけ) でも true — 面別に焼かれているかは別の話", () => {
    const r = resolveSiteSurfaces(manifestWith(ASSIGNED), DECL, FALLBACK);
    expect(r.assigned).toBe(true);
    // 1 枚しか無いので art direction は不要。両者が別物であることを固定する。
    expect(r.artDirected).toBe(false);
  });

  it("空文字・空白だけの url は「当たっていない」と数える", () => {
    expect(resolveSiteSurfaces(manifestWith("   "), DECL, FALLBACK).assigned).toBe(false);
    const manifest = surfaceManifest({ sp: { url: "" }, pc: { url: null } });
    expect(resolveSiteSurfaces(manifest, DECL, FALLBACK).assigned).toBe(false);
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

/**
 * getSiteImage は「マニフェスト取得」と「宣言 (public/site-slots.manifest.json) の
 * 面の集合」を合わせる。面の集合を決めるのは宣言側であることをここで固定する。
 */
describe("getSiteImage (compose)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("宣言の面ごとにマニフェストの url を割り当てる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(
          surfaceManifest(
            {
              sp: { url: SP_URL, ratio: { width: 5, height: 4 } },
              pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
            },
            SP_URL,
          ),
        ),
        { status: 200 },
      ),
    );
    const r = await getSiteImage(SLOT, FALLBACK);
    expect(r.src).toBe(SP_URL);
    expect(r.sources.map((s) => [s.id, s.url, s.media])).toEqual([
      ["pc", PC_URL, "(min-width: 1024px)"],
    ]);
    expect(r.artDirected).toBe(true);
  });

  it("マニフェストが取れなければ全面が今の静的画像のまま", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const r = await getSiteImage(SLOT, FALLBACK);
    expect(r.src).toBe(FALLBACK);
    expect(r.artDirected).toBe(false);
  });
});

/**
 * Tests for `SiteImage` — 割当マニフェストの面別 url をどう画面に出すか。
 *
 * `__tests__/site-assets.test.ts` が「どの url に解決するか」(純関数) を見るのに対し、
 * ここは **実際に出る DOM** を見る。分岐が 2 本あり、間違えたときの被害が大きい:
 *
 *   1. 1 枚で足りるとき (未割当 / 旧形式の代表 1 枚) は `<picture>` を組まず
 *      今までどおり next/image 1 本 — **未割当の枠が今日と寸分違わず描かれる**の
 *      担保はここ。`<picture>` を常に組む実装にすると、静的画像まで optimizer を
 *      外れて全ページの配信が静かに変わる。
 *   2. 面ごとに url が違うときだけ `<picture>` + `<source media>`。
 *      art direction は next/image では表現できない。
 *
 * マニフェスト取得 (fetch) から宣言 (public/site-slots.manifest.json) の面の集合まで
 * 通しで動かす。next/image は SSR させず印に差し替え、「どちらの枝が出たか」を測る。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/media/image-with-fallback", () => ({
  ImageWithFallback: ({ src, className }: { src: string; className?: string }) => (
    // next/image の差し替え印。どちらの枝が出たかを測るためだけの目印で、画面に出る要素ではない。
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="next-image" src={src} className={className} alt="" />
  ),
}));

import { SiteImage } from "@/components/site-image";

const SLOT = "site:top:hero-01";
const FALLBACK = "/hero-day.jpg";
const R2 = "https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/ELX";
const SP_URL = `${R2}/site_top_hero-01__sp.jpg`;
const PC_URL = `${R2}/site_top_hero-01__pc.jpg`;
const REPRESENTATIVE = `${R2}/site_top_hero-01.jpg`;

function mockManifest(body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

async function render(props: Record<string, unknown> = {}) {
  const element = await SiteImage({
    slotId: SLOT,
    src: FALLBACK,
    alt: "",
    width: 864,
    height: 560,
    ...props,
  } as Parameters<typeof SiteImage>[0]);
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SiteImage — 1 枚で足りるときは picture を組まない", () => {
  it("未割当 (マニフェスト不達) は next/image に静的画像を渡すだけ", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const html = await render();
    expect(html).not.toContain("<picture");
    expect(html).toContain('data-testid="next-image"');
    expect(html).toContain(`src="${FALLBACK}"`);
  });

  it("旧形式 (surfaces 無し・代表 url のみ) も next/image 1 本のまま", async () => {
    mockManifest({
      [SLOT]: {
        url: REPRESENTATIVE,
        asset_id: "elx-asset-1",
        updated_at: "2026-07-25T00:00:00Z",
      },
    });
    const html = await render();
    expect(html).not.toContain("<picture");
    expect(html).toContain(`src="${REPRESENTATIVE}"`);
  });

  it("全面が同じ url に焼かれている場合も picture は要らない", async () => {
    mockManifest({
      [SLOT]: {
        url: REPRESENTATIVE,
        surfaces: { sp: { url: REPRESENTATIVE }, pc: { url: REPRESENTATIVE } },
        asset_id: "elx-asset-1",
        updated_at: "2026-08-31T00:00:00Z",
      },
    });
    const html = await render();
    expect(html).not.toContain("<picture");
  });
});

describe("SiteImage — 面ごとに url が違えば picture で出し分ける", () => {
  const newShape = {
    [SLOT]: {
      url: SP_URL,
      surfaces: {
        sp: { url: SP_URL, ratio: { width: 5, height: 4 } },
        pc: { url: PC_URL, ratio: { width: 864, height: 560 } },
      },
      asset_id: "elx-asset-1",
      updated_at: "2026-08-31T00:00:00Z",
    },
  };

  it("条件付きの面が source、既定の面が img に出る", async () => {
    mockManifest(newShape);
    const html = await render();
    expect(html).toContain("<picture");
    expect(html).toContain(`<source media="(min-width: 1024px)" srcSet="${PC_URL}"/>`);
    // 既定の面 (SP) は <img> 側 = どの条件にも当たらないときに出る。
    expect(html).toContain(`src="${SP_URL}"`);
    // 代表 url に差し替わっていない (面別 url を素通りさせていないことの確認)。
    expect(html).not.toContain(`src="${FALLBACK}"`);
  });

  it("picture は display:contents なので親から見た子は今までどおり img 1 つ", async () => {
    mockManifest(newShape);
    const html = await render();
    expect(html).toContain('<picture class="contents">');
  });

  it("呼び出し側の className / style / alt はそのまま img に載る", async () => {
    mockManifest(newShape);
    const html = await render({
      className: "w-full object-cover",
      style: { aspectRatio: "var(--top-hero-ar)" },
      alt: "茶畑",
    });
    expect(html).toContain('class="w-full object-cover"');
    expect(html).toContain("aspect-ratio:var(--top-hero-ar)");
    expect(html).toContain('alt="茶畑"');
  });

  it("priority は eager + fetchpriority=high として素の img に翻訳される", async () => {
    mockManifest(newShape);
    const html = await render({ priority: true, quality: 90 });
    expect(html).toContain('loading="eager"');
    // React が出す属性名は fetchPriority (HTML の属性名は大小を区別しない)。
    expect(html).toMatch(/fetchpriority="high"/i);
    // next/image 専用の prop は DOM に流さない (素の img には無い属性)。
    expect(html).not.toMatch(/\spriority=/i);
    expect(html).not.toMatch(/\squality=/i);
  });

  it("priority 無しは lazy", async () => {
    mockManifest(newShape);
    const html = await render();
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/fetchpriority=/i);
  });

  it("欠損 surface: 焼けていない面だけが代表 url に後退する", async () => {
    mockManifest({
      [SLOT]: {
        url: REPRESENTATIVE,
        // SP がまだ焼けていない (宣言に面を足した直後)。
        surfaces: { pc: { url: PC_URL, ratio: { width: 864, height: 560 } } },
        asset_id: "elx-asset-1",
        updated_at: "2026-08-31T00:00:00Z",
      },
    });
    const html = await render();
    expect(html).toContain(`srcSet="${PC_URL}"`);
    expect(html).toContain(`src="${REPRESENTATIVE}"`);
  });
});

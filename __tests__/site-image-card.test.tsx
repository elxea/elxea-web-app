/**
 * Tests for `SiteImageCard` — 既存の写真枠 (`ImageCard`) を画像枠 (site slot) にする側。
 *
 * `SiteImage` (トップ Hero) との違いは 1 点だけで、そこが壊れると静かに退行する:
 *
 *   サイトの写真枠の大半は `<ImageCard image={undefined}>` = 灰色の面のまま置かれて
 *   いて、差し替える静的画像そのものが無い。よって **未割当のときは灰色の面を
 *   描き続けなければならない**。ここで `fallbackSrc` 相当の何かを描いてしまうと、
 *   写真を 1 枚も入稿していない段階で About / 定期便LP の見た目が変わる。
 *
 * あわせて「割当があるときは器 (比率) が動かない」ことも測る。器が作り直されると
 * 写真を入れた瞬間にレイアウトがずれるが、それは入稿担当には原因が見えない。
 *
 * next/image は SSR させず印に差し替え、どの枝が出たかを DOM で測る。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/media/image-with-fallback", () => ({
  ImageWithFallback: ({ src, className }: { src: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="next-image" src={src} className={className} alt="" />
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, className }: { src: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="next-image" src={src} className={className} alt="" />
  ),
}));

import { SiteImageCard } from "@/components/site-image-card";

/** 面が 1 つだけの枠 (About 産地タイル)。 */
const ONE_SURFACE = "site:about:origin-01";
/** 面が 2 つある枠 (About 01 わたしたちのこと) — art direction の経路。 */
const TWO_SURFACES = "site:about:us-01";

const R2 = "https://pub-90a0485599904fee8228ef56bb51c2e6.r2.dev/cdn/site/ELX";
const CMS_IMAGE = "https://cdn.sanity.io/images/x/y/today.jpg";

function mockManifest(body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

async function render(props: Record<string, unknown>) {
  const element = await SiteImageCard(
    props as Parameters<typeof SiteImageCard>[0],
  );
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SiteImageCard — 未割当は今日と同じ描画のまま", () => {
  it("マニフェスト不達・今日も写真が無い枠は灰色の面のまま (img を出さない)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const html = await render({ slotId: ONE_SURFACE, alt: "", aspectRatio: "19/14" });
    expect(html).toContain('data-slot="image-placeholder"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<picture");
  });

  it("枠がマニフェストに載っていても url が空なら灰色の面のまま", async () => {
    mockManifest({ [ONE_SURFACE]: { surfaces: { base: { url: "  " } } } });
    const html = await render({ slotId: ONE_SURFACE, alt: "", aspectRatio: "19/14" });
    expect(html).toContain('data-slot="image-placeholder"');
    expect(html).not.toContain("<img");
  });

  it("今日 CMS の写真が出ている枠は、未割当ならその写真を出し続ける", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const html = await render({
      slotId: ONE_SURFACE,
      image: CMS_IMAGE,
      alt: "",
      aspectRatio: "19/14",
    });
    expect(html).toContain(`src="${CMS_IMAGE}"`);
    expect(html).not.toContain('data-slot="image-placeholder"');
  });

  it("未割当でも器の比率は宣言どおり残る (枠が消えない)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const html = await render({ slotId: ONE_SURFACE, alt: "", aspectRatio: "19/14" });
    expect(html).toContain("aspect-ratio:19/14");
  });
});

describe("SiteImageCard — 割当があるときだけ写真に差し替わる", () => {
  it("1 面ぶんの割当は picture を組まずに写真 1 枚を出す", async () => {
    const url = `${R2}/site_about_origin-01__base.jpg`;
    mockManifest({ [ONE_SURFACE]: { surfaces: { base: { url } } } });
    const html = await render({ slotId: ONE_SURFACE, alt: "", aspectRatio: "19/14" });
    expect(html).toContain(`src="${url}"`);
    expect(html).not.toContain("<picture");
    expect(html).not.toContain('data-slot="image-placeholder"');
  });

  it("面ごとに url が違うときは picture + source media を出す", async () => {
    const sp = `${R2}/site_about_us-01__sp.jpg`;
    const pc = `${R2}/site_about_us-01__pc.jpg`;
    mockManifest({ [TWO_SURFACES]: { surfaces: { sp: { url: sp }, pc: { url: pc } } } });
    const html = await render({
      slotId: TWO_SURFACES,
      alt: "",
      // About の実際の呼び出しと同じ形。`ImageCard` は既定比 3/2 をインライン style で
      // 当てるので、BP ごとに比を変える枠は style 側を打ち消して utility に任せる。
      style: { aspectRatio: undefined },
      className: "aspect-[16/9] lg:aspect-[10/7]",
    });
    expect(html).toContain("<picture");
    expect(html).toContain('media="(min-width: 1024px)"');
    // PC 面は <source> に、SP 面 (既定の面) は <img src> に出る。
    expect(html).toContain(pc);
    expect(html).toContain(`src="${sp}"`);
    // 比はクラスに任せる — インライン style が残ると lg: の切替が効かなくなる。
    expect(html).not.toContain("aspect-ratio:3/2");
  });

  it("器の比率・className は割当の有無で変わらない", async () => {
    const url = `${R2}/site_about_origin-01__base.jpg`;
    mockManifest({ [ONE_SURFACE]: { surfaces: { base: { url } } } });
    const assigned = await render({
      slotId: ONE_SURFACE,
      alt: "",
      aspectRatio: "19/14",
      className: "rounded-none",
    });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const unassigned = await render({
      slotId: ONE_SURFACE,
      alt: "",
      aspectRatio: "19/14",
      className: "rounded-none",
    });

    /* 器 = 最初の <div> の開きタグ。
     *
     * 先頭から切り出さないのは、写真が出る側だけ React が
     * `<link rel="preload" as="image">` を先頭に持ち上げるため (React 19 が <img> に
     * 対して自動で出すもので、写真が無い側には出ない)。器の比較に混ぜない。 */
    const frameOf = (html: string) => /<div [^>]*>/.exec(html)?.[0] ?? html;
    expect(frameOf(assigned)).toBe(frameOf(unassigned));
    expect(frameOf(assigned)).toContain("aspect-ratio:19/14");
  });
});

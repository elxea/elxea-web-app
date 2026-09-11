/**
 * Tests for `AuthorProfile` (記事末尾の著者プロフィール枠) の写真スロット。
 *
 * 直した退行: 以前は `{author.image?.asset && (...)}` で、写真が無いと
 * **スロットごと消えていた**。本番の著者は 5 名とも `image` 未設定なので
 * (2026-09-11 GROQ 実測)、記事末尾は常に氏名だけが左端に寄った崩れた形で出ていた。
 *
 * ここで固定するのは 2 点:
 *   1. 写真が無くても枠は残り、頭文字の面が出る (レイアウトが崩れない)。
 *   2. 写真があるときは今までどおり実際の写真を出す (既定に置き換わらない)。
 *
 * 併せて「Sanity には何も書かない」設計も測る — 写真が無い枝で画像 URL を
 * 組み立てない (urlFor を呼ばない) ので、`author.image` は未設定のまま残り、
 * 写真運用の欠落検出 (経路5) はこの人を挙げ続ける。
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const urlFor = vi.fn(() => ({
  width: () => ({ height: () => ({ url: () => "https://cdn.sanity.io/images/x/real.jpg" }) }),
}));

vi.mock("@/sanity/lib/image", () => ({ urlFor: (...a: unknown[]) => urlFor(...(a as [])) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-testid="next-image" src={src} alt={alt} />
  ),
}));

const { AuthorProfile } = await import("@/components/journal/author-profile");

const base = { name: "Asako Sato", slug: { current: "asako-sato" }, role: "編集" };

describe("AuthorProfile の写真スロット", () => {
  it("写真が無くても枠が消えず、頭文字の面が出る", () => {
    urlFor.mockClear();
    const html = renderToStaticMarkup(
      <AuthorProfile author={base} writtenByLabel="この記事を書いた人" />,
    );
    expect(html).toContain('data-slot="person-placeholder"');
    expect(html).toContain(">A<");
    expect(html).not.toContain('data-testid="next-image"');
    // 画像 URL を組み立てない = Sanity 側は未設定のままで良い。
    expect(urlFor).not.toHaveBeenCalled();
  });

  it("写真があるときは実際の写真を出す (既定に置き換わらない)", () => {
    urlFor.mockClear();
    const html = renderToStaticMarkup(
      <AuthorProfile
        author={{ ...base, image: { asset: { _ref: "image-abc" } } }}
        writtenByLabel="この記事を書いた人"
      />,
    );
    expect(html).toContain('data-testid="next-image"');
    expect(html).not.toContain('data-slot="person-placeholder"');
    expect(urlFor).toHaveBeenCalledTimes(1);
  });

  it("実在の他人の実写を流用していない (既定の枝に img も外部 URL も無い)", () => {
    const html = renderToStaticMarkup(
      <AuthorProfile author={{ name: "Masayuki Kubo" }} writtenByLabel="x" />,
    );
    const slot = html.slice(html.indexOf("person-placeholder"));
    expect(slot).not.toContain("<img");
    expect(slot).not.toContain("https://");
  });
});

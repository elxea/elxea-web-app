/**
 * Tests for `PersonPlaceholder` — 顔写真がまだ無い人物枠に敷く「描画時の既定」。
 *
 * ここで固定したいのは 3 点。どれが崩れても静かに退行する:
 *
 *  1. **汎用枠は無地のまま**。`ImageCard` に `placeholder` を渡さない既存の
 *     呼び出し (About の産地タイル / 商品カード等) は、今までどおり中身ゼロの
 *     灰色の面を出す。Setaka 指示 2026-08-25 を覆していないことの担保。
 *  2. **写真が入ったら既定は出ない**。`placeholder` は「空のときだけ」の差し替えで、
 *     `children` のように常時上書きしない。ここが壊れると、本物の写真を入れた
 *     人の上に頭文字が重なる。
 *  3. **実写を使わない**。出すのは頭文字 1 文字で、`<img>` も外部 URL も持たない。
 *     掲載同意が未解決のあいだ、実在の人物の実写をここに置かない。
 *
 * あわせて「台帳が嘘をつかない」設計も測る: これは描画時の既定であって Sanity の
 * データではないので、`PersonPlaceholder` は画像 URL を一切生成しない。
 * `author.image` は未設定のまま残り、写真運用の欠落検出 (経路5) が引き続きこの人を
 * 「顔写真が無い」として挙げ続ける。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageCard } from "@/components/media/image-card";
import { PersonPlaceholder } from "@/components/media/person-placeholder";

describe("PersonPlaceholder", () => {
  it("氏名の 1 文字目を出す (ラテン文字は大文字に寄せる)", () => {
    const html = renderToStaticMarkup(<PersonPlaceholder name="asako sato" />);
    expect(html).toContain(">A<");
  });

  it("日本語の氏名はそのままの 1 文字", () => {
    const html = renderToStaticMarkup(<PersonPlaceholder name="佐藤 麻子" />);
    expect(html).toContain(">佐<");
  });

  it("結合文字を割らない (Array.from で取る)", () => {
    // 絵文字や結合文字が来ても文字化けした半端な符号単位を出さない。
    const html = renderToStaticMarkup(<PersonPlaceholder name="🍵 roji" />);
    expect(html).toContain(">🍵<");
  });

  it("氏名が空なら文字を出さず、無地の面になる", () => {
    for (const name of [undefined, null, "", "   "]) {
      const html = renderToStaticMarkup(<PersonPlaceholder name={name} />);
      expect(html).not.toContain("<svg");
      expect(html).toContain("bg-muted");
    }
  });

  it("実写を使わない — img タグも画像 URL も生成しない", () => {
    const html = renderToStaticMarkup(<PersonPlaceholder name="Masayuki Kubo" />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("http");
    // 装飾なので読み上げから外す。
    expect(html).toContain('aria-hidden="true"');
  });

  it("器の比率が違っても同じ図になる (枠ごとに font-size を調整しない)", () => {
    // viewBox + preserveAspectRatio で短辺に合わせて等比に収まる作り。
    const html = renderToStaticMarkup(<PersonPlaceholder name="Setaka" />);
    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});

describe("ImageCard の placeholder スロット", () => {
  const PLACEHOLDER_MARK = "person-placeholder";

  it("画像が無く placeholder も無ければ、従来どおり無地 (2026-08-25 の判断は不変)", () => {
    const html = renderToStaticMarkup(<ImageCard />);
    expect(html).toContain('data-slot="image-placeholder"');
    expect(html).not.toContain(PLACEHOLDER_MARK);
  });

  it("画像が無く placeholder があれば、そちらに差し替わる", () => {
    const html = renderToStaticMarkup(
      <ImageCard placeholder={<PersonPlaceholder name="Asako Sato" />} />,
    );
    expect(html).toContain(PLACEHOLDER_MARK);
    expect(html).toContain(">A<");
    expect(html).not.toContain('data-slot="image-placeholder"');
  });

  it("画像があれば placeholder は出ない (写真の上に頭文字を重ねない)", () => {
    const html = renderToStaticMarkup(
      <ImageCard
        image="https://cdn.sanity.io/images/x/production/abc-800x1000.jpg"
        alt="Asako Sato"
        placeholder={<PersonPlaceholder name="Asako Sato" />}
      />,
    );
    expect(html).not.toContain(PLACEHOLDER_MARK);
    expect(html).not.toContain('data-slot="image-placeholder"');
  });
});

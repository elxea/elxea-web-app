/**
 * 開発時だけ効く、Sanity の代わりに返すダミー銘柄。
 *
 * ## なぜ要るか
 *
 * 品目ページの産地の地図 (`TeaOriginBlock`) は Sanity `teaMenu.productNumber` が
 * `lib/roji/tea-origins.ts` の 5 桁銘柄番号と一致したときにだけ描かれる。
 * ところが Sanity 側の `teaMenu` は 2026-08 時点で `scripts/seed-dummy-content.ts`
 * が入れた 3 件 (productNumber = 1 / 2 / 3) しか無く、5 桁採番になっていない。
 * つまり **本番データを開いても地図は永久に出ない**。
 *
 * 実装が動いていることを実機で確認するには、実在の銘柄番号を持つ銘柄を
 * 品目ページ (`app/[locale]/(reading)/tea-menu/[slug]/page.tsx`) に流し込む必要が
 * ある。ここはそのための差し込み口。
 *
 * ## 効く条件
 *
 * - `process.env.NODE_ENV !== "production"` (本番ビルドでは一切通らない)
 * - slug が `fixture-` で始まる (実在 slug には触れない)
 *
 * 例: /ja/tea-menu/fixture-shibakiri   (10101 しばきり園 / 静岡県 静岡市)
 *     /ja/tea-menu/fixture-tsushima    (51001 つしま大石農園 / 長崎県 対馬市上県町)
 *
 * Sanity への書き込みは一切行わない (読みもしない — 単に置き換えるだけ)。
 */

export const DEV_FIXTURE_SLUG_PREFIX = "fixture-";

type TeaMenuFixture = Record<string, unknown>;

const TEA_MENU_FIXTURES: Record<string, TeaMenuFixture> = {
  "fixture-shibakiri": {
    _id: "dev-fixture-shibakiri",
    title: "しばきり園 山の息",
    slug: { current: "fixture-shibakiri", _type: "slug" },
    productNumber: "10101",
    category: "煎茶",
    displayName: "山の息",
    variety: "やぶきた",
    origin: "静岡県 静岡市",
    season: "一番茶 (4月下旬)",
    netWeight: 50,
    photo: null,
    description:
      "霧の朝に摘む。標高 400m の斜面で、日が差すのは午前だけ。渋みが立つ前に止めた火入れで、飲み口は水に近い。",
    color: "#C9D3C2",
    brewingGuide: { temperature: "70°C", water: "180ml", time: "90秒" },
    relatedArticle: null,
    shopifyHandle: null,
    seo: null,
    language: "ja",
  },
  "fixture-tsushima": {
    _id: "dev-fixture-tsushima",
    title: "つしま大石農園 島の緑",
    slug: { current: "fixture-tsushima", _type: "slug" },
    productNumber: "51001",
    category: "釜炒り茶",
    displayName: "島の緑",
    variety: "在来種",
    origin: "長崎県 対馬市上県町",
    season: "一番茶 (5月上旬)",
    netWeight: 40,
    photo: null,
    description:
      "対馬の北端、山と海のあいだの畑。潮の風が当たるぶん葉は厚く、釜で炒ると香りが前に出る。二煎目からが本番。",
    color: "#B7C6C4",
    brewingGuide: { temperature: "85°C", water: "200ml", time: "60秒" },
    relatedArticle: null,
    shopifyHandle: null,
    seo: null,
    language: "ja",
  },
};

/** dev fixture が担当する slug か。 */
export function isDevFixtureSlug(slug: unknown): slug is string {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof slug === "string" &&
    slug.startsWith(DEV_FIXTURE_SLUG_PREFIX)
  );
}

export function getTeaMenuFixture(slug: string): TeaMenuFixture | null {
  return TEA_MENU_FIXTURES[slug] ?? null;
}

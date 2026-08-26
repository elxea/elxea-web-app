/**
 * Seeded storefront catalogue (preview / CI only).
 *
 * ## なぜ必要か
 *
 * 商品カタログの唯一の供給元は Shopify Storefront API で、資格情報が無い環境
 * (CI / 資格情報なしのローカル) では `shopifyFetch` が
 * `Shopify API credentials not configured.` を投げる。その結果、商品まわりの
 * ページが **一様に「読み込めませんでした」へ退避**して、実際の画面仕様を
 * 一切検証できない状態になっていた。
 *
 * 実測 (2026-08-09 / run 31323434476 / 資格情報なしの dev サーバ):
 * - `/ja/products`            → 商品 0 件 (「商品を読み込めませんでした。」)
 * - `/ja/products/<不存在>`   → **200 + 読込エラー文** (404 にならない)
 * - `/ja/search?q=<不存在>`   → 「うまく検索できませんでした。」(= 0 件と区別不能)
 *
 * この 3 つはいずれも「Shopify が無い」という 1 つの原因の別の症状で、
 * 挙動としても誤っている (不存在 slug が 404 でないのは soft-404、
 * 0 件ヒットが障害文言になるのは利用者に嘘をついている)。
 *
 * ## 何をするか
 *
 * Shopify が **未設定のときだけ**、この見本カタログを供給元として使う。
 * これにより不存在 slug は `notFound()` に落ち (真の 404)、0 件検索は
 * 「見つかりませんでした」に落ちる。データは架空で、外部通信も
 * Shopify への書き込みも一切しない。
 *
 * ## 安全弁 (production を触らないこと)
 *
 * 2 条件の **両方**が成立したときだけ有効になる:
 *   1. `PREVIEW_SEED_STOREFRONT=1` (または統合フラグ `PREVIEW_SEED=1`)
 *   2. Shopify Storefront の資格情報が **未設定**
 *
 * production / Vercel Preview はどちらも資格情報を持つので、フラグを付けても
 * 見本には落ちない。つまり実障害 (Shopify のダウン・レート制限) を見本で
 * 覆い隠すことはない — 覆い隠せるのは「そもそも設定が無い」環境だけ。
 *
 * ## 意図的に持たせていないもの
 *
 * `sellingPlanGroups` は **空**にしてある。定期便 (SellingPlan) の導線は
 * Shopify の実契約が無いと成立せず、見本で「定期購入」ボタンだけ出しても
 * カート書き込みで必ず失敗する。定期便系 e2e は資格情報ゲートのまま残す。
 */

import { env } from "@/lib/config";
import { SEED_ID_PREFIX, previewImageForKey, previewSeedEnabled } from "@/lib/preview-seed";
import type { Product } from "@/lib/shopify/types";

/** 見本カタログを使ってよいか (フラグ側の条件のみ。資格情報判定は呼び出し側)。 */
export function previewSeedStorefrontEnabled(): boolean {
  return env("PREVIEW_SEED_STOREFRONT") === "1" || previewSeedEnabled();
}

type SeedSpec = {
  handle: string;
  title: string;
  productType: string;
  price: string;
  compareAt?: string;
  description: string;
  /**
   * 日本語 + 英語の両方を入れる。実 Shopify の商品も英語タグを持ち、
   * ストアフロント検索は `q=tea` のような英語語でヒットする
   * (e2e/search.spec.ts「search results show count or products」が
   * まさに `q=tea` を投げる)。日本語だけにすると見本カタログでは 0 件になり、
   * 「検索が動いている」ことを確認できなくなる。
   */
  tags: string[];
  variety: string;
  teaCategory: string;
  taste: string;
  aroma: string;
};

/**
 * 架空の 6 商品。
 *
 * `productType` は商品一覧のチップ (絞り込み) を実データから組む実装
 * (`app/[locale]/products/page.tsx`) に効くので、意味のある 3 種類に散らす。
 * 1 件だけ `compareAt` を持たせて参考価格の取り消し線を、1 件だけ
 * `availableForSale=false` にして「売り切れ」バッジを描画経路に載せる。
 */
const SEED_SPECS: SeedSpec[] = [
  {
    handle: "seed-sencha-asagiri",
    title: "煎茶 朝霧",
    productType: "煎茶",
    price: "1800",
    description:
      "静岡・本山の単一茶園から。朝の霧が育てた、青くやわらかな一番茶です。湯温は少し落として、香りを立たせてください。",
    tags: ["煎茶", "静岡", "一番茶", "tea", "green tea", "sencha"],
    variety: "やぶきた",
    teaCategory: "緑茶",
    taste: "やわらかな旨み",
    aroma: "青葉",
  },
  {
    handle: "seed-sencha-tsuyukusa",
    title: "煎茶 露草",
    productType: "煎茶",
    price: "2100",
    compareAt: "2400",
    description:
      "京都・和束の在来種。渋みの角を落とした、水色の淡い煎茶。二煎目から甘みが出ます。",
    tags: ["煎茶", "京都", "在来", "tea", "green tea", "sencha"],
    variety: "在来",
    teaCategory: "緑茶",
    taste: "淡い甘み",
    aroma: "花",
  },
  {
    handle: "seed-hojicha-yuhi",
    title: "ほうじ茶 夕陽",
    productType: "ほうじ茶",
    price: "1200",
    description:
      "福岡・八女の茎を強めに焙じました。夜に飲んでも重くならない、香ばしさだけのお茶です。",
    tags: ["ほうじ茶", "福岡", "茎茶", "tea", "roasted tea", "hojicha"],
    variety: "やぶきた",
    teaCategory: "緑茶",
    taste: "香ばしい",
    aroma: "焙煎",
  },
  {
    handle: "seed-wakoucha-akane",
    title: "和紅茶 茜",
    productType: "和紅茶",
    price: "2400",
    description:
      "鹿児島・霧島の紅茶。渋みが立たないので、砂糖も牛乳も要りません。冷やしても濁りません。",
    tags: ["和紅茶", "鹿児島", "tea", "black tea", "wakoucha"],
    variety: "べにふうき",
    teaCategory: "紅茶",
    taste: "まるい甘み",
    aroma: "熟した果実",
  },
  {
    handle: "seed-gyokuro-midori",
    title: "玉露 翠",
    productType: "玉露",
    price: "3600",
    description:
      "被覆栽培の玉露。低温で長く出して、少量を舌にのせてください。旨みの輪郭がはっきりします。",
    tags: ["玉露", "京都", "tea", "green tea", "gyokuro"],
    variety: "あさひ",
    teaCategory: "緑茶",
    taste: "濃い旨み",
    aroma: "海苔",
  },
  {
    handle: "seed-sencha-kagerou",
    title: "煎茶 陽炎",
    productType: "煎茶",
    price: "1600",
    description:
      "夏摘みの二番茶。渋みをそのまま活かして、氷水で出すお茶に向いています。",
    tags: ["煎茶", "静岡", "二番茶", "tea", "green tea", "sencha"],
    variety: "やぶきた",
    teaCategory: "緑茶",
    taste: "きりりとした渋み",
    aroma: "草",
  },
];

const jpy = (amount: string) => ({ amount, currencyCode: "JPY" });

function buildProduct(spec: SeedSpec, index: number): Product {
  const image = {
    url: previewImageForKey(spec.handle),
    altText: spec.title,
    width: 1600,
    height: 1067,
  };

  /* 1 件だけ売り切れにして在庫バッジの描画経路も見本で通す。
   *
   * ただし **createdAt が最も古い 1 件** を選ぶ。商品一覧の既定は
   * 新着順 (CREATED_AT / reverse) なので、最新の 1 件を売り切れにすると
   * 一覧の先頭カードが売り切れ商品になり、「一覧の最初の商品を開いて
   * バリアントを選ぶ」系の e2e (product.spec.ts「variant selector appears
   * when product has variants」) が disabled ボタンを掴んで固まる。
   * 一番古い = 既定順で最後尾なので、先頭は必ず購入可能な商品になる。 */
  const availableForSale = index !== 0;

  const variant = (size: string, amount: string, suffix: string) => ({
    id: `${SEED_ID_PREFIX}variant-${spec.handle}-${suffix}`,
    title: size,
    availableForSale,
    selectedOptions: [{ name: "内容量", value: size }],
    price: jpy(amount),
    compareAtPrice: spec.compareAt ? jpy(spec.compareAt) : null,
    image,
    sellingPlanAllocations: [],
  });

  const doubled = String(Number(spec.price) * 2 - 200);

  return {
    id: `${SEED_ID_PREFIX}product-${spec.handle}`,
    handle: spec.handle,
    title: spec.title,
    description: spec.description,
    descriptionHtml: `<p>${spec.description}</p>`,
    availableForSale,
    featuredImage: image,
    images: [image],
    options: [{ id: `${SEED_ID_PREFIX}option-${spec.handle}`, name: "内容量", values: ["50g", "100g"] }],
    variants: [variant("50g", spec.price, "50g"), variant("100g", doubled, "100g")],
    priceRange: { minVariantPrice: jpy(spec.price), maxVariantPrice: jpy(doubled) },
    seo: { title: spec.title, description: spec.description.slice(0, 120) },
    tags: spec.tags,
    vendor: "elxea",
    productType: spec.productType,
    // 並び替え (CREATED_AT) が意味を持つよう、1 日ずつずらした固定日付を振る。
    createdAt: `2026-0${(index % 9) + 1}-01T00:00:00Z`,
    updatedAt: `2026-0${(index % 9) + 1}-01T00:00:00Z`,
    sellingPlanGroups: [],
    metafields: {
      features: [],
      howToEnjoy: null,
      menuNumber: null,
      teaCategory: spec.teaCategory,
      variety: spec.variety,
      season: null,
      taste: spec.taste,
      aroma: spec.aroma,
    },
  };
}

/** 見本カタログ全件 (フラグ判定はしない。呼び出し側が判定する)。 */
export function seedProductCatalogue(): Product[] {
  return SEED_SPECS.map(buildProduct);
}

/** handle 一致の 1 件。未知の handle は `null` (= 呼び出し側で `notFound()`)。 */
export function seedProductByHandle(handle: string): Product | null {
  return seedProductCatalogue().find((p) => p.handle === handle) ?? null;
}

/**
 * 見本カタログに対する部分一致検索。
 *
 * 存在しない語は 0 件を返す。これが「0 件ヒット」と「検索が壊れている」を
 * 分ける唯一の条件なので、雑に全件返してはいけない。
 */
export function seedSearchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return seedProductCatalogue().filter((p) =>
    [p.title, p.description, p.productType, p.vendor, ...p.tags]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

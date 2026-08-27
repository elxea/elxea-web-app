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
import {
  SEED_ID_PREFIX,
  previewImageAt,
  previewImageForKey,
  previewSeedEnabled,
} from "@/lib/preview-seed";
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
  /* 見本カタログは **12 件 (`PAGE_SIZE`) を超える**必要がある。
     超えないと `app/[locale]/products/page.tsx` の `remaining > 0` が偽になり、
     「さらに N 件を表示」(`MoreRow`) が **1 度も描画されない**。つまり網羅表 G6 の
     導線が検査環境にだけ存在しない状態になり、押した瞬間に進行の印が出るか
     (憲章 R9 の `router-nav`) を CI で確かめられなくなる。
     商品画像を 1 枚から 3 枚に増やしたのと同じ理由 — **不具合が起きていた画面を、
     検査環境にも実在させる**。 */
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
  {
    handle: "seed-bancha-nagi",
    title: "番茶 凪",
    productType: "番茶",
    price: "1200",
    description:
      "三重・伊勢の秋番茶。日向のような香ばしさで、食事にも眠る前にも合います。熱湯でさっと。",
    tags: ["番茶", "三重", "秋摘み", "tea", "green tea", "bancha"],
    variety: "やぶきた",
    teaCategory: "緑茶",
    taste: "軽やかな甘み",
    aroma: "日向",
  },
  {
    handle: "seed-kabusecha-usuzumi",
    title: "かぶせ茶 薄墨",
    productType: "かぶせ茶",
    price: "2600",
    description:
      "福岡・八女。摘む前の一週間だけ覆いをかけた、旨みと青香のあいだの一杯。低めの湯でゆっくりと。",
    tags: ["かぶせ茶", "福岡", "八女", "tea", "green tea", "kabusecha"],
    variety: "さえみどり",
    teaCategory: "緑茶",
    taste: "厚い旨み",
    aroma: "覆い香",
  },
  {
    handle: "seed-genmaicha-koyomi",
    title: "玄米茶 暦",
    productType: "玄米茶",
    price: "1400",
    description:
      "炒り立ての玄米と煎茶を、香りが立つ比率で合わせています。湯を注いだ瞬間の香りがいちばんの見どころ。",
    tags: ["玄米茶", "京都", "焙煎", "tea", "green tea", "genmaicha"],
    variety: "やぶきた",
    teaCategory: "緑茶",
    taste: "香ばしい甘み",
    aroma: "炒り米",
  },
  {
    handle: "seed-kocha-tasogare",
    title: "和紅茶 黄昏",
    productType: "和紅茶",
    price: "2300",
    compareAt: "2600",
    description:
      "鹿児島・志布志の夏摘み。渋みを抑えた和紅茶で、ミルクを入れずにそのまま飲めます。",
    tags: ["和紅茶", "鹿児島", "夏摘み", "tea", "black tea", "wakoucha"],
    variety: "べにふうき",
    teaCategory: "紅茶",
    taste: "熟した果実",
    aroma: "黄昏",
  },
  {
    handle: "seed-sencha-hatsune",
    title: "煎茶 初音",
    productType: "煎茶",
    price: "1950",
    description:
      "奈良・月ヶ瀬の一番茶。摘みたての青さを残した浅蒸しで、一煎目は低め、二煎目は高めの湯で。",
    tags: ["煎茶", "奈良", "一番茶", "tea", "green tea", "sencha"],
    variety: "おくみどり",
    teaCategory: "緑茶",
    taste: "澄んだ旨み",
    aroma: "若葉",
  },
  {
    handle: "seed-hojicha-kogarashi",
    title: "ほうじ茶 木枯",
    productType: "ほうじ茶",
    price: "1300",
    description:
      "茎だけを強めに焙じました。香りは深いのに後口は軽く、夜に飲んでも障りません。",
    tags: ["ほうじ茶", "石川", "茎茶", "tea", "roasted", "hojicha"],
    variety: "やぶきた",
    teaCategory: "ほうじ茶",
    taste: "軽い甘み",
    aroma: "深い焙煎",
  },
  {
    handle: "seed-gyokuro-shizuku",
    title: "玉露 雫",
    productType: "玉露",
    price: "4200",
    compareAt: "4800",
    description:
      "京都・宇治。二十日の覆いをかけた一番茶を、40度の湯で少量ずつ。出汁のような濃さが出ます。",
    tags: ["玉露", "京都", "宇治", "tea", "green tea", "gyokuro"],
    variety: "ごこう",
    teaCategory: "緑茶",
    taste: "濃い旨み",
    aroma: "覆い香",
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

  /**
   * 写真は **3 枚**持たせる。
   *
   * 見本は長らく 1 枚だけだった。`components/product/image-gallery.tsx` は
   * `images.length > 1` のときしかサムネイル列を描かないので、**見本カタログでは
   * カルーセルが 1 度も描画されない**。つまり「サムネイルを押しても大きい写真が
   * すぐ出ない」(網羅表 G1 / 本番実測 705〜1,865ms) を、CI では原理的に
   * 再現できなかった — 不具合が起きていた画面が、検査環境にだけ存在しなかった。
   *
   * URL は 1 枚ずつ**必ず**変える。同じ URL を 3 つ並べると `next/image` が同じ
   * `_next/image?url=...` を返すので、「切替先を押す前に取ってあるか」の検査が
   * **常に真**になって空回りする (= 見ていない緑)。
   *
   * だから `previewImageForKey` (鍵をハッシュして候補から選ぶ) は使わない —
   * 候補は 6 枚しかなく、3 枚が同じに落ちることがある。代わりに
   * `previewImageAt` へ **連番**を渡して、隣り合わない 3 枚を確定で取る。
   * (`PREVIEW_SEED_DETERMINISTIC=1` のときは意図どおり 1 枚に潰れる。
   *  そちらはスクリーンショット回帰用で、e2e は使わない。)
   */
  const galleryImages = [0, 1, 2].map((offset) => ({
    url: previewImageAt(index * 3 + offset),
    altText: offset === 0 ? spec.title : `${spec.title} ${offset + 1}`,
    width: 1600,
    height: 1067,
  }));

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
    images: galleryImages,
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

/**
 * 見本のコレクション。
 *
 * ## なぜ要るか (通しテスト E-3 / 2026-08-27)
 *
 * トップの分類タイルと商品一覧の絞り込みは **コレクション**を通る導線を持つ
 * (`?category=<コレクション名>`)。ところが見本カタログは商品しか持たなかった
 * ので、資格情報の無い環境ではタイルが 1 枚も出ず、「押したら絞り込まれる」の
 * 検査が対象なしで素通りしていた。商品だけ見本にしても、**商品とコレクションの
 * 対応**という肝心の部分は確かめられない。
 *
 * ## 3 件が何を代表しているか
 *
 * 本番で起きていた 3 つの形をそのまま持つ (実測 2026-08-27):
 *   - `seed-assortment` … productType をまたぐ (どの productType とも一致しない)。
 *     旧実装が黙って「すべて」に落としていた形。
 *   - `seed-sencha` … productType と同名。チップ経由と同じ結果に着地すべき形。
 *   - `seed-empty` … 中身が 0 件。タイルにも一覧にも出してはいけない形。
 */
export type SeedCollection = {
  handle: string;
  title: string;
  description: string;
  /** 所属商品の handle。空配列 = 中身の無いコレクション。 */
  productHandles: string[];
};

const SEED_COLLECTIONS: SeedCollection[] = [
  {
    handle: "seed-assortment",
    title: "見本の詰め合わせ",
    description: "種類をまたいで選んだ見本の詰め合わせ。",
    productHandles: ["seed-sencha-asagiri", "seed-hojicha-yuhi", "seed-wakoucha-akane"],
  },
  {
    handle: "seed-sencha",
    title: "煎茶",
    description: "見本の煎茶。",
    productHandles: ["seed-sencha-asagiri", "seed-sencha-tsuyukusa", "seed-sencha-kagerou"],
  },
  {
    handle: "seed-empty",
    title: "見本の空コレクション",
    description: "枠だけ作って中身が入っていないコレクション。",
    productHandles: [],
  },
];

export function seedCollections(): SeedCollection[] {
  return SEED_COLLECTIONS;
}

/** handle 一致の所属商品。未知の handle は空配列。 */
export function seedCollectionProductHandles(handle: string): string[] {
  return SEED_COLLECTIONS.find((c) => c.handle === handle)?.productHandles ?? [];
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

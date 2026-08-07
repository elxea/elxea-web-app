import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { decodeHandle } from "@/lib/handle";
import { getProductByHandle, getProducts } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { ImageGallery } from "@/components/product/image-gallery";
import { VariantSelector } from "@/components/product/variant-selector";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { ProductPurchaseOptions } from "@/components/product/product-purchase-options";
import { FavoriteButton } from "@/components/product/favorite-button";
import { TasteMap, type TastePoint } from "@/components/product/taste-map";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { CatalogCard, CatalogGrid } from "@/components/catalog/catalog-list";
import { ChapterBreak, bodySmClass, captionClass, overlineClass } from "@/components/editorial/rule-list";
import {
  Ledger,
  OpenFaqList,
  PageSection,
  SectionBody,
  SectionHead,
  SectionNote,
  SpecBand,
  StepCards,
  TripleColumn,
} from "@/components/editorial/section-blocks";
import { ImageCard } from "@/components/ui/image-card";
import { cn } from "@/lib/utils";

/**
 * 商品詳細 — Figma【R2: 確定版】(PC 8056:1517 / SP 8057:1700)。
 *
 * B案トップビュー (左ギャラリー 7col / 右 購入カラム 5col sticky) +
 * 味×香りマトリクス + 章切りを挟む読み物構成。CTA は購入カラムの 1 個だけで、
 * 煽り文・バッジ・会員ランク要素は置かない (Figma の確定仕様)。
 *
 * Figma 実測 (px) → 実装の対応:
 * - 本体 2 カラム  PC 752 + gap32 + 528 (= 1312)  → `lg:grid-cols-12` の 7 / 5
 * - SP ギャラリー  x0 w375 (全幅)                  → `-mx-(--page-margin) lg:mx-0`
 * - スペック帯     PC 4列 304 gap32 / SP 2列       → `SpecBand`
 * - 味の記憶       PC 3列 416 gap32 / SP 縦積み    → `TripleColumn`
 * - フルスペック   PC 2カラム台帳 / SP 1カラム     → `Ledger`
 * - FAQ            アコーディオンなし・開いたまま  → `OpenFaqList`
 * - 関連商品       PC 3枚 / SP 2枚                 → `CatalogGrid` (C3-1 と同一)
 *
 * 既知の差分 (忠実度対比表の【要判断】と対応):
 * - 読みもの (ArticleCard x3) は Journal データ未配線のため未実装
 * - 数量 Stepper と SP の sticky 購入バーは既存カート部品に該当が無く未実装
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: rawHandle } = await params;
  const handle = decodeHandle(rawHandle);
  const t = await getTranslations("common");
  const fallback: Metadata = { title: t("products") };
  try {
    const product = await getProductByHandle(handle);
    if (!product) return fallback;
    return {
      title: product.title,
      description: product.seo.description || product.description?.slice(0, 160),
      openGraph: {
        title: product.title,
        description: product.seo.description || product.description?.slice(0, 160),
        images: product.featuredImage ? [{ url: product.featuredImage.url }] : [],
      },
    };
  } catch {
    return fallback;
  }
}

/** 味×香りマトリクスの点。位置は Figma 実測の比率 (8056:1647-1655)。 */
const TASTE_POINTS: readonly Omit<TastePoint, "label">[] = [
  { x: 26.5, y: 20.5 },
  { x: 56.8, y: 35.6, align: "left" },
  { x: 75, y: 62.9 },
  { x: 25, y: 73.5 },
];

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { handle: rawHandle, locale } = await params;
  const handle = decodeHandle(rawHandle);
  const currentSearchParams = await searchParams;
  const t = await getTranslations("product");
  const tc = await getTranslations("common");
  const td = await getTranslations("productDetail");

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch {
    return (
      <div className="page-container py-16">
        <p className={cn(bodySmClass, "text-muted-foreground")}>{t("loadError")}</p>
      </div>
    );
  }

  if (!product) notFound();

  const selectedVariant =
    product.variants.find((v) =>
      v.selectedOptions.every((opt) => currentSearchParams[opt.name] === opt.value)
    ) || product.variants[0];

  const mf = product.metafields;

  // 近い茶葉 — 同一商品を除いた先頭 3 件 (SP は 2 件目まで表示)。
  let related: Awaited<ReturnType<typeof getProducts>>["products"] = [];
  try {
    const res = await getProducts({ first: 6 });
    related = res.products.filter((p) => p.handle !== product.handle).slice(0, 3);
  } catch {
    related = [];
  }

  /**
   * スペック帯 — Figma 確定版 8056:1558「スペック帯 (4カラム定義リスト)」の
   * ラベル 品種 / 産地 / 摘採 / 仕上げ が正。4 列固定なので値が無い列も
   * ラベルを残し `—` にフォールバックする (台帳と違い列を落とすと崩れるため)。
   *
   * 「仕上げ」は Figma のサンプル値が「浅蒸し／中火の火入れ」= 蒸し度・火入れの
   * 加工仕様であり、茶種 (`teaCategory` = Shopify `custom._type-of-tea`, 実データ
   * 「緑茶」) とは別物。従来は teaCategory を当てていたため (a) ラベルと意味が
   * 食い違い (b) フルスペック台帳の「茶種」行と同値の二重表示になっていた。
   * 加工仕様に対応する metafield は `lib/shopify/index.ts` のマップに存在しない
   * ため、実データが増えるまで `—` フォールバック固定とする。
   */
  const specItems = [
    { term: t("teaVariety"), value: mf.variety || td("specVarietyFallback") },
    { term: td("specOrigin"), value: product.vendor || td("specOriginFallback") },
    { term: td("specHarvest"), value: mf.season || td("specHarvestFallback") },
    { term: td("specFinish"), value: td("specFinishFallback") },
  ];

  const tasteItems = [
    { title: t("teaAroma"), body: mf.aroma || td("tasting1Body") },
    { title: td("tasting2Title"), body: td("tasting2Body") },
    { title: td("tasting3Title"), body: td("tasting3Body") },
  ];

  const brewSteps = [1, 2, 3].map((n) => ({
    step: `0${n}`,
    name: td(`brew${n}Name`),
    body: td(`brew${n}Body`),
  }));

  /**
   * フルスペック台帳 — 旧 `ProductFeatures` の「お茶の詳細」を吸収した唯一の SoT。
   *
   * Setaka 裁定 (2026-08-08)「データのある行だけ表示」に従い、値の出所を 2 種類に
   * 絞る:
   *  1. Shopify metafield / product フィールドの実値 — **値が無い行は出さない**
   *  2. 商品によらないブランド共通の定数 (保存 / 賞味期限) — 常時表示
   *
   * 従来あった「Figma に行はあるが対応 metafield が存在しない」項目
   * (栽培 / 標高 / 土壌 / 火入れ / 粉砕) は常に `—` にしかならないため行定義ごと
   * 削除した。商品固有の値をハードコードした定型文は置かない。
   */
  const ledgerRows = [
    ...(
      [
        { term: td("specSheet1Term"), value: mf.teaCategory },
        { term: t("teaVariety"), value: mf.variety },
        { term: td("specOrigin"), value: product.vendor },
        { term: td("specHarvest"), value: mf.season },
        { term: t("teaTaste"), value: mf.taste },
        { term: t("teaAroma"), value: mf.aroma },
        { term: t("menuNumber"), value: mf.menuNumber },
      ] as const
    )
      .filter((row): row is { term: string; value: string } =>
        Boolean(row.value && row.value.trim())
      )
      .map((row) => ({ term: row.term, value: row.value })),
    { term: td("specSheet7Term"), value: td("specSheet7Value") },
    { term: td("specSheet8Term"), value: td("specSheet8Value") },
  ];

  const faqItems = [1, 2, 3, 4].map((n) => ({
    q: td(`faqQ${n}`),
    a: td(`faqA${n}`),
  }));

  const tastePoints: TastePoint[] = TASTE_POINTS.map((p, i) => ({
    ...p,
    label: td(`tastePoint${i + 1}`),
  }));

  const legendRows = [1, 2, 3].map((n) => ({
    term: td(`tasteLegend${n}Term`),
    body: td(`tasteLegend${n}Body`),
  }));

  return (
    <div data-slot="product-detail">
      {/* Breadcrumb 帯 (Figma 8056:1519 / SP 8057:1704) */}
      <div className="page-container py-3 lg:py-6 [&_nav]:mb-0">
        <Breadcrumb
          items={[
            { label: tc("home"), href: "/" },
            { label: tc("products"), href: "/products" },
            { label: product.title },
          ]}
          locale={locale}
        />
      </div>

      {/* 本体 2 カラム (Figma 8056:1521) */}
      <div className="page-container grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-8">
        <div className="-mx-(--page-margin) lg:col-span-7 lg:mx-0">
          <ImageGallery images={product.images} />
        </div>

        <div
          data-slot="purchase-column"
          className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start"
        >
          {product.vendor ? (
            <p className={cn(overlineClass, "text-muted-foreground")}>{product.vendor}</p>
          ) : null}

          <h1 className="mt-5 lg:mt-6">{product.title}</h1>

          {product.description ? (
            <p className={cn(bodySmClass, "mt-5 whitespace-pre-line text-muted-foreground lg:mt-6")}>
              {product.description}
            </p>
          ) : null}

          {product.sellingPlanGroups.length === 0 && (
            <p
              className={cn(
                "[font:var(--typography-style-h3)] [letter-spacing:var(--typography-style-h3-tracking)]",
                "mt-5 text-foreground lg:mt-6"
              )}
            >
              {formatPrice(selectedVariant.price.amount, selectedVariant.price.currencyCode)}
            </p>
          )}

          <hr className="mt-5 border-border lg:mt-6" />

          <div className="mt-5 flex flex-col gap-6 lg:mt-6">
            <Suspense fallback={null}>
              <VariantSelector options={product.options} variants={product.variants} />
            </Suspense>

            {product.sellingPlanGroups.length > 0 ? (
              <ProductPurchaseOptions
                merchandiseId={selectedVariant.id}
                availableForSale={selectedVariant.availableForSale}
                sellingPlanGroups={product.sellingPlanGroups}
                sellingPlanAllocations={selectedVariant.sellingPlanAllocations}
                productName={product.title}
                price={selectedVariant.price.amount}
                currencyCode={selectedVariant.price.currencyCode}
                subscriptionOnly
              />
            ) : (
              <AddToCartButton
                merchandiseId={selectedVariant.id}
                availableForSale={selectedVariant.availableForSale}
                productName={product.title}
                price={selectedVariant.price.amount}
                currencyCode={selectedVariant.price.currencyCode}
              />
            )}

            <FavoriteButton
              productHandle={product.handle}
              productTitle={product.title}
              productImageUrl={product.featuredImage?.url ?? null}
              addLabel={t("addToFavorites")}
              removeLabel={t("removeFromFavorites")}
              addedMessage={t("addedToFavorites")}
              removedMessage={t("removedFromFavorites")}
              errorMessage={t("favoriteError")}
              loginRequiredMessage={t("loginRequiredForFavorite")}
              variant="text"
              className="w-full"
            />
          </div>

          <hr className="mt-5 border-border lg:mt-6" />

          <ul className="mt-5 flex flex-col gap-2 lg:mt-6">
            {[1, 2, 3].map((n) => (
              <li key={n} className={cn(captionClass, "text-muted-foreground")}>
                {td(`note${n}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* スペック帯 (Figma 8056:1558) */}
      <PageSection>
        <SpecBand items={specItems} />
      </PageSection>

      {/* 味×香りマトリクス (Figma 8056:1617) */}
      <PageSection>
        <SectionHead overline={td("tasteMapOverline")} title={td("tasteMapTitle")} />
        <SectionBody>
          <TasteMap
            points={tastePoints}
            legendLead={td("tasteMapLead")}
            legendRows={legendRows}
          />
        </SectionBody>
        <SectionNote>{td("tasteMapNote")}</SectionNote>
      </PageSection>

      {/* 味の記憶 (Figma 8056:1573) */}
      <PageSection>
        <SectionHead overline={td("tastingOverline")} title={td("tastingTitle")} />
        <SectionBody>
          <TripleColumn items={tasteItems} />
        </SectionBody>
      </PageSection>

      {/* 淹れ方の目安 (Figma 8056:1590) */}
      <PageSection>
        <SectionHead overline={td("brewOverline")} title={td("brewTitle")} />
        <SectionBody>
          <StepCards items={brewSteps} />
        </SectionBody>
        <SectionNote>{td("brewNote")}</SectionNote>
      </PageSection>

      {/* フルスペック表 (Figma 8056:1668) */}
      <PageSection>
        <SectionHead overline={td("specSheetOverline")} />
        <SectionBody>
          <Ledger rows={ledgerRows} />
        </SectionBody>
      </PageSection>

      {/* 章切り (Figma 8056:1735) */}
      <ChapterBreak title={td("chapterTitle")}>{td("chapterBody")}</ChapterBreak>

      {/* 畑のこと (Figma 8056:1738) */}
      <PageSection>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center lg:gap-8">
          <div className="lg:col-span-6">
            <ImageCard
              image={product.featuredImage?.url}
              alt={td("fieldTitle")}
              aspectRatio="3/2"
            />
          </div>
          <div className="lg:col-span-5 lg:col-start-8">
            <p className={cn(overlineClass, "text-muted-foreground")}>{td("fieldOverline")}</p>
            <h2 className="mt-5 lg:mt-2">{td("fieldTitle")}</h2>
            <p className={cn(bodySmClass, "mt-5 text-muted-foreground lg:mt-8")}>
              {td("fieldBody")}
            </p>
          </div>
        </div>
      </PageSection>

      {/* よくある質問 (Figma 8056:1715) */}
      <PageSection>
        <SectionHead overline={td("faqOverline")} />
        <SectionBody>
          <OpenFaqList items={faqItems} />
        </SectionBody>
      </PageSection>

      {/* 関連商品 (Figma 8056:1608) */}
      {related.length > 0 ? (
        <PageSection>
          <SectionHead overline={td("alsoOverline")} title={td("alsoTitle")} />
          <SectionBody>
            <CatalogGrid>
              {related.map((p, i) => (
                <CatalogCard
                  key={p.handle}
                  href={`/products/${p.handle}`}
                  image={p.featuredImage?.url}
                  imageAlt={p.title}
                  overline={p.vendor}
                  title={p.title}
                  meta={formatPrice(
                    p.priceRange.minVariantPrice.amount,
                    p.priceRange.minVariantPrice.currencyCode
                  )}
                  /* Figma は SP 2 枚 / PC 3 枚 (8057:1790 / 8056:1613)。 */
                  className={i === 2 ? "hidden lg:flex" : undefined}
                />
              ))}
            </CatalogGrid>
          </SectionBody>
        </PageSection>
      ) : null}
    </div>
  );
}

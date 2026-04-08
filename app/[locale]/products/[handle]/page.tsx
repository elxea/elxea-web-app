import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { ImageGallery } from "@/components/product/image-gallery";
import { VariantSelector } from "@/components/product/variant-selector";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { ProductPurchaseOptions } from "@/components/product/product-purchase-options";
import { ProductFeatures } from "@/components/product/product-features";
import { FavoriteButton } from "@/components/product/favorite-button";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  try {
    const product = await getProductByHandle(handle);
    if (!product) return {};
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
    return {};
  }
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { handle } = await params;
  const currentSearchParams = await searchParams;
  const t = await getTranslations("product");

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch {
    return (
      <div className="section-wide">
        <p className="text-muted">{t("loadError")}</p>
      </div>
    );
  }

  if (!product) notFound();

  // Find selected variant
  const selectedVariant =
    product.variants.find((v) =>
      v.selectedOptions.every(
        (opt) => currentSearchParams[opt.name] === opt.value
      )
    ) || product.variants[0];

  return (
    <div className="section-wide py-20">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-20">
        {/* Images */}
        <ImageGallery images={product.images} />

        {/* Info */}
        <div className="space-y-6">
          {product.vendor && (
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
              {product.vendor}
            </p>
          )}

          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-normal">{product.title}</h1>
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
              className="shrink-0 mt-0.5"
            />
          </div>

          {product.sellingPlanGroups.length === 0 && (
            <p className="text-base text-muted-foreground">
              {formatPrice(
                selectedVariant.price.amount,
                selectedVariant.price.currencyCode
              )}
            </p>
          )}

          <Suspense fallback={null}>
            <VariantSelector
              options={product.options}
              variants={product.variants}
            />
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

          {product.description && (
            <div className="pt-10 mt-4 border-t border-border">
              <p className="text-[13px] text-muted-foreground leading-loose whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Featured content from Operations Hub */}
      <Suspense fallback={null}>
        <ProductFeatures metafields={product.metafields} />
      </Suspense>
    </div>
  );
}

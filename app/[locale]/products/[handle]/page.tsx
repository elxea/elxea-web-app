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
  const { handle, locale } = await params;
  const currentSearchParams = await searchParams;
  const t = await getTranslations("product");
  const tCommon = await getTranslations("common");

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16">
        <p className="text-muted-foreground">{t("loadError")}</p>
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
    <div className="max-w-7xl mx-auto px-6 py-16">
      <Breadcrumb
        locale={locale}
        items={[
          { label: tCommon("home"), href: "/" },
          { label: tCommon("products"), href: "/products" },
          { label: product.title },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Images */}
        <ImageGallery images={product.images} />

        {/* Info */}
        <div className="space-y-8">
          {product.vendor && (
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {product.vendor}
            </p>
          )}

          <h1>{product.title}</h1>

          <p className="text-lg">
            {formatPrice(
              selectedVariant.price.amount,
              selectedVariant.price.currencyCode
            )}
          </p>

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
            <div className="pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

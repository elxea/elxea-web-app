import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { ImageGallery } from "@/components/product/image-gallery";
import { VariantSelector } from "@/components/product/variant-selector";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { ProductJsonLd } from "@/components/seo/json-ld";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { ProductViewTracker } from "@/components/product/product-view-tracker";

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
  const ct = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");
  const locale = await getLocale();

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
      <ProductViewTracker
        id={product.id}
        name={product.title}
        price={parseFloat(selectedVariant.price.amount)}
        currency={selectedVariant.price.currencyCode}
        brand={product.vendor}
        variant={selectedVariant.title !== "Default Title" ? selectedVariant.title : undefined}
      />
      <ProductJsonLd
        name={product.title}
        description={product.description}
        image={product.featuredImage?.url}
        url={`https://elxea.com/${locale}/products/${handle}`}
        price={selectedVariant.price.amount}
        currency={selectedVariant.price.currencyCode}
        availability={selectedVariant.availableForSale}
        brand={product.vendor}
      />
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: ct("products"), href: "/products" },
          { label: product.title },
        ]}
        locale={locale}
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

          <AddToCartButton
            merchandiseId={selectedVariant.id}
            availableForSale={selectedVariant.availableForSale}
            productName={product.title}
            price={selectedVariant.price.amount}
            currency={selectedVariant.price.currencyCode}
            variant={selectedVariant.title !== "Default Title" ? selectedVariant.title : undefined}
          />

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

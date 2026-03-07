import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { ImageGallery } from "@/components/product/image-gallery";
import { VariantSelector } from "@/components/product/variant-selector";
import { AddToCartButton } from "@/components/product/add-to-cart-button";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { handle } = await params;
  const currentSearchParams = await searchParams;

  let product;
  try {
    product = await getProductByHandle(handle);
  } catch {
    return (
      <div className="max-w-7xl mx-auto px-6 py-16">
        <p className="text-muted">商品を読み込めませんでした。</p>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Images */}
        <ImageGallery images={product.images} />

        {/* Info */}
        <div className="space-y-8">
          {product.vendor && (
            <p className="text-[12px] text-light uppercase tracking-wider">
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
          />

          {product.description && (
            <div className="pt-8 border-t border-border">
              <p className="text-[14px] text-muted leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

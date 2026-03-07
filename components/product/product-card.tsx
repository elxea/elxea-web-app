import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/lib/shopify/types";

export function ProductCard({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  const comparePrice = product.variants[0]?.compareAtPrice;

  return (
    <Link href={`/products/${product.handle}`} className="group block">
      {/* Image */}
      <div className="aspect-square bg-surface mb-4 overflow-hidden">
        {product.featuredImage ? (
          <Image
            src={product.featuredImage.url}
            alt={product.featuredImage.altText || product.title}
            width={600}
            height={600}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-light text-[13px]">
            No Image
          </div>
        )}
      </div>

      {/* Info */}
      <div className="space-y-1.5">
        {product.vendor && (
          <p className="text-[12px] text-light">{product.vendor}</p>
        )}
        <h3 className="text-[14px] font-medium leading-snug group-hover:underline">
          {product.title}
        </h3>
        <div className="flex items-center gap-2">
          <p className="text-[14px]">
            {formatPrice(price.amount, price.currencyCode)}
          </p>
          {comparePrice && parseFloat(comparePrice.amount) > parseFloat(price.amount) && (
            <p className="text-[13px] text-light line-through">
              {formatPrice(comparePrice.amount, comparePrice.currencyCode)}
            </p>
          )}
        </div>
        {!product.availableForSale && (
          <p className="text-[12px] text-error">Sold Out</p>
        )}
      </div>
    </Link>
  );
}

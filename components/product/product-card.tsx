import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import type { Product } from "@/lib/shopify/types";

export function ProductCard({ product }: { product: Product }) {
  const t = useTranslations("common");
  const price = product.priceRange.minVariantPrice;
  const comparePrice = product.variants[0]?.compareAtPrice;

  return (
    <Link href={`/products/${product.handle}`} className="group block">
      {/* Image */}
      <div className="aspect-[3/2] bg-muted mb-4 overflow-hidden rounded-md">
        {product.featuredImage ? (
          <Image
            src={product.featuredImage.url}
            alt={product.featuredImage.altText || product.title}
            width={600}
            height={400}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </div>

      {/* Info */}
      <div className="space-y-1.5">
        {product.vendor && (
          <p className="text-xs text-muted-foreground">{product.vendor}</p>
        )}
        <h2 className="text-sm font-medium leading-snug group-hover:underline">
          {product.title}
        </h2>
        <div className="flex items-center gap-2">
          <p className="text-sm">
            {formatPrice(price.amount, price.currencyCode)}
          </p>
          {comparePrice && parseFloat(comparePrice.amount) > parseFloat(price.amount) && (
            <p className="text-sm text-muted-foreground line-through">
              {formatPrice(comparePrice.amount, comparePrice.currencyCode)}
            </p>
          )}
        </div>
        {!product.availableForSale && (
          <Badge variant="destructive" className="text-xs">
            {t("soldOut")}
          </Badge>
        )}
      </div>
    </Link>
  );
}

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ImageCard } from "@/components/media/image-card";
import type { Product } from "@/lib/shopify/types";

export function ProductCard({ product }: { product: Product }) {
  const t = useTranslations("common");
  const price = product.priceRange.minVariantPrice;
  const comparePrice = product.variants[0]?.compareAtPrice;

  return (
    <Link href={`/products/${product.handle}`} className="group block">
      {/* Image */}
      <ImageCard
        image={product.featuredImage?.url}
        alt={product.featuredImage?.altText || product.title}
        className="mb-5"
        hover
      />

      {/* Info */}
      <div className="space-y-2 text-center">
        {product.vendor && (
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{product.vendor}</p>
        )}
        <h2 className="text-sm font-normal leading-relaxed group-hover:underline underline-offset-4">
          {product.title}
        </h2>
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground">
            {formatPrice(price.amount, price.currencyCode)}
          </p>
          {comparePrice && parseFloat(comparePrice.amount) > parseFloat(price.amount) && (
            <p className="text-sm text-muted-foreground/60 line-through">
              {formatPrice(comparePrice.amount, comparePrice.currencyCode)}
            </p>
          )}
        </div>
        {!product.availableForSale && (
          <Badge variant="destructive" className="text-[10px]">
            {t("soldOut")}
          </Badge>
        )}
      </div>
    </Link>
  );
}

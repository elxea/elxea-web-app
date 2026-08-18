import { useTranslations } from "next-intl";

import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CatalogCard } from "@/components/catalog/catalog-list";
import type { Product } from "@/lib/shopify/types";

/**
 * 商品カード — Figma "ProductCard (Proposed) — elxea/EC products"
 * (商品一覧 8061:1807 ほか / R2 確定版) の実装。
 *
 * 骨格 (写真 aspect 3/2 → gap → 情報 3 行・左寄せ) は `CatalogCard` が持つ。
 * ここは EC 固有の中身 (価格・参考価格・在庫バッジ) だけを渡す。
 */
export function ProductCard({ product }: { product: Product }) {
  const t = useTranslations("common");
  const price = product.priceRange.minVariantPrice;
  const comparePrice = product.variants[0]?.compareAtPrice;
  const onSale =
    comparePrice && parseFloat(comparePrice.amount) > parseFloat(price.amount);

  return (
    <CatalogCard
      href={`/products/${product.handle}`}
      image={product.featuredImage?.url}
      imageAlt={product.featuredImage?.altText || product.title}
      overline={product.vendor || undefined}
      title={product.title}
      meta={
        <span className="flex items-baseline gap-2">
          <span>{formatPrice(price.amount, price.currencyCode)}</span>
          {onSale ? (
            <span className="text-muted-foreground/60 line-through">
              {formatPrice(comparePrice.amount, comparePrice.currencyCode)}
            </span>
          ) : null}
        </span>
      }
      footer={
        !product.availableForSale ? (
          <Badge variant="destructive">{t("soldOut")}</Badge>
        ) : null
      }
    />
  );
}

import { useTranslations } from "next-intl";
import type { Product } from "@/lib/shopify/types";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import { ProductCard } from "./product-card";

export function ProductGrid({ products }: { products: Product[] }) {
  const t = useTranslations("product");

  if (products.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-12">
        {t("noProducts")}
      </p>
    );
  }

  return (
    <CatalogGrid>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </CatalogGrid>
  );
}

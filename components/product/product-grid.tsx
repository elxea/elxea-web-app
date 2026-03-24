import { useTranslations } from "next-intl";
import type { Product } from "@/lib/shopify/types";
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

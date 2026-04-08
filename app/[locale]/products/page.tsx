import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getProducts } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";

export const metadata: Metadata = {
  title: "Products",
  description: "Browse our specialty coffee and tea collection.",
};

export default async function ProductsPage() {
  const t = await getTranslations("common");

  return (
    <div className="section-wide py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Collection
        </p>
        <h1>{t("products")}</h1>
      </div>
      <ProductsContent />
    </div>
  );
}

async function ProductsContent() {
  try {
    const { products } = await getProducts({ first: 20 });
    return <ProductGrid products={products} />;
  } catch {
    const { getTranslations } = await import("next-intl/server");
    const t = await getTranslations("product");
    return (
      <p className="text-muted-foreground text-sm">
        {t("loadError")}
      </p>
    );
  }
}

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
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-12">{t("products")}</h1>
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

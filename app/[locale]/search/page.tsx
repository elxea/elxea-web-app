import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { searchProducts } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";
import { SearchForm } from "@/components/search-form";

export const metadata: Metadata = {
  title: "Search",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { q } = await searchParams;
  const t = await getTranslations("search");

  let results = null;
  if (q) {
    try {
      results = await searchProducts(q);
    } catch {
      // Search will show error below
    }
  }

  return (
    <div className="section-wide py-20">
      <SearchForm initialQuery={q || ""} />

      {q && results && (
        <div className="mt-16">
          <p className="text-sm text-muted-foreground mb-8">
            {t("results", { count: results.totalCount })}
          </p>
          <ProductGrid products={results.products} />
        </div>
      )}

      {q && !results && (
        <p className="text-muted-foreground text-sm mt-12">
          {t("loadError")}
        </p>
      )}
    </div>
  );
}

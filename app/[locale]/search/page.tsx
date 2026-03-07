import { getTranslations } from "next-intl/server";
import { searchProducts } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";
import { SearchForm } from "@/components/search-form";

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
    <div className="max-w-7xl mx-auto px-6 py-16">
      <SearchForm initialQuery={q || ""} />

      {q && results && (
        <div className="mt-12">
          <p className="text-[13px] text-muted mb-8">
            {t("results", { count: results.totalCount })}
          </p>
          <ProductGrid products={results.products} />
        </div>
      )}

      {q && !results && (
        <p className="text-muted text-[14px] mt-12">
          {t("loadError")}
        </p>
      )}
    </div>
  );
}

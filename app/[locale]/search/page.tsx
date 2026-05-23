import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { searchProducts } from "@/lib/shopify";
import { ProductGrid } from "@/components/product/product-grid";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";

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

  const popularKeywords = [
    t("popularKeyword1"),
    t("popularKeyword2"),
    t("popularKeyword3"),
  ];

  const isLoadError = Boolean(q) && !results;
  const isZeroResult = Boolean(q) && results !== null && results.totalCount === 0;
  const hasResults = Boolean(q) && results !== null && results.totalCount > 0;
  const isInitialEmpty = !q;

  return (
    <div className="section-wide py-20">
      <SearchForm initialQuery={q || ""} />

      {hasResults && (
        <div className="mt-16">
          <p className="text-sm text-muted-foreground mb-8">
            {t("results", { count: results!.totalCount })}
          </p>
          <ProductGrid products={results!.products} />
        </div>
      )}

      {isZeroResult && (
        <div className="mt-16 flex flex-col gap-12" role="status" aria-live="polite">
          <p className="text-base text-foreground">
            {t("emptyZeroTitle", { query: q })}
          </p>

          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("emptyZeroHintsLabel")}
            </p>
            <ul className="list-disc list-inside text-sm text-foreground space-y-1">
              <li>{t("emptyZeroHint1")}</li>
              <li>{t("emptyZeroHint2")}</li>
              <li>{t("emptyZeroHint3")}</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("browseLabel")}
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href="/products"
                className="text-sm text-foreground underline underline-offset-4 hover:no-underline w-fit"
              >
                {t("browseAllProducts")}
              </Link>
              <Link
                href="/collections"
                className="text-sm text-foreground underline underline-offset-4 hover:no-underline w-fit"
              >
                {t("browseCollections")}
              </Link>
            </div>
          </div>
        </div>
      )}

      {isInitialEmpty && (
        <div className="mt-16 flex flex-col gap-12">
          <div className="flex flex-col gap-2">
            <h2 className="text-foreground">
              {t("emptyNoQueryTitle")}
            </h2>
            <p className="text-sm text-foreground">
              {t("emptyNoQueryDescription")}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("popularKeywordsLabel")}
            </p>
            <div className="flex flex-wrap gap-2">
              {popularKeywords.map((keyword) => (
                <Badge key={keyword} variant="outline" asChild>
                  <Link href={`/search?q=${encodeURIComponent(keyword)}`}>
                    {keyword}
                  </Link>
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("browseLabel")}
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href="/products"
                className="text-sm text-foreground underline underline-offset-4 hover:no-underline w-fit"
              >
                {t("browseAllProducts")}
              </Link>
              <Link
                href="/collections"
                className="text-sm text-foreground underline underline-offset-4 hover:no-underline w-fit"
              >
                {t("browseCollections")}
              </Link>
            </div>
          </div>
        </div>
      )}

      {isLoadError && (
        <p className="text-muted-foreground text-sm mt-12">
          {t("loadError")}
        </p>
      )}
    </div>
  );
}

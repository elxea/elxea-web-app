import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import {
  ARTICLES_QUERY,
  ARTICLES_BY_CATEGORY_QUERY,
  CATEGORIES_QUERY,
} from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";
import { CategoryFilter } from "@/components/journal/category-filter";
import { ImageCard } from "@/components/ui/image-card";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { getRecommendedArticles } from "@/lib/recommendations/content-engine";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  return (
    <div className="section-wide">
      <JournalHeader />
      <Suspense fallback={<ArticlesListSkeleton />}>
        <ArticlesList categorySlug={category ?? null} />
      </Suspense>
    </div>
  );
}

function JournalHeader() {
  const t = useTranslations("journal");
  return (
    <div className="mb-16">
      <div className="text-center mb-10">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Journal
        </p>
        <h1 className="mb-6">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">{t("description")}</p>
      </div>
    </div>
  );
}

function ArticlesListSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <ImageCard className="mb-4" />
          <div className="space-y-2">
            <div className="h-3 bg-muted w-16" />
            <div className="h-4 bg-muted w-3/4" />
            <div className="h-3 bg-muted w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

type ArticleItem = {
  _id: string;
  slug: { current: string };
  title: string;
  excerpt?: string;
  thumbnail?: { asset: object; alt?: string };
  mainImage?: { asset: object; alt?: string };
  publishedAt?: string;
  memberOnly?: boolean;
  category?: { title: string; slug: { current: string } };
  tags?: { _id: string; title: string; slug: { current: string } }[];
  author?: { name: string; image?: { asset: object } };
  contentPersona?: string | string[] | null;
  depthLevel?: string | null;
  targetLayer?: string | null;
};

async function ArticlesList({ categorySlug }: { categorySlug: string | null }) {
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");

  try {
    const client = getClient();
    const [rawCategories, rawArticles] = await Promise.all([
      client.fetch(CATEGORIES_QUERY),
      categorySlug
        ? client.fetch(ARTICLES_BY_CATEGORY_QUERY, {
            language: locale,
            categorySlug,
            start: 0,
            end: 30,
          })
        : client.fetch(ARTICLES_QUERY, {
            language: locale,
            start: 0,
            end: 30,
          }),
    ]);

    // Deduplicate categories by title (Sanity may have ja/en variants with same title)
    const seen = new Set<string>();
    const categories = (rawCategories ?? []).filter(
      (cat: { title: string }) => {
        const key = cat.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
    );

    // Resolve the authenticated user (gracefully — no error thrown for guests)
    let customerId: string | null = null;
    try {
      const auth = await requireAuth();
      if (auth.authenticated) {
        customerId = auth.customerId;
      }
    } catch {
      // Unauthenticated — fall through with customerId = null
    }

    // Apply personalization scoring
    const articles = await getRecommendedArticles({
      customerId,
      rawArticles: rawArticles as ArticleItem[],
    });

    return (
      <>
        {categories && categories.length > 0 && (
          <CategoryFilter
            categories={categories}
            activeSlug={categorySlug}
            allLabel={tCommon("viewAll")}
          />
        )}
        {!articles || articles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
            {articles.map((article) => (
              <ArticleCard
                key={article._id}
                article={article}
                locale={locale}
                memberOnlyLabel={tCommon("memberOnly")}
              />
            ))}
          </div>
        )}
      </>
    );
  } catch {
    return (
      <p className="text-muted-foreground text-sm">{t("loadError")}</p>
    );
  }
}

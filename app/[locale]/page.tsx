import { Suspense } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getClient } from "@/sanity/lib/client";
import { FEATURED_ARTICLES_QUERY } from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";

export default function HomePage() {
  const t = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[80vh] flex items-center justify-center">
        <Image
          src="/hero-day.jpg"
          alt=""
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="relative text-center max-w-xl px-6">
          <p className="text-xs text-white/80 uppercase tracking-[0.2em] mb-6">
            {t("home.tagline")}
          </p>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-6 text-white">
            Tea for Creativity.
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-10">
            {t("home.hero")}
          </p>
          <Button variant="outline" className="border-white text-white hover:bg-white hover:text-foreground" asChild>
            <Link href="/products">{t("common.products")}</Link>
          </Button>
        </div>
      </section>

      {/* Featured Products */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.featuredProducts")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
            <Link href="/products">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <Suspense fallback={<FeaturedProductsSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </section>

      {/* Our Story — full-width image section */}
      <section className="relative min-h-[50vh] flex items-center justify-center">
        <Image
          src="/hero-night.jpg"
          alt=""
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="relative text-center max-w-lg px-6">
          <p className="text-xs text-white/70 uppercase tracking-[0.2em] mb-4">
            Our Story
          </p>
          <h2 className="text-2xl md:text-3xl font-light text-white mb-6">
            {t("home.storyHeading")}
          </h2>
          <Button variant="outline" className="border-white text-white hover:bg-white hover:text-foreground" asChild>
            <Link href="/about">{t("common.about")}</Link>
          </Button>
        </div>
      </section>

      {/* Journal */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.latestJournal")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
            <Link href="/journal">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <Suspense fallback={<ArticlesSkeleton />}>
          <FeaturedArticles />
        </Suspense>
      </section>

      {/* Events */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="flex items-end justify-between mb-10">
          <h2>{t("home.upcomingEvents")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
            <Link href="/events">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {t("home.eventsPlaceholder")}
        </p>
      </section>

      {/* Approach — full-width image section */}
      <section className="relative min-h-[50vh] flex items-center justify-center">
        <Image
          src="/hero-approach.jpg"
          alt=""
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="relative text-center max-w-lg px-6">
          <p className="text-xs text-white/70 uppercase tracking-[0.2em] mb-4">
            Our Approach
          </p>
          <h2 className="text-2xl md:text-3xl font-light text-white mb-6">
            {t("home.approachHeading")}
          </h2>
          <Button variant="outline" className="border-white text-white hover:bg-white hover:text-foreground" asChild>
            <Link href="/about">{t("common.about")}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

function FeaturedProductsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/2] w-full mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArticlesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/2] w-full mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function FeaturedProducts() {
  try {
    const { getProducts } = await import("@/lib/shopify");
    const { ProductGrid } = await import(
      "@/components/product/product-grid"
    );
    const { products } = await getProducts({ first: 6 });
    return <ProductGrid products={products} />;
  } catch {
    const { getTranslations } = await import("next-intl/server");
    const t = await getTranslations("home");
    return (
      <p className="text-muted-foreground text-sm">
        {t("productsPlaceholder")}
      </p>
    );
  }
}

async function FeaturedArticles() {
  const locale = await getLocale();
  const t = await getTranslations();

  try {
    const client = getClient();
    const articles = await client.fetch(FEATURED_ARTICLES_QUERY, {
      language: locale,
    });

    if (!articles || articles.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("home.journalPlaceholder")}
        </p>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
        {articles.map(
          (article: {
            _id: string;
            slug: { current: string };
            title: string;
            excerpt?: string;
            thumbnail?: { asset: object; alt?: string };
            mainImage?: { asset: object; alt?: string };
            publishedAt?: string;
            memberOnly?: boolean;
            category?: { title: string; slug: { current: string } };
            author?: { name: string; image?: { asset: object } };
          }) => (
            <ArticleCard
              key={article._id}
              article={article}
              locale={locale}
              memberOnlyLabel={t("common.memberOnly")}
            />
          )
        )}
      </div>
    );
  } catch {
    return (
      <p className="text-muted-foreground text-sm">
        {t("home.journalPlaceholder")}
      </p>
    );
  }
}

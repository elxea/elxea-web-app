import { Suspense } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getClient } from "@/sanity/lib/client";
import { FEATURED_ARTICLES_QUERY, EVENTS_QUERY } from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";
import { urlFor } from "@/sanity/lib/image";

export default function HomePage() {
  const t = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center justify-center">
        <Image
          src="/hero-day.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative text-center max-w-2xl px-8">
          <p className="text-[11px] text-white/80 uppercase tracking-[0.25em] mb-8">
            {t("home.tagline")}
          </p>
          <h1 className="mb-8 text-white">
            Tea for Creativity.
          </h1>
          <p className="text-white/70 text-sm leading-relaxed mb-12 max-w-md mx-auto">
            {t("home.hero")}
          </p>
          <Button variant="outline" className="border-white/50 text-white bg-transparent hover:bg-white hover:text-foreground hover:border-white transition-colors" asChild>
            <Link href="/products">{t("common.products")}</Link>
          </Button>
        </div>
      </section>

      {/* Featured Products */}
      <section className="section-wide py-24">
        <div className="flex flex-col items-center text-center mb-16">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Discover
          </p>
          <h2 className="mb-6">{t("home.featuredProducts")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground text-sm" asChild>
            <Link href="/products">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <Suspense fallback={<FeaturedProductsSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </section>

      {/* Our Story — full-width image section */}
      <section className="relative min-h-[60vh] flex items-center justify-center">
        <Image
          src="/hero-night.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative text-center max-w-xl px-8">
          <p className="text-[11px] text-white/80 uppercase tracking-[0.25em] mb-6">
            Our Story
          </p>
          <h2 className="text-white mb-8">
            {t("home.storyHeading")}
          </h2>
          <Button variant="outline" className="border-white/50 text-white bg-transparent hover:bg-white hover:text-foreground hover:border-white transition-colors" asChild>
            <Link href="/about">{t("common.about")}</Link>
          </Button>
        </div>
      </section>

      {/* Journal */}
      <section className="section-wide py-24">
        <div className="flex flex-col items-center text-center mb-16">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Stories
          </p>
          <h2 className="mb-6">{t("home.latestJournal")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground text-sm" asChild>
            <Link href="/journal">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <Suspense fallback={<ArticlesSkeleton />}>
          <FeaturedArticles />
        </Suspense>
      </section>

      {/* Events */}
      <Suspense fallback={null}>
        <UpcomingEvents />
      </Suspense>

      {/* Approach — full-width image section */}
      <section className="relative min-h-[60vh] flex items-center justify-center">
        <Image
          src="/hero-approach.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative text-center max-w-xl px-8">
          <p className="text-[11px] text-white/80 uppercase tracking-[0.25em] mb-6">
            Our Approach
          </p>
          <h2 className="text-white mb-8">
            {t("home.approachHeading")}
          </h2>
          <Button variant="outline" className="border-white/50 text-white bg-transparent hover:bg-white hover:text-foreground hover:border-white transition-colors" asChild>
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

async function UpcomingEvents() {
  const locale = await getLocale();
  const t = await getTranslations();

  try {
    const client = getClient();
    const events = await client.fetch(EVENTS_QUERY, { language: locale });

    if (!events || events.length === 0) {
      return null;
    }

    const upcomingEvents = events.slice(0, 3) as Array<{
      _id: string;
      slug: { current: string };
      image?: { asset: object; alt?: string };
      title: string;
      date: string;
      endDate?: string;
      location?: string;
    }>;

    return (
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="flex flex-col items-center text-center mb-16">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
            Upcoming
          </p>
          <h2 className="mb-6">{t("home.upcomingEvents")}</h2>
          <Button variant="link" className="p-0 h-auto text-muted-foreground text-sm" asChild>
            <Link href="/events">{t("common.viewAll")} →</Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {upcomingEvents.map((event) => (
            <Link key={event._id} href={`/events/${event.slug.current}`} className="group block">
              <div className="aspect-[4/3] bg-muted overflow-hidden mb-4">
                {event.image?.asset ? (
                  <Image
                    src={urlFor(event.image).width(400).height(300).url()}
                    alt={event.title}
                    width={400}
                    height={300}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {event.title}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                {new Date(event.date).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                {event.location && ` · ${event.location}`}
              </p>
              <p className="text-sm">{event.title}</p>
            </Link>
          ))}
        </div>
      </section>
    );
  } catch {
    return null;
  }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
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

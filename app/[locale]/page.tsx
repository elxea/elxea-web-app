import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { getClient } from "@/sanity/lib/client";
import { FEATURED_ARTICLES_QUERY, EVENTS_QUERY } from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";
import { urlFor } from "@/sanity/lib/image";
import { previewSeedEnabled, isSeedId } from "@/lib/preview-seed";

/**
 * 変A section header for data-driven blocks (Products / Journal / Events):
 * eyebrow + title on the left, "view all" pinned to the right on the same row.
 * Plain function (no hooks) so it is safe in both client and async-server callers.
 */
function SectionHeader({
  eyebrow,
  title,
  viewAllHref,
  viewAllLabel,
}: {
  eyebrow: string;
  title: string;
  viewAllHref: string;
  viewAllLabel: string;
}) {
  return (
    <div className="flex items-end justify-between gap-6 mb-12 md:mb-16">
      <div className="flex flex-col">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-3">
          {eyebrow}
        </p>
        <h2>{title}</h2>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 border-border text-muted-foreground hover:text-foreground"
        asChild
      >
        <Link href={viewAllHref}>{viewAllLabel} →</Link>
      </Button>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return {
    title: t("tagline"),
    description: t("hero"),
    openGraph: {
      title: t("tagline"),
      description: t("hero"),
    },
  };
}

export default function HomePage() {
  const t = useTranslations();

  return (
    <>
      {/* Hero — 変A: left-aligned content over the day/night image (image + fallback preserved) */}
      <section className="relative min-h-[90vh] flex items-center justify-start">
        <ImageWithFallback
          src="/hero-day.jpg"
          fallbackSrc="/placeholder-hero-day.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-overlay" />
        <div className="relative w-full max-w-7xl mx-auto px-6 md:px-8">
          <div className="max-w-xl text-left">
            <p className="text-[11px] text-overlay-foreground-muted uppercase tracking-[0.25em] mb-8">
              {t("home.tagline")}
            </p>
            <h1 className="hero-display mb-6 text-overlay-foreground">
              Tea for Creativity.
            </h1>
            <p className="text-overlay-foreground-muted text-sm leading-relaxed mb-10 max-w-md">
              {t("home.hero")}
            </p>
            <Button
              variant="outline"
              className="border-overlay-border text-overlay-foreground bg-transparent hover:bg-overlay-foreground hover:text-foreground hover:border-overlay-foreground transition-colors"
              asChild
            >
              <Link href="/products">{t("common.products")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="section-wide py-24">
        <SectionHeader
          eyebrow="Discover"
          title={t("home.featuredProducts")}
          viewAllHref="/products"
          viewAllLabel={t("common.viewAll")}
        />
        <Suspense fallback={<FeaturedProductsSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </section>

      {/* Our Story — full-width image section (image + fallback preserved) */}
      <section className="relative min-h-[60vh] flex items-center justify-center">
        <ImageWithFallback
          src="/hero-night.jpg"
          fallbackSrc="/placeholder-hero-night.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-overlay" />
        <div className="relative text-center max-w-xl px-8">
          <p className="text-[11px] text-overlay-foreground-muted uppercase tracking-[0.25em] mb-6">
            Our Story
          </p>
          <h2 className="text-overlay-foreground mb-8">
            {t("home.storyHeading")}
          </h2>
          <Button
            variant="outline"
            className="border-overlay-border text-overlay-foreground bg-transparent hover:bg-overlay-foreground hover:text-foreground hover:border-overlay-foreground transition-colors"
            asChild
          >
            <Link href="/about">{t("common.about")}</Link>
          </Button>
        </div>
      </section>

      {/* Journal — 変A: 2-column editorial grid */}
      <section className="section-wide py-24">
        <SectionHeader
          eyebrow="Stories"
          title={t("home.latestJournal")}
          viewAllHref="/journal"
          viewAllLabel={t("common.viewAll")}
        />
        <Suspense fallback={<ArticlesSkeleton />}>
          <FeaturedArticles />
        </Suspense>
      </section>

      {/* Events */}
      <Suspense fallback={null}>
        <UpcomingEvents />
      </Suspense>

      {/* Approach — full-width image section (image + fallback preserved) */}
      <section className="relative min-h-[60vh] flex items-center justify-center">
        <ImageWithFallback
          src="/hero-approach.jpg"
          fallbackSrc="/placeholder-hero-approach.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-overlay" />
        <div className="relative text-center max-w-xl px-8">
          <p className="text-[11px] text-overlay-foreground-muted uppercase tracking-[0.25em] mb-6">
            Our Approach
          </p>
          <h2 className="text-overlay-foreground mb-8">
            {t("home.approachHeading")}
          </h2>
          <Button
            variant="outline"
            className="border-overlay-border text-overlay-foreground bg-transparent hover:bg-overlay-foreground hover:text-foreground hover:border-overlay-foreground transition-colors"
            asChild
          >
            <Link href="/about">{t("common.about")}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

function FeaturedProductsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/2] w-full mb-5" />
          <div className="space-y-2 flex flex-col items-center">
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-12 max-w-[840px] mx-auto">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[3/2] w-full mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Preview-only seed for the Upcoming Events section.
 *
 * Local preview points at the *production* Sanity dataset, which currently has
 * no future-dated events, so UpcomingEvents renders null and the section
 * disappears. To review the page at Figma density WITHOUT writing anything to
 * the production dataset, set PREVIEW_SEED_EVENTS=1 in the preview process env
 * only. When the flag is unset the behaviour is byte-identical to before
 * (normal Sanity fetch), so production deploys are unaffected.
 *
 * `imageUrl` points at existing local /public assets (placeholder imagery for
 * preview; real event photos land via Sanity in production).
 */
function getSeedEvents(): Array<{
  _id: string;
  slug: { current: string };
  imageUrl?: string;
  image?: { asset: object; alt?: string };
  title: string;
  date: string;
  endDate?: string;
  location?: string;
}> {
  return [
    {
      _id: "seed-event-1",
      slug: { current: "seed-event-1" },
      imageUrl: "/hero-day.jpg",
      title: "Morning Tea Ceremony",
      date: "2026-07-25T01:00:00.000Z",
      location: "elxea Studio, Tokyo",
    },
    {
      _id: "seed-event-2",
      slug: { current: "seed-event-2" },
      imageUrl: "/hero-night.jpg",
      title: "Farmer's Table: Single-Origin Tasting",
      date: "2026-08-08T09:00:00.000Z",
      location: "Kyoto Farmhouse",
    },
    {
      _id: "seed-event-3",
      slug: { current: "seed-event-3" },
      imageUrl: "/hero-approach.jpg",
      title: "Creativity & Tea Workshop",
      date: "2026-08-22T05:30:00.000Z",
      location: "elxea Gallery, Osaka",
    },
  ];
}

async function UpcomingEvents() {
  const locale = await getLocale();
  const t = await getTranslations();

  try {
    const seedEnabled = previewSeedEnabled();
    const events = seedEnabled
      ? getSeedEvents()
      : await getClient().fetch(EVENTS_QUERY, { language: locale });

    if (!events || events.length === 0) {
      return null;
    }

    const upcomingEvents = events.slice(0, 3) as Array<{
      _id: string;
      slug: { current: string };
      imageUrl?: string;
      image?: { asset: object; alt?: string };
      title: string;
      date: string;
      endDate?: string;
      location?: string;
    }>;

    return (
      <section className="max-w-7xl mx-auto px-6 py-24">
        <SectionHeader
          eyebrow="Upcoming"
          title={t("home.upcomingEvents")}
          viewAllHref="/events"
          viewAllLabel={t("common.viewAll")}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
          {upcomingEvents.map((event) => {
            const seeded = isSeedId(event._id);
            const inner = (
              <>
                {/* EventCard (Figma 6598:155): aspect-3/2 + rounded-md frame */}
                <div className="aspect-[3/2] bg-muted overflow-hidden rounded-md mb-4">
                  {event.imageUrl ? (
                    <Image
                      src={event.imageUrl}
                      alt={event.title}
                      width={400}
                      height={300}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : event.image?.asset ? (
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
                <p className="text-xs text-muted-foreground mb-1.5">
                  {new Date(event.date).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <h3 className="text-sm font-medium leading-relaxed mb-1.5 group-hover:underline underline-offset-4">
                  {event.title}
                </h3>
                {event.location && (
                  <p className="text-sm text-muted-foreground">
                    {t("event.locationLabel")}：{event.location}
                  </p>
                )}
              </>
            );

            // Seed (dummy) events have no real detail route -> render non-linked.
            if (seeded) {
              return (
                <div key={event._id} className="block cursor-default">
                  {inner}
                </div>
              );
            }

            return (
              <Link
                key={event._id}
                href={`/events/${event.slug.current}`}
                className="group block"
              >
                {inner}
              </Link>
            );
          })}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-12 max-w-[840px] mx-auto">
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

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { EVENT_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { getMembershipTier } from "@/lib/shopify/auth";
import type { MembershipTier } from "@/lib/shopify/customer";
import { MemberGate } from "@/components/ui/member-gate";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { Button } from "@/components/ui/button";
import { EventRegisterButton } from "@/components/events/event-register-button";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const event = await client.fetch(EVENT_BY_SLUG_QUERY, { slug, language: locale });
    if (!event) return {};
    const image = event.image?.asset ? urlFor(event.image).width(1200).url() : undefined;
    return {
      title: event.title,
      description: event.location ? `${event.title} — ${event.location}` : event.title,
      openGraph: {
        title: event.title,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("event");
  const tCommon = await getTranslations("common");

  let event;
  try {
    const client = getClient();
    event = await client.fetch(EVENT_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <div className="section-narrow">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!event) notFound();

  // Membership tier gating
  const requiredTier: MembershipTier = event.requiredTier ?? (event.memberOnly ? "standard" : "none");
  const isGated = requiredTier !== "none";
  const userTier = isGated ? await getMembershipTier() : "none" as MembershipTier;
  const tierRank: Record<MembershipTier, number> = { none: 0, standard: 1, premium: 2 };
  const hasAccess = !isGated || tierRank[userTier] >= tierRank[requiredTier];

  return (
    <div className="section-narrow">
      {/* 変A: breadcrumb */}
      <nav className="mb-8 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          {tCommon("home")}
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/events" className="hover:text-foreground transition-colors">
          {tCommon("events")}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{event.title}</span>
      </nav>

      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
            Event
          </p>
          {isGated && (
            <span className="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
              {tCommon("memberOnly")}
            </span>
          )}
        </div>
        <h1 className="mb-8">{event.title}</h1>

        {/* 変A: bordered info table */}
        <div className="border border-border divide-y divide-border text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="shrink-0 text-muted-foreground">{t("dateLabel")}</span>
            <span className="text-right">
              {new Date(event.date).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              {event.endDate &&
                ` — ${new Date(event.endDate).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}`}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="shrink-0 text-muted-foreground">{t("locationLabel")}</span>
              <span className="text-right">{event.location}</span>
            </div>
          )}
        </div>
      </header>

      {event.image?.asset && (
        <div className="mb-16 -mx-6 sm:mx-0 sm:rounded-none">
          <ImageWithFallback
            src={urlFor(event.image).width(1200).url()}
            fallbackSrc="/placeholder-hero-approach.jpg"
            alt={event.title}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full h-auto object-cover"
            priority
          />
        </div>
      )}

      {hasAccess ? (
        <>
          {/* One-tap event registration */}
          <div className="mb-12">
            <EventRegisterButton
              eventSlug={slug}
              eventTitle={event.title}
              eventDate={event.date ?? null}
              eventImageUrl={
                event.image?.asset
                  ? urlFor(event.image).width(600).url()
                  : null
              }
              registerLabel={t("register")}
              cancelLabel={t("cancelRegistration")}
              registeredMessage={t("registeredMessage")}
              cancelledMessage={t("cancelledMessage")}
              errorMessage={tCommon("error")}
              loginRequiredMessage={tCommon("loginRequired")}
            />
          </div>

          {/* 変A: 詳細・申し込みセクション（本文 + 外部リンク outline button） */}
          {(event.description || event.externalUrl) && (
            <div className="pt-12 border-t border-border">
              <h2 className="text-lg font-normal mb-6">{t("detailsHeading")}</h2>
              {event.description && (
                <div className="prose-custom mb-8">
                  <PortableText value={event.description} />
                </div>
              )}
              {event.externalUrl && (
                <a
                  href={event.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm px-5 py-2.5 rounded-full border border-border hover:border-foreground hover:text-foreground transition-colors"
                >
                  {t("detailsPageLink")} ↗
                </a>
              )}
            </div>
          )}
        </>
      ) : (
        <MemberGate requiredTier={requiredTier} />
      )}
    </div>
  );
}

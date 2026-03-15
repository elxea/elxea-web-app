import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { EVENT_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { getMembershipTier } from "@/lib/shopify/auth";
import type { MembershipTier } from "@/lib/shopify/customer";
import { MemberGate } from "@/components/ui/member-gate";
import { Button } from "@/components/ui/button";
import { EventRegisterButton } from "@/components/events/event-register-button";

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
      <div className="max-w-3xl mx-auto px-6 py-16">
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
    <div className="max-w-3xl mx-auto px-6 py-16">
      <header className="mb-12">
        <p className="text-xs text-muted-foreground mb-4">
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
        </p>
        <h1 className="mb-4">{event.title}</h1>
        {event.location && (
          <p className="text-muted-foreground text-sm">{event.location}</p>
        )}
        {isGated && (
          <p className="text-xs text-muted-foreground mt-4">[{tCommon("memberOnly")}]</p>
        )}
      </header>

      {event.image?.asset && (
        <div className="mb-12">
          <Image
            src={urlFor(event.image).width(1200).url()}
            alt={event.title}
            width={1200}
            height={675}
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full"
            priority
          />
        </div>
      )}

      {hasAccess ? (
        <>
          {/* One-tap event registration */}
          <div className="mb-8">
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

          {event.description && <PortableText value={event.description} />}

          {event.externalUrl && (
            <div className="mt-12">
              <Button variant="outline" asChild>
                <a
                  href={event.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("detailsLink")}
                </a>
              </Button>
            </div>
          )}
        </>
      ) : (
        <MemberGate requiredTier={requiredTier} />
      )}
    </div>
  );
}

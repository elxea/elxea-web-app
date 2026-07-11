import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/ui/image-card";
import { EVENTS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { previewSeedEnabled, seedEvents, isSeedId } from "@/lib/preview-seed";

export default function EventsPage() {
  const t = useTranslations("common");

  return (
    <div className="section-wide">
      {/* 変A: centered editorial header */}
      <div className="text-center mb-12 md:mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Upcoming
        </p>
        <h1>{t("events")}</h1>
      </div>
      <EventsList />
    </div>
  );
}

async function EventsList() {
  const locale = await getLocale();
  const t = await getTranslations("event");
  const tCommon = await getTranslations("common");

  try {
    const client = getClient();
    const fetched = await client.fetch(EVENTS_QUERY, { language: locale });

    // Preview-only: the production dataset has no future events, so the list is
    // empty. Fall back to the shared seed events (same 3 as the top page) so the
    // layout can be reviewed. No effect when the flag is unset.
    const events =
      (!fetched || fetched.length === 0) && previewSeedEnabled()
        ? seedEvents()
        : fetched;

    if (!events || events.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      );
    }

    return (
      // 変A: image-top card grid (page-local card). PC 3col / SP 1col.
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
        {events.map(
          (event: {
            _id: string;
            slug: { current: string };
            imageUrl?: string;
            image?: { asset: object; alt?: string };
            title: string;
            date: string;
            endDate?: string;
            location?: string;
            memberOnly?: boolean;
            externalUrl?: string;
          }) => {
            const cardClass = "group block";
            const inner = (
              <>
                <div className="relative mb-4">
                  <ImageCard
                    image={event.imageUrl ?? (event.image?.asset ? urlFor(event.image).width(600).height(400).url() : undefined)}
                    alt={event.title}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    hover
                  />
                  {event.memberOnly && (
                    <span className="absolute top-3 left-3 bg-foreground text-background text-[10px] uppercase tracking-[0.15em] px-2 py-1">
                      {tCommon("memberOnly")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-1.5">
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
                <h3 className="text-sm font-medium leading-relaxed group-hover:underline underline-offset-4 mb-1.5">
                  {event.title}
                </h3>
                {event.location && (
                  <p className="text-sm text-muted-foreground">
                    {t("locationLabel")}：{event.location}
                  </p>
                )}
              </>
            );

            // Seed (dummy) events have no real detail route -> render non-linked.
            if (isSeedId(event._id)) {
              return (
                <div key={event._id} className="block cursor-default">
                  {inner}
                </div>
              );
            }

            if (event.externalUrl) {
              return (
                <a
                  key={event._id}
                  href={event.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClass}
                >
                  {inner}
                </a>
              );
            }

            return (
              <Link
                key={event._id}
                href={`/events/${event.slug.current}`}
                className={cardClass}
              >
                {inner}
              </Link>
            );
          }
        )}
      </div>
    );
  } catch {
    return (
      <p className="text-muted-foreground text-sm">
        {t("loadError")}
      </p>
    );
  }
}

import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { EVENTS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function EventsPage() {
  const t = useTranslations("common");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-12">{t("events")}</h1>
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
    const events = await client.fetch(EVENTS_QUERY, { language: locale });

    if (!events || events.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      );
    }

    return (
      <div className="space-y-12">
        {events.map(
          (event: {
            _id: string;
            slug: { current: string };
            image?: { asset: object; alt?: string };
            title: string;
            date: string;
            endDate?: string;
            location?: string;
            memberOnly?: boolean;
            externalUrl?: string;
          }) => {
            const cardClass =
              "group grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-6";
            const inner = (
              <>
                <div className="aspect-[4/3] bg-muted overflow-hidden">
                  {event.image?.asset ? (
                    <Image
                      src={urlFor(event.image).width(400).height(300).url()}
                      alt={event.title}
                      width={400}
                      height={300}
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      {event.title}
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <p className="text-xs text-muted-foreground mb-2">
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
                  <h3 className="text-lg font-medium group-hover:underline mb-2">
                    {event.memberOnly && (
                      <span className="text-xs text-muted-foreground mr-1.5">
                        [{tCommon("memberOnly")}]
                      </span>
                    )}
                    {event.title}
                  </h3>
                  {event.location && (
                    <p className="text-sm text-muted-foreground">{event.location}</p>
                  )}
                </div>
              </>
            );

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

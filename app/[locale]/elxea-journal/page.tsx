import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { JOURNALS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

const themeColors: Record<string, string> = {
  akane: "var(--color-brand-tea-red)",
  sui: "var(--color-brand-tea-green)",
  sohi: "var(--color-brand-tea-warm)",
};

export default function ElxeaJournalPage() {
  const t = useTranslations("elxeaJournal");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-2">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-12">{t("description")}</p>
      <JournalGrid />
    </div>
  );
}

async function JournalGrid() {
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");

  try {
    const client = getClient();
    const journals = await client.fetch(JOURNALS_QUERY, { language: locale });

    if (!journals || journals.length === 0) {
      return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
        {journals.map(
          (j: {
            _id: string;
            slug: { current: string };
            title: string;
            theme: string;
            summary?: string;
            mainImage?: { asset: object; alt?: string };
            thumbnail?: { asset: object; alt?: string };
          }) => {
            const image = j.thumbnail ?? j.mainImage;
            return (
              <Link
                key={j._id}
                href={`/elxea-journal/${j.slug.current}`}
                className="group block"
              >
                <div className="aspect-[3/2] bg-muted mb-4 overflow-hidden relative">
                  {image?.asset ? (
                    <Image
                      src={urlFor(image).width(600).height(400).url()}
                      alt={image.alt || j.title}
                      width={600}
                      height={400}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      {j.title}
                    </div>
                  )}
                  {/* Theme badge */}
                  <span
                    className="absolute top-3 left-3 text-[10px] font-medium text-white px-2 py-0.5 rounded-sm uppercase tracking-wider"
                    style={{ backgroundColor: themeColors[j.theme] || "var(--color-brand-ash)" }}
                  >
                    {j.theme}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-sm font-medium leading-snug group-hover:underline">
                    {j.title}
                  </h2>
                  {j.summary && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {j.summary}
                    </p>
                  )}
                </div>
              </Link>
            );
          }
        )}
      </div>
    );
  } catch {
    return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;
  }
}

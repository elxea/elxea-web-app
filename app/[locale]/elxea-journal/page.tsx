import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { JOURNALS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { ImageCard } from "@/components/ui/image-card";

const themeLabels: Record<string, string> = {
  akane: "茜(あかね)",
  sui: "翠(すい)",
  sohi: "そひ",
};

const themeColors: Record<string, string> = {
  akane: "var(--color-brand-tea-red)",
  sui: "var(--color-brand-tea-green)",
  sohi: "var(--color-brand-tea-warm)",
};

export default function ElxeaJournalPage() {
  const t = useTranslations("elxeaJournal");

  return (
    <div className="section-wide py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Journal
        </p>
        <h1 className="mb-6">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">{t("description")}</p>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
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
                <div className="relative mb-5">
                  <ImageCard
                    image={image?.asset ? urlFor(image).width(600).height(400).url() : undefined}
                    alt={image?.alt || j.title}
                    hover
                  />
                  {/* Theme badge */}
                  <span
                    className="absolute top-3 left-3 text-[10px] font-medium text-brand-white px-2 py-0.5 rounded-sm uppercase tracking-wider z-10"
                    style={{ backgroundColor: themeColors[j.theme] || "var(--color-brand-ash)" }}
                  >
                    {themeLabels[j.theme] || j.theme}
                  </span>
                </div>
                {/* 変A: カードテキスト 左寄せ (Figma 6761:11127 card) */}
                <div className="space-y-1">
                  <h2 className="text-base font-medium leading-relaxed group-hover:underline underline-offset-4">
                    {j.title}
                  </h2>
                  {j.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
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

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { JOURNAL_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { TeaSpecCard } from "@/components/journal/tea-spec-card";
import { Link } from "@/i18n/navigation";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const journal = await client.fetch(JOURNAL_BY_SLUG_QUERY, { slug, language: locale });
    if (!journal) return {};
    const seo = journal.seo;
    const title = seo?.title || journal.title;
    const description = seo?.description || journal.summary?.slice(0, 160);
    const image = journal.mainImage?.asset ? urlFor(journal.mainImage).width(1200).url() : undefined;
    return {
      title,
      description,
      openGraph: { title, description, images: image ? [{ url: image }] : [] },
    };
  } catch {
    return {};
  }
}

export default async function ElxeaJournalDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");

  let journal;
  try {
    const client = getClient();
    journal = await client.fetch(JOURNAL_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!journal) notFound();

  const themeLabel = themeLabels[journal.theme] || journal.theme;
  const themeColor = themeColors[journal.theme] || "var(--color-brand-ash)";

  return (
    <article>
      {/* ① Hero image — full width */}
      {journal.mainImage?.asset && (
        <div className="w-full aspect-[2/1] sm:aspect-[5/2] bg-muted overflow-hidden">
          <Image
            src={urlFor(journal.mainImage).width(1600).height(640).url()}
            alt={journal.mainImage.alt || journal.title}
            width={1600}
            height={640}
            sizes="100vw"
            className="w-full h-full object-cover"
            priority
          />
        </div>
      )}

      {/* ② Theme badge + Title + Summary */}
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-8">
        <span
          className="inline-block text-[10px] font-medium text-white px-2.5 py-1 uppercase tracking-wider mb-4"
          style={{ backgroundColor: themeColor }}
        >
          {themeLabel}
        </span>
        <h1 className="mb-4">{journal.title}</h1>
        {journal.summary && (
          <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
            {journal.summary}
          </p>
        )}
      </header>

      {/* ③ Body (Portable Text) */}
      {journal.body && (
        <div className="max-w-3xl mx-auto px-6 pb-12">
          <div className="prose-custom">
            <PortableText value={journal.body} />
          </div>
        </div>
      )}

      {/* ④ お届けのお茶について */}
      {journal.teaMenus && journal.teaMenus.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-12">
          <h2 className="text-base font-medium mb-8">{t("teaSection")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {journal.teaMenus.map(
              (tea: {
                _id: string;
                slug: { current: string };
                displayName: string;
                productNumber: string;
                category: string;
                variety: string;
                season: string;
                origin: string;
                netWeight: number;
                photo?: { asset: object; alt?: string };
              }) => (
                <TeaSpecCard key={tea._id} tea={tea} />
              )
            )}
          </div>
        </section>
      )}

      {/* ⑤ Playlist */}
      {journal.playlist && (
        <section className="max-w-4xl mx-auto px-6 py-8 border-t border-border">
          <h2 className="text-base font-medium mb-6">{t("relatedPlaylist")}</h2>
          <Link
            href={`/playlists/${journal.playlist.slug.current}`}
            className="flex items-center gap-5 group"
          >
            {journal.playlist.albumImage?.asset && (
              <Image
                src={urlFor(journal.playlist.albumImage).width(120).height(120).url()}
                alt={journal.playlist.title}
                width={120}
                height={120}
                className="size-20 object-cover"
              />
            )}
            <div>
              <p className="text-sm font-medium group-hover:underline">
                {journal.playlist.title}
              </p>
              {journal.playlist.spotifyUrl && (
                <p className="text-xs text-muted-foreground mt-1">Spotify</p>
              )}
            </div>
          </Link>
        </section>
      )}

      {/* ⑥ Related article (コラム) */}
      {journal.relatedPost && (
        <section className="max-w-4xl mx-auto px-6 py-8 border-t border-border">
          <h2 className="text-base font-medium mb-4">{t("relatedPost")}</h2>
          <Link
            href={`/journal/${journal.relatedPost.slug.current}`}
            className="text-sm underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            {journal.relatedPost.title}
          </Link>
        </section>
      )}

      {/* Bottom spacing */}
      <div className="pb-16" />
    </article>
  );
}

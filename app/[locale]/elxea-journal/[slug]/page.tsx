import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { JOURNAL_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
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

  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <header className="mb-12">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {journal.theme}
        </span>
        <h1 className="mt-2 mb-4">{journal.title}</h1>
        {journal.summary && (
          <p className="text-muted-foreground text-sm leading-relaxed">{journal.summary}</p>
        )}
      </header>

      {/* Main image */}
      {journal.mainImage?.asset && (
        <div className="mb-12">
          <Image
            src={urlFor(journal.mainImage).width(1200).url()}
            alt={journal.mainImage.alt || journal.title}
            width={1200}
            height={675}
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full"
            priority
          />
        </div>
      )}

      {/* Body */}
      {journal.body && (
        <div className="prose-custom">
          <PortableText value={journal.body} />
        </div>
      )}

      {/* Related tea menus */}
      {journal.teaMenus && journal.teaMenus.length > 0 && (
        <section className="border-t border-border pt-8 mt-12">
          <h2 className="text-sm font-medium mb-4">{t("relatedTea")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {journal.teaMenus.map(
              (tea: {
                _id: string;
                slug: { current: string };
                displayName: string;
                photo?: { asset: object; alt?: string };
              }) => (
                <Link
                  key={tea._id}
                  href={`/tea-menu/${tea.slug.current}`}
                  className="group block"
                >
                  {tea.photo?.asset && (
                    <div className="aspect-[3/2] bg-muted mb-2 overflow-hidden">
                      <Image
                        src={urlFor(tea.photo).width(200).height(133).url()}
                        alt={tea.photo.alt || tea.displayName}
                        width={200}
                        height={133}
                        sizes="(max-width: 640px) 50vw, 33vw"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  )}
                  <p className="text-xs font-medium group-hover:underline">{tea.displayName}</p>
                </Link>
              )
            )}
          </div>
        </section>
      )}

      {/* Playlist link */}
      {journal.playlist && (
        <section className="border-t border-border pt-8 mt-8">
          <h2 className="text-sm font-medium mb-4">{t("relatedPlaylist")}</h2>
          <Link
            href={`/playlists/${journal.playlist.slug.current}`}
            className="flex items-center gap-4 group"
          >
            {journal.playlist.albumImage?.asset && (
              <Image
                src={urlFor(journal.playlist.albumImage).width(80).height(80).url()}
                alt={journal.playlist.title}
                width={80}
                height={80}
                className="size-16 object-cover rounded"
              />
            )}
            <div>
              <p className="text-sm font-medium group-hover:underline">{journal.playlist.title}</p>
              {journal.playlist.spotifyUrl && (
                <p className="text-xs text-muted-foreground mt-0.5">Spotify</p>
              )}
            </div>
          </Link>
        </section>
      )}

      {/* Related article */}
      {journal.relatedPost && (
        <section className="border-t border-border pt-8 mt-8">
          <h2 className="text-sm font-medium mb-4">{t("relatedPost")}</h2>
          <Link
            href={`/journal/${journal.relatedPost.slug.current}`}
            className="text-sm underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            {journal.relatedPost.title}
          </Link>
        </section>
      )}
    </article>
  );
}

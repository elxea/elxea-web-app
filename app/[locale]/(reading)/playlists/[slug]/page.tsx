import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { PLAYLIST_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { ImageCard } from "@/components/media/image-card";
import { isFictionalSlug } from "@/lib/fictional-content";
import type { PortableTextBlock } from "@portabletext/types";

// Helper: extract plain text from PortableText blocks or return string as-is
function toPlainText(value: PortableTextBlock[] | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (block._type !== "block" || !Array.isArray(block.children)) return "";
        return (block.children as Array<{ text?: string }>)
          .map((child) => child.text || "")
          .join("");
      })
      .join("\n");
  }
  return "";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (isFictionalSlug("playlist", slug)) return {};
  try {
    const client = getClient();
    const pl = await client.fetch(PLAYLIST_BY_SLUG_QUERY, { slug });
    if (!pl) return {};
    const image = pl.albumImage?.asset ? urlFor(pl.albumImage).width(800).url() : undefined;
    const descText = toPlainText(pl.description).slice(0, 160);
    return {
      title: pl.title,
      description: descText || undefined,
      openGraph: {
        title: pl.title,
        description: descText || undefined,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("playlist");

  // Fictional/seed playlist -> behave as if the document does not exist.
  if (isFictionalSlug("playlist", slug)) notFound();

  let pl;
  try {
    const client = getClient();
    pl = await client.fetch(PLAYLIST_BY_SLUG_QUERY, { slug });
  } catch {
    return (
      <div className="section-narrow">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!pl) notFound();

  // Support both schema field names (color1/color2) and seed data field names (primary/secondary)
  const c1 = pl.colors?.color1 || pl.colors?.primary;
  const c2 = pl.colors?.color2 || pl.colors?.secondary;
  const gradientStyle = (c1 || c2)
    ? {
        background: `linear-gradient(135deg, ${c1 || "#f5f5f4"}, ${c2 || "#e7e5e4"})`,
      }
    : undefined;

  return (
    <div className="section-wide py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Album image */}
        <ImageCard
          image={pl.albumImage?.asset ? urlFor(pl.albumImage).width(800).height(533).url() : undefined}
          alt={pl.albumImage?.alt || pl.title}
          width={800}
          height={533}
          sizes="(max-width: 1024px) 100vw, 50vw"
          style={gradientStyle}
          priority
        />

        {/* Info — 変A: eyebrow を tracking-[0.25em] に、配信リンクを見出し付き outline pill に */}
        <div>
          {pl.category && (
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-3">
              {pl.category}
            </p>
          )}
          <h1 className="mb-4">{pl.title}</h1>

          {pl.artist && (
            <p className="text-sm text-muted-foreground mb-6">{pl.artist.name}</p>
          )}

          {pl.description && (
            <div className="text-sm text-muted-foreground leading-relaxed mb-8">
              {typeof pl.description === "string" ? (
                <p>{pl.description}</p>
              ) : (
                <PortableText value={pl.description as PortableTextBlock[]} />
              )}
            </div>
          )}

          {/* Streaming links */}
          {(pl.spotifyUrl || pl.soundcloudUrl || pl.youtubeUrl) && (
            <div className="mb-8">
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
                {t("listen")}
              </p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                {pl.spotifyUrl && (
                  <a
                    href={pl.spotifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between sm:justify-start gap-2 rounded-full border border-border px-5 py-2.5 text-xs font-medium hover:border-foreground hover:bg-foreground hover:text-background transition-colors"
                  >
                    Spotify <span aria-hidden>&#8599;</span>
                  </a>
                )}
                {pl.soundcloudUrl && (
                  <a
                    href={pl.soundcloudUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between sm:justify-start gap-2 rounded-full border border-border px-5 py-2.5 text-xs font-medium hover:border-foreground hover:bg-foreground hover:text-background transition-colors"
                  >
                    SoundCloud <span aria-hidden>&#8599;</span>
                  </a>
                )}
                {pl.youtubeUrl && (
                  <a
                    href={pl.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between sm:justify-start gap-2 rounded-full border border-border px-5 py-2.5 text-xs font-medium hover:border-foreground hover:bg-foreground hover:text-background transition-colors"
                  >
                    YouTube <span aria-hidden>&#8599;</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {pl.dateRecorded && (
            <p className="text-xs text-muted-foreground border-t border-border pt-6">
              {t("recorded")}: {new Date(pl.dateRecorded).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Body content */}
      {pl.body && (
        <div className="max-w-3xl mx-auto mt-16 prose-custom">
          <PortableText value={pl.body} />
        </div>
      )}
    </div>
  );
}

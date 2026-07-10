import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/ui/image-card";
import { PLAYLISTS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function PlaylistsPage() {
  const t = useTranslations("playlist");

  return (
    <div className="section-wide py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Playlists
        </p>
        <h1 className="mb-6">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto">{t("description")}</p>
      </div>
      <PlaylistGrid />
    </div>
  );
}

async function PlaylistGrid() {
  const t = await getTranslations("playlist");

  try {
    const client = getClient();
    const playlists = await client.fetch(PLAYLISTS_QUERY);

    if (!playlists || playlists.length === 0) {
      return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
        {playlists.map(
          (pl: {
            _id: string;
            slug: { current: string };
            title: string;
            category?: string;
            albumImage?: { asset: object; alt?: string };
            description?: string;
            artist?: { name: string };
            colors?: { color1?: string; primary?: string };
          }) => (
            <Link
              key={pl._id}
              href={`/playlists/${pl.slug.current}`}
              className="group block"
            >
              <ImageCard
                image={pl.albumImage?.asset ? urlFor(pl.albumImage).width(600).height(400).url() : undefined}
                alt={pl.albumImage?.alt || pl.title}
                className="mb-3"
                style={(pl.colors?.color1 || pl.colors?.primary) ? { backgroundColor: pl.colors?.color1 || pl.colors?.primary } : undefined}
                hover
              />
              {/* 変A: カードテキスト 左寄せ (Figma 6717:9158 card) */}
              <div className="space-y-1">
                {pl.category && (
                  <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
                    {pl.category}
                  </p>
                )}
                <h2 className="text-base font-medium leading-relaxed group-hover:underline underline-offset-4">{pl.title}</h2>
                {pl.artist && (
                  <p className="text-xs text-muted-foreground">{pl.artist.name}</p>
                )}
              </div>
            </Link>
          )
        )}
      </div>
    );
  } catch {
    return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;
  }
}

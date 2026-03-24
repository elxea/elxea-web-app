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
    <div className="section-wide">
      <h1 className="mb-2">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-12">{t("description")}</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
        {playlists.map(
          (pl: {
            _id: string;
            slug: { current: string };
            title: string;
            category?: string;
            albumImage?: { asset: object; alt?: string };
            description?: string;
            artist?: { name: string };
            colors?: { color1?: string };
          }) => (
            <Link
              key={pl._id}
              href={`/playlists/${pl.slug.current}`}
              className="group block"
            >
              <ImageCard
                image={pl.albumImage?.asset ? urlFor(pl.albumImage).width(600).height(400).url() : undefined}
                alt={pl.albumImage?.alt || pl.title}
                className="mb-4"
                style={pl.colors?.color1 ? { backgroundColor: pl.colors.color1 } : undefined}
                hover
              />
              <div className="space-y-1">
                {pl.category && (
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {pl.category}
                  </p>
                )}
                <h2 className="text-sm font-medium group-hover:underline">{pl.title}</h2>
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

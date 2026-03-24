import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCollections } from "@/lib/shopify";
import { ImageCard } from "@/components/ui/image-card";

export default async function CollectionsPage() {
  const t = await getTranslations("common");

  return (
    <div className="section-wide">
      <h1 className="mb-12">{t("collections")}</h1>
      <CollectionsContent />
    </div>
  );
}

async function CollectionsContent() {
  const { getTranslations } = await import("next-intl/server");

  try {
    const collections = await getCollections();
    if (collections.length === 0) {
      const t = await getTranslations("collection");
      return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            href={`/collections/${collection.handle}`}
            className="group block"
          >
            <ImageCard
              image={collection.image?.url}
              alt={collection.image?.altText || collection.title}
              className="mb-4"
              hover
            />
            <h2 className="text-sm font-medium group-hover:underline">
              {collection.title}
            </h2>
            {collection.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {collection.description}
              </p>
            )}
          </Link>
        ))}
      </div>
    );
  } catch {
    const t = await getTranslations("collection");
    return (
      <p className="text-muted-foreground text-sm">
        {t("loadError")}
      </p>
    );
  }
}

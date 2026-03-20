import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCollections } from "@/lib/shopify";

export default async function CollectionsPage() {
  const t = await getTranslations("common");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
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
            <div className="aspect-[3/2] bg-muted mb-4 overflow-hidden rounded-md">
              {collection.image ? (
                <Image
                  src={collection.image.url}
                  alt={collection.image.altText || collection.title}
                  width={600}
                  height={400}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  {collection.title}
                </div>
              )}
            </div>
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

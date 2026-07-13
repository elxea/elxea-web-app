import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCollections } from "@/lib/shopify";
import { ImageCard } from "@/components/ui/image-card";

export default async function CollectionsPage() {
  const t = await getTranslations("common");

  return (
    <div className="section-wide py-20 md:px-20 md:py-24">
      <div className="mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Explore
        </p>
        <h1 className="page-title">{t("collections")}</h1>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            href={`/collections/${collection.handle}`}
            className="group block"
          >
            <ImageCard
              image={collection.image?.url}
              alt={collection.image?.altText || collection.title}
              className="mb-5"
              hover
            />
            <div className="space-y-1">
              <h2 className="text-base font-medium leading-relaxed group-hover:underline underline-offset-4">
                {collection.title}
              </h2>
              {collection.description && (
                <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                  {collection.description}
                </p>
              )}
            </div>
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

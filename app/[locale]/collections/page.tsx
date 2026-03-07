import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getCollections } from "@/lib/shopify";

export default function CollectionsPage() {
  const t = useTranslations("common");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-12">{t("collections")}</h1>
      <CollectionsContent />
    </div>
  );
}

async function CollectionsContent() {
  try {
    const collections = await getCollections();
    if (collections.length === 0) {
      return <p className="text-muted text-[14px]">コレクションがありません</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            href={`/collections/${collection.handle}`}
            className="group block"
          >
            <div className="aspect-[4/3] bg-surface mb-4 overflow-hidden">
              {collection.image ? (
                <Image
                  src={collection.image.url}
                  alt={collection.image.altText || collection.title}
                  width={600}
                  height={450}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-light text-[13px]">
                  {collection.title}
                </div>
              )}
            </div>
            <h3 className="text-[14px] font-medium group-hover:underline">
              {collection.title}
            </h3>
            {collection.description && (
              <p className="text-[13px] text-muted mt-1 line-clamp-2">
                {collection.description}
              </p>
            )}
          </Link>
        ))}
      </div>
    );
  } catch {
    return (
      <p className="text-muted text-[14px]">
        コレクションを読み込めませんでした。
      </p>
    );
  }
}

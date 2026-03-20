import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { TEA_MENUS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function TeaMenuPage() {
  const t = useTranslations("teaMenu");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-2">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-12">{t("description")}</p>
      <TeaMenuList />
    </div>
  );
}

async function TeaMenuList() {
  const locale = await getLocale();
  const t = await getTranslations("teaMenu");

  try {
    const client = getClient();
    const items = await client.fetch(TEA_MENUS_QUERY, { language: locale });

    if (!items || items.length === 0) {
      return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
        {items.map(
          (item: {
            _id: string;
            slug: { current: string };
            photo?: { asset: object; alt?: string };
            displayName: string;
            category: string;
            variety: string;
            origin: string;
            color?: string;
          }) => (
            <Link
              key={item._id}
              href={`/tea-menu/${item.slug.current}`}
              className="group block"
            >
              <div
                className="aspect-[3/2] bg-muted mb-4 overflow-hidden rounded-md"
                style={item.color ? { backgroundColor: item.color } : undefined}
              >
                {item.photo?.asset ? (
                  <Image
                    src={urlFor(item.photo).width(600).height(400).url()}
                    alt={item.photo.alt || item.displayName}
                    width={600}
                    height={400}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {item.displayName}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {item.category}
                </p>
                <h2 className="text-sm font-medium group-hover:underline">
                  {item.displayName}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {item.variety} · {item.origin}
                </p>
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

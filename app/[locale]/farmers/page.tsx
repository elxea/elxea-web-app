import Image from "next/image";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { FARMERS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function FarmersPage() {
  const t = useTranslations("common");

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="mb-12">{t("farmers")}</h1>
      <FarmersList />
    </div>
  );
}

async function FarmersList() {
  const locale = await getLocale();
  const t = await getTranslations("farmer");

  try {
    const client = getClient();
    const farmers = await client.fetch(FARMERS_QUERY, { language: locale });

    if (!farmers || farmers.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
        {farmers.map(
          (farmer: {
            _id: string;
            slug: { current: string };
            photo?: { asset: object; alt?: string };
            name: string;
            region?: string;
            country?: string;
          }) => (
            <Link
              key={farmer._id}
              href={`/farmers/${farmer.slug.current}`}
              className="group block"
            >
              <div className="aspect-square bg-muted mb-4 overflow-hidden">
                {farmer.photo?.asset ? (
                  <Image
                    src={urlFor(farmer.photo).width(600).height(600).url()}
                    alt={farmer.photo.alt || farmer.name}
                    width={600}
                    height={600}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {farmer.name}
                  </div>
                )}
              </div>
              <h3 className="text-sm font-medium group-hover:underline">
                {farmer.name}
              </h3>
              {(farmer.region || farmer.country) && (
                <p className="text-sm text-muted-foreground mt-1">
                  {[farmer.region, farmer.country].filter(Boolean).join(", ")}
                </p>
              )}
            </Link>
          )
        )}
      </div>
    );
  } catch {
    return (
      <p className="text-muted-foreground text-sm">
        {t("loadError")}
      </p>
    );
  }
}

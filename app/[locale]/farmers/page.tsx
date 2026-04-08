import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/ui/image-card";
import { FARMERS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";

export default function FarmersPage() {
  const t = useTranslations("common");

  return (
    <div className="section-wide py-20">
      <div className="text-center mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Community
        </p>
        <h1>{t("farmers")}</h1>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
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
              <ImageCard
                image={farmer.photo?.asset ? urlFor(farmer.photo).width(600).height(400).url() : undefined}
                alt={farmer.photo?.alt || farmer.name}
                className="mb-5"
                hover
              />
              <div className="space-y-2 text-center">
                <h3 className="text-sm font-normal leading-relaxed group-hover:underline underline-offset-4">
                  {farmer.name}
                </h3>
                {(farmer.region || farmer.country) && (
                  <p className="text-[13px] text-muted-foreground">
                    {[farmer.region, farmer.country].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
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

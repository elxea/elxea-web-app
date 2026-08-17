import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { ImageCard } from "@/components/media/image-card";
import { FARMERS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { withSeedFarmers, isSeedId } from "@/lib/preview-seed";
import { filterOutFictional } from "@/lib/fictional-content";

export default function FarmersPage() {
  const tf = useTranslations("farmer");

  return (
    <div className="section-wide">
      {/* 変A: centered editorial header */}
      <div className="text-center mb-12 md:mb-16">
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Farmers
        </p>
        <h1>{tf("heading")}</h1>
        {tf("lead") && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto mt-6">{tf("lead")}</p>
        )}
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
    const fetched: Array<{
      _id: string;
      name: string;
      slug: { current: string };
      photo?: { asset: object; alt?: string };
      region?: string;
      country?: string;
    }> = await client.fetch(FARMERS_QUERY, { language: locale });

    // Hide fictional/seed farmer docs still present in the production dataset
    // until real producer stories are approved. Code-only; no Sanity mutation.
    const real = filterOutFictional("farmer", fetched);

    // Preview-only: real farmers lack photos and the list is thin. Attach
    // placeholder imagery and pad to a full grid. No effect when flag unset.
    const farmers = withSeedFarmers(real);

    if (!farmers || farmers.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      );
    }

    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10 md:gap-x-8 md:gap-y-14">
        {farmers.map(
          (farmer: {
            _id: string;
            slug: { current: string };
            imageUrl?: string;
            photo?: { asset: object; alt?: string };
            name: string;
            region?: string;
            country?: string;
          }) => {
            const seeded = isSeedId(farmer._id);
            const inner = (
              <>
                <ImageCard
                  image={farmer.imageUrl ?? (farmer.photo?.asset ? urlFor(farmer.photo).width(600).height(400).url() : undefined)}
                  alt={farmer.photo?.alt || farmer.name}
                  className="mb-5"
                  hover={!seeded}
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
              </>
            );

            // Seed (dummy) farmers have no real detail route -> render non-linked.
            if (seeded) {
              return (
                <div key={farmer._id} className="block cursor-default">
                  {inner}
                </div>
              );
            }

            return (
              <Link
                key={farmer._id}
                href={`/farmers/${farmer.slug.current}`}
                className="group block"
              >
                {inner}
              </Link>
            );
          }
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

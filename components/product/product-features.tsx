import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { ProductMetafields } from "@/lib/shopify/types";
import { Separator } from "@/components/ui/separator";
import { sanitizeImageUrl } from "@/lib/image-utils";

interface ProductFeaturesProps {
  metafields: ProductMetafields;
}

export async function ProductFeatures({ metafields }: ProductFeaturesProps) {
  const hasFeatures = metafields.features.length > 0;
  const hasTeaDetails =
    metafields.teaCategory ||
    metafields.variety ||
    metafields.season ||
    metafields.taste ||
    metafields.aroma ||
    metafields.menuNumber;
  const hasEnrichment = hasFeatures || hasTeaDetails || metafields.howToEnjoy;

  if (!hasEnrichment) return null;

  const t = await getTranslations("product");

  return (
    <div className="mt-20 space-y-20">
      {/* Feature sections */}
      {metafields.features.map((feature, index) => {
        const safeImageUrl = sanitizeImageUrl(feature.imageUrl);
        return (
        <section
          key={`feature_${index + 1}`}
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center"
        >
          {safeImageUrl && (
            <div
              className={`aspect-[4/3] relative overflow-hidden bg-muted rounded-md ${
                index % 2 === 1 ? "lg:order-last" : ""
              }`}
            >
              <Image
                src={safeImageUrl}
                alt={feature.title}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
          )}
          <div
            className={`space-y-4 ${
              !safeImageUrl ? "lg:col-span-2 max-w-2xl" : ""
            } ${
              index % 2 === 1 && safeImageUrl ? "lg:order-first" : ""
            }`}
          >
            {feature.title && (
              <h2 className="text-xl font-medium leading-relaxed">
                {feature.title}
              </h2>
            )}
            {feature.body && (
              <p className="text-[14px] text-muted-foreground leading-relaxed whitespace-pre-line">
                {feature.body}
              </p>
            )}
          </div>
        </section>
        );
      })}

      {/* Tea details */}
      {hasTeaDetails && (
        <section>
          <Separator className="mb-12" />
          <h2 className="text-lg font-medium mb-8">{t("teaDetails")}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4">
            {metafields.teaCategory && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("teaCategory")}</dt>
                <dd className="text-[13px]">{metafields.teaCategory}</dd>
              </div>
            )}
            {metafields.variety && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("teaVariety")}</dt>
                <dd className="text-[13px]">{metafields.variety}</dd>
              </div>
            )}
            {metafields.season && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("teaSeason")}</dt>
                <dd className="text-[13px]">{metafields.season}</dd>
              </div>
            )}
            {metafields.taste && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("teaTaste")}</dt>
                <dd className="text-[13px]">{metafields.taste}</dd>
              </div>
            )}
            {metafields.aroma && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("teaAroma")}</dt>
                <dd className="text-[13px]">{metafields.aroma}</dd>
              </div>
            )}
            {metafields.menuNumber && (
              <div className="flex justify-between border-b border-border pb-3">
                <dt className="text-[13px] text-muted-foreground">{t("menuNumber")}</dt>
                <dd className="text-[13px]">{metafields.menuNumber}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* How to enjoy */}
      {metafields.howToEnjoy && (
        <section>
          <Separator className="mb-12" />
          <h2 className="text-lg font-medium mb-6">{t("howToEnjoy")}</h2>
          <p className="text-[14px] text-muted-foreground leading-relaxed whitespace-pre-line max-w-2xl">
            {metafields.howToEnjoy}
          </p>
        </section>
      )}
    </div>
  );
}

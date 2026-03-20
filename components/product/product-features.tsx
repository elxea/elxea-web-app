import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { ProductMetafields } from "@/lib/shopify/types";
import { Separator } from "@/components/ui/separator";

interface ProductFeaturesProps {
  metafields: ProductMetafields;
}

export async function ProductFeatures({ metafields }: ProductFeaturesProps) {
  const t = await getTranslations("product");

  const hasTeaDetails =
    metafields.teaCategory ||
    metafields.variety ||
    metafields.season ||
    metafields.taste ||
    metafields.aroma;

  return (
    <div className="mt-20 space-y-20">
      {/* Feature sections */}
      {metafields.features.map((feature, index) => (
        <section
          key={index}
          className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center ${
            index % 2 === 1 ? "lg:[direction:rtl]" : ""
          }`}
        >
          {feature.imageUrl && (
            <div className={`aspect-[4/3] relative overflow-hidden bg-muted ${index % 2 === 1 ? "lg:[direction:ltr]" : ""}`}>
              <Image
                src={feature.imageUrl}
                alt={feature.title}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
          )}
          <div className={`space-y-4 ${index % 2 === 1 ? "lg:[direction:ltr]" : ""} ${!feature.imageUrl ? "lg:col-span-2 max-w-2xl" : ""}`}>
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
      ))}

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

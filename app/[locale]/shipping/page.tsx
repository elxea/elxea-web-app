import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shippingInfo");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function ShippingPage() {
  const t = await getTranslations("shippingInfo");
  const bt = await getTranslations("breadcrumb");

  const regions = [
    { region: t("region1"), days: t("region1Days") },
    { region: t("region2"), days: t("region2Days") },
    { region: t("region3"), days: t("region3Days") },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <div className="flex flex-col gap-12 md:gap-16">
        {/* Top: breadcrumb + eyebrow + title + lead (変A Reading Column / Top) */}
        <div className="flex flex-col gap-5 md:gap-6">
          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
              { label: t("title") },
            ]}
          />
          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Info
            </p>
            <h1>{t("title")}</h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {/* Sections (変A Reading Column / Sections) */}
        <div className="flex flex-col gap-8 md:gap-12">
          {/* Rates */}
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground">{t("domestic")}</h2>
            <div className="flex flex-col gap-2 text-base leading-relaxed">
              <p className="font-medium text-foreground">{t("domesticRate")}</p>
              <p className="text-muted-foreground">{t("freeShipping")}</p>
              <p className="text-muted-foreground">{t("subscriptionFree")}</p>
            </div>
          </section>

          {/* Delivery Time */}
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground">{t("deliveryTime")}</h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("deliveryTimeText")}
            </p>
            {/* SP=積み上げ / PC=2カラム、各行ヘアライン（変A 表組み） */}
            <dl className="mt-3 flex flex-col">
              {regions.map((r, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 border-t border-border py-3 md:flex-row md:gap-6"
                >
                  <dt className="text-base font-medium text-foreground md:w-56 md:shrink-0">
                    {r.region}
                  </dt>
                  <dd className="text-base text-muted-foreground">{r.days}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Packaging */}
          <section className="flex flex-col gap-3">
            <h2 className="text-foreground">{t("packaging")}</h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("packagingText")}
            </p>
          </section>
        </div>

        {/* Meta (変A Reading Column / Meta) */}
        <div className="border-t border-border pt-6 text-xs text-muted-foreground">
          <p>{t("note")}</p>
        </div>
      </div>
    </div>
  );
}

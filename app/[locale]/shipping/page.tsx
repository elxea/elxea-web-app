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

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title") },
        ]}
      />
      <h1 className="mb-4">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-16">{t("subtitle")}</p>

      <div className="space-y-16">
        {/* Rates */}
        <section>
          <h2 className="mb-6">{t("domestic")}</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-4 border-b border-border pb-4">
              <span className="text-sm text-foreground font-medium">
                {t("domesticRate")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t("freeShipping")}</p>
            <p className="text-sm text-muted-foreground">{t("subscriptionFree")}</p>
          </div>
        </section>

        {/* Delivery Time */}
        <section>
          <h2 className="mb-6">{t("deliveryTime")}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t("deliveryTimeText")}
          </p>
          <table className="w-full border-collapse">
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-3 text-sm text-foreground font-medium">
                  {t("region1")}
                </td>
                <td className="py-3 text-sm text-muted-foreground text-right">
                  {t("region1Days")}
                </td>
              </tr>
              <tr>
                <td className="py-3 text-sm text-foreground font-medium">
                  {t("region2")}
                </td>
                <td className="py-3 text-sm text-muted-foreground text-right">
                  {t("region2Days")}
                </td>
              </tr>
              <tr>
                <td className="py-3 text-sm text-foreground font-medium">
                  {t("region3")}
                </td>
                <td className="py-3 text-sm text-muted-foreground text-right">
                  {t("region3Days")}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Packaging */}
        <section>
          <h2 className="mb-6">{t("packaging")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("packagingText")}
          </p>
        </section>

        <p className="text-xs text-muted-foreground">{t("note")}</p>
      </div>
    </div>
  );
}

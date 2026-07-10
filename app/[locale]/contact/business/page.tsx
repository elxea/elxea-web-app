import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { BusinessForm } from "./business-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contactBusiness");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function BusinessContactPage() {
  const t = await getTranslations("contactBusiness");
  const bt = await getTranslations("breadcrumb");
  const ct = await getTranslations("contact");

  return (
    <div className="mx-auto max-w-xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <div className="flex flex-col gap-12 md:gap-16">
        {/* Top: breadcrumb + title + lead (変A Reading Column / Top) */}
        <div className="flex flex-col gap-5 md:gap-6">
          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
              { label: ct("title"), href: "/contact" },
              { label: t("title") },
            ]}
          />
          <div className="flex flex-col gap-3">
            <h1>{t("title")}</h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {/* Form (法人フォーム・送信ロジック温存) */}
        <BusinessForm />

        {/* Supplementary contacts (変A Reading Column / Meta) */}
        <div className="flex flex-col gap-6 border-t border-border pt-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground">
              {t("emailDirect")}
            </h2>
            <a
              href={`mailto:${t("emailAddress")}`}
              className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {t("emailAddress")}
            </a>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("responseTime")}
          </p>
        </div>
      </div>
    </div>
  );
}

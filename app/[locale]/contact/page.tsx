import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { ContactForm } from "./contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contact");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("contact");
  const bt = await getTranslations("breadcrumb");

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <div className="flex flex-col gap-12 md:gap-16">
        {/* Top: breadcrumb + title + lead (変A Reading Column / Top) */}
        <div className="flex flex-col gap-5 md:gap-6">
          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
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

        {/* Form (機能・送信ロジック温存) */}
        <ContactForm />

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
          <div>
            <Link
              href="/contact/business"
              className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {t("businessLink")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

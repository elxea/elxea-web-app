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
    <div className="section-narrow">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title") },
        ]}
      />
      <h1 className="mb-4">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-16">{t("subtitle")}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
        <div className="md:col-span-2">
          <ContactForm />
        </div>

        <div className="space-y-8">
          <div>
            <h2 className="mb-4">{t("emailDirect")}</h2>
            <a
              href={`mailto:${t("emailAddress")}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline"
            >
              {t("emailAddress")}
            </a>
          </div>
          <p className="text-sm text-muted-foreground">{t("responseTime")}</p>
          <div>
            <Link
              href="/contact/business"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline"
            >
              {t("businessLink")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

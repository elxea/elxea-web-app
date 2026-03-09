import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("about");

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="mb-4">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-16">{t("subtitle")}</p>

      <div className="space-y-16">
        {/* Mission */}
        <section>
          <h2 className="mb-6">{t("mission")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("missionText")}
          </p>
        </section>

        {/* Story */}
        <section>
          <h2 className="mb-6">{t("story")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {t("storyText")}
          </p>
        </section>

        {/* Values */}
        <section>
          <h2 className="mb-8">{t("values")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ValueCard title={t("value1Title")} text={t("value1Text")} />
            <ValueCard title={t("value2Title")} text={t("value2Text")} />
            <ValueCard title={t("value3Title")} text={t("value3Text")} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ValueCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
      </CardContent>
    </Card>
  );
}

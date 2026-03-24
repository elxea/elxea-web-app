import type { Metadata } from "next";
import Image from "next/image";
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
    <>
      {/* Hero */}
      <section className="relative min-h-[50vh] flex items-center justify-center">
        <Image
          src="/hero-night.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          className="object-cover rounded-md"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative text-center max-w-xl px-6">
          <h1 className="text-white mb-4">
            {t("title")}
          </h1>
          <p className="text-white/80 text-sm">{t("subtitle")}</p>
        </div>
      </section>

      <div className="section-narrow">
        <div className="space-y-20">
          {/* Mission */}
          <section>
            <h2 className="mb-6">{t("mission")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("missionText")}
            </p>
          </section>

          {/* Image break */}
          <div className="relative aspect-[16/7] w-full overflow-hidden rounded-md">
            <Image
              src="/hero-day.jpg"
              alt="elxea tea"
              fill
              className="object-cover rounded-md"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>

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

      {/* Bottom image section */}
      <section className="relative min-h-[40vh] flex items-center justify-center">
        <Image
          src="/hero-approach.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover rounded-md"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/30" />
      </section>
    </>
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

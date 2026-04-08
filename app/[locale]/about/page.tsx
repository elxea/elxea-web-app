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
      <section className="relative min-h-[60vh] flex items-center justify-center">
        <Image
          src="/hero-night.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative text-center max-w-2xl px-8">
          <p className="text-[11px] text-white/70 uppercase tracking-[0.25em] mb-6">
            About Us
          </p>
          <h1 className="text-white mb-6">
            {t("title")}
          </h1>
          <p className="text-white/70 text-sm leading-relaxed max-w-md mx-auto">{t("subtitle")}</p>
        </div>
      </section>

      <div className="section-narrow py-24">
        <div className="space-y-24">
          {/* Mission */}
          <section className="text-center">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
              Our Mission
            </p>
            <h2 className="mb-8">{t("mission")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
              {t("missionText")}
            </p>
          </section>

          {/* Image break */}
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <Image
              src="/hero-day.jpg"
              alt="elxea tea"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>

          {/* Story */}
          <section className="text-center">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
              Our Story
            </p>
            <h2 className="mb-8">{t("story")}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line max-w-xl mx-auto">
              {t("storyText")}
            </p>
          </section>

          {/* Values */}
          <section>
            <div className="text-center mb-12">
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
                Our Values
              </p>
              <h2>{t("values")}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <ValueCard title={t("value1Title")} text={t("value1Text")} />
              <ValueCard title={t("value2Title")} text={t("value2Text")} />
              <ValueCard title={t("value3Title")} text={t("value3Text")} />
            </div>
          </section>
        </div>
      </div>

      {/* Bottom image section */}
      <section className="relative min-h-[50vh] flex items-center justify-center">
        <Image
          src="/hero-approach.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/20" />
      </section>
    </>
  );
}

function ValueCard({ title, text }: { title: string; text: string }) {
  return (
    <Card className="border-0 shadow-none bg-transparent text-center">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
      </CardContent>
    </Card>
  );
}

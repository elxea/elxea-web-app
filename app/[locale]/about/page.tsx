import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";

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
      {/* Hero (写真ヒーロー温存 / 変A タイポ処理) */}
      <section className="relative flex min-h-[60vh] items-center justify-center">
        <ImageWithFallback
          src="/hero-night.jpg"
          fallbackSrc="/placeholder-hero-night.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-overlay" />
        <div className="relative mx-auto max-w-2xl px-8 text-center">
          <div className="flex flex-col gap-6">
            <p className="text-xs uppercase tracking-widest text-overlay-foreground-muted">
              About Us
            </p>
            <h1 className="text-overlay-foreground">{t("title")}</h1>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-overlay-foreground-muted">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Body (変A Reading Column / 左寄せ縦リズム) */}
      <div className="mx-auto max-w-3xl px-5 pt-16 pb-20 md:px-6 md:pt-28 md:pb-32">
        <div className="flex flex-col gap-20 md:gap-28">
          {/* Mission */}
          <section className="flex flex-col gap-4 md:gap-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Our Mission
            </p>
            <h2>{t("mission")}</h2>
            <p className="text-base leading-relaxed text-foreground">
              {t("missionText")}
            </p>
          </section>

          {/* Image break (温存) */}
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <ImageWithFallback
              src="/hero-day.jpg"
              fallbackSrc="/placeholder-hero-day.jpg"
              alt="elxea tea"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>

          {/* Story */}
          <section className="flex flex-col gap-4 md:gap-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Our Story
            </p>
            <h2>{t("story")}</h2>
            <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
              {t("storyText")}
            </p>
          </section>

          {/* Values */}
          <section className="flex flex-col gap-8 md:gap-12">
            <div className="flex flex-col gap-4 md:gap-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Our Values
              </p>
              <h2>{t("values")}</h2>
            </div>
            <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
              <ValueCard title={t("value1Title")} text={t("value1Text")} />
              <ValueCard title={t("value2Title")} text={t("value2Text")} />
              <ValueCard title={t("value3Title")} text={t("value3Text")} />
            </div>
          </section>
        </div>
      </div>

      {/* Bottom image band (温存) */}
      <section className="relative flex min-h-[50vh] items-center justify-center">
        <ImageWithFallback
          src="/hero-approach.jpg"
          fallbackSrc="/placeholder-hero-approach.jpg"
          alt=""
          aria-hidden="true"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-overlay" />
      </section>
    </>
  );
}

function ValueCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

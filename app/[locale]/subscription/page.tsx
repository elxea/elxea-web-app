import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscriptionLp");
  return {
    title: t("title"),
    description: t("description"),
  };
}

// ─── Tea lineup sample data (placeholder) ───────────────────────────
const TEA_LINEUP = [
  "N\u00B001 \u9999\u99FF",
  "N\u00B003 \u3079\u306B\u3075\u3046\u304D",
  "N\u00B002 \u3079\u306B\u3075\u3046\u304D",
  "\u3084\u3076\u304D\u305F\u306E\u624B\u6458\u307F\u714E\u8336",
  "\u9999\u99FF\u306E\u548C\u7D05\u8336",
  "\u9759\u4E03\u4E00\u4E09\u4E8C\u306E\u840E\u51CB\u714E\u8336",
  "\u3075\u304F\u307F\u3069\u308A\u306E\u840E\u51CB\u91DC\u7092\u308A\u7DD1\u8336\u5165\u308A",
  "\u3079\u306B\u3075\u3046\u304D\u306E\u548C\u7D05\u8336",
  "\u307F\u306A\u307F\u3055\u3084\u304B\u306E\u548C\u70CF\u9F8D\u8336",
  "\u9999\u99FF\u306E\u548C\u70CF\u9F8D\u8336",
  "\u5927\u4E95\u65E9\u751F\u306E\u624B\u6458\u307F\u714E\u8336",
  "\u9999\u99FF\u306E\u840E\u51CB\u91DC\u7092\u308A\u7DD1\u8336",
  "\u3044\u305A\u307F\u306E\u548C\u7D05\u8336",
  "\u307F\u306A\u307F\u3055\u3084\u304B\u306E\u840E\u51CB\u91DC\u7092\u308A\u7DD1\u8336",
] as const;

export default async function SubscriptionLPPage() {
  const t = await getTranslations("subscriptionLp");
  const bt = await getTranslations("breadcrumb");

  const faqItems = Array.from({ length: 10 }, (_, i) => ({
    q: t(`faqQ${i + 1}`),
    a: t(`faqA${i + 1}`),
  }));

  return (
    <>
      {/* ─── 1. Hero ─── */}
      <section className="relative min-h-[80vh] flex items-center justify-center">
        <div className="absolute inset-0 bg-muted" />
        {/* TODO: hero image */}
        <div className="relative text-center max-w-xl px-6">
          <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-6 whitespace-pre-line">
            {t("heroHeading")}
          </h1>
          <Button asChild>
            <a href="#">{t("heroCta")}</a>
          </Button>
        </div>
      </section>

      {/* ─── 2. Brand Introduction ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("title") },
          ]}
        />
        <h2 className="mb-6">{t("brandHeading")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-10">
          {t("brandBody")}
        </p>

        {/* Image grid (placeholder) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[3/2] bg-muted" />
          ))}
        </div>
      </section>

      {/* ─── 3. Single Origin Appeal ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="mb-6">{t("originHeading")}</h2>

        {/* Image placeholder */}
        <div className="relative aspect-[16/9] w-full bg-muted mb-8" />

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>{t("originBody1")}</p>
          <p>{t("originBody2")}</p>
          <p>{t("originBody3")}</p>
        </div>
      </section>

      {/* ─── 4. Product Lineup (placeholder) ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">{t("lineupHeading")}</h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {TEA_LINEUP.map((name) => (
            <div key={name}>
              <div className="aspect-[3/2] bg-muted mb-4" />
              <p className="text-xs text-muted-foreground mb-1">Single</p>
              <p className="text-sm">{name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 5. Subscription Plan Details ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">{t("planHeading")}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Image placeholder */}
          <div className="aspect-[3/2] bg-muted" />

          <Card>
            <CardHeader>
              <CardTitle>{t("planName")}</CardTitle>
              <CardDescription>{t("planFirstPrice")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <span className="text-3xl font-light">{t("planPrice")}</span>
                <span className="text-sm text-muted-foreground ml-2">
                  {t("planPriceSuffix")}
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  {t("planFreeShipping")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("planNote")}
              </p>

              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>{t("planBenefit1")}</li>
                <li>{t("planBenefit2")}</li>
                <li>{t("planBenefit3")}</li>
              </ul>

              <Button className="w-full" asChild>
                <a href="#">{t("heroCta")}</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── 6. Tea Bag Material ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">{t("teabagHeading")}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="aspect-[3/2] bg-muted mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("teabagBody")}
            </p>
          </div>
          <div>
            <div className="aspect-[3/2] bg-muted mb-4" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("teabagBody")}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("teabagNote")}
            </p>
          </div>
        </div>
      </section>

      {/* ─── 7. Three Features ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            number="01"
            title={t("feature1Title")}
            description={t("feature1Body")}
            note={t("feature1Note")}
          />
          <FeatureCard
            number="02"
            title={t("feature2Title")}
            description={t("feature2Body")}
            note={t("feature2Note")}
          />
          <FeatureCard
            number="03"
            title={t("feature3Title")}
            description={t("feature3Body")}
          />
        </div>
      </section>

      {/* ─── 8. Subscriber-Only Perks ─── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="mb-10">{t("perksHeading")}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <Card>
            <CardHeader>
              <div className="aspect-[3/2] bg-muted -mx-6 -mt-6 rounded-t-xl" />
            </CardHeader>
            <CardContent className="space-y-3">
              <CardTitle>{t("perk1Title")}</CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("perk1Body")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("perk1Note")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="aspect-[3/2] bg-muted -mx-6 -mt-6 rounded-t-xl" />
            </CardHeader>
            <CardContent className="space-y-3">
              <CardTitle>{t("perk2Title")}</CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("perk2Body")}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{t("disclaimerLine1")}</p>
          <p>{t("disclaimerLine2")}</p>
          <p>{t("disclaimerLine3")}</p>
          <p>{t("disclaimerLine4")}</p>
          <p>{t("disclaimerLine5")}</p>
        </div>
      </section>

      {/* ─── 9. CTA ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="mb-8">{t("ctaHeading")}</h2>
        <Button asChild>
          <a href="#">{t("heroCta")}</a>
        </Button>
      </section>

      {/* ─── 10. FAQ ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="mb-10">{t("faqHeading")}</h2>

        <div className="divide-y divide-border">
          {faqItems.map((item, i) => (
            <details key={i} className="group py-6">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <span className="text-sm text-foreground font-medium pr-4">
                  {item.q}
                </span>
                <span
                  className="text-muted-foreground text-lg shrink-0 group-open:rotate-45 transition-transform duration-200"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="text-sm text-muted-foreground leading-relaxed mt-4 pr-8">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ─── 11. Final CTA ─── */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="mb-8">{t("ctaHeading")}</h2>
        <Button asChild>
          <a href="#">{t("heroCta")}</a>
        </Button>
      </section>
    </>
  );
}

function FeatureCard({
  number,
  title,
  description,
  note,
}: {
  number: string;
  title: string;
  description: string;
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        {/* Illustration placeholder */}
        <div className="aspect-[3/2] bg-muted -mx-6 -mt-6 rounded-t-xl" />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{number}</p>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
        {note ? (
          <p className="text-xs text-muted-foreground">{note}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

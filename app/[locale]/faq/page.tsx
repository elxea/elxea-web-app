import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { FAQJsonLd } from "@/components/seo/json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("faq");
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function FAQPage() {
  const t = await getTranslations("faq");
  const bt = await getTranslations("breadcrumb");

  const questions = [
    { question: t("q1"), answer: t("a1") },
    { question: t("q2"), answer: t("a2") },
    { question: t("q3"), answer: t("a3") },
    { question: t("q4"), answer: t("a4") },
    { question: t("q5"), answer: t("a5") },
    { question: t("q6"), answer: t("a6") },
    { question: t("q7"), answer: t("a7") },
    { question: t("q8"), answer: t("a8") },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <FAQJsonLd questions={questions} />
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

        {/* Accordion (変A Reading Column / FAQ list, native details/summary 温存) */}
        <div className="divide-y divide-border border-t border-border">
          {questions.map((q, i) => (
            <details key={i} className="group py-5 md:py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="text-base font-medium leading-relaxed text-foreground">
                  {q.question}
                </span>
                <span className="shrink-0 text-lg text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-4 pr-8 text-base leading-relaxed text-muted-foreground">
                {q.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

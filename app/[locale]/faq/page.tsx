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
    <div className="section-narrow">
      <FAQJsonLd questions={questions} />
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title") },
        ]}
      />
      <h1 className="mb-4">{t("title")}</h1>
      <p className="text-muted-foreground text-sm mb-16">{t("subtitle")}</p>

      <div className="divide-y divide-border">
        {questions.map((q, i) => (
          <details key={i} className="group py-6">
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <span className="text-sm text-foreground font-medium pr-4">
                {q.question}
              </span>
              <span className="text-muted-foreground text-lg shrink-0 group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <p className="text-sm text-muted-foreground leading-relaxed mt-4 pr-8">
              {q.answer}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}

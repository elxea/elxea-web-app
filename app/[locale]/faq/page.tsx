import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { FAQJsonLd } from "@/components/seo/json-ld";
import { Container, Section } from "@/components/layout/container";
import {
  CategoryIndex,
  ChapterBreak,
  DisclosureRow,
  LinkRow,
  MetaRow,
  Overline,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * FAQ — Figma 確定レイアウト `Common / Layouts` section 7848:450
 * (PC 7848:451 / SP 7851:39401) の実装。
 *
 * S1 ページ見出し (非対称 2 列) / S2 カテゴリ目次 / S3 グループ別アコーディオン /
 * S4 章切り (明度反転) / S5 見つからなかったときは、の 5 ブロック構成。
 * 文言も Figma が正本 (ステータス：Content = ドラフトのため確定文言は Figma 側)。
 */

type FaqItem = { q: string; summary: string; body?: string };
type FaqGroup = { no: string; en: string; title: string; items: FaqItem[] };
type MetaEntry = { label: string; value: string };
type StillRow = { title: string; desc: string; href: string };

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

  const groups = t.raw("groups") as FaqGroup[];
  const readingRows = t.raw("reading.rows") as MetaEntry[];
  const stillRows = t.raw("still.rows") as StillRow[];

  // JSON-LD は「要点 + 本文」を answer として渡す (閉じたままでも要点が答えなので)。
  const questions = groups.flatMap((group) =>
    group.items.map((item) => ({
      question: item.q,
      answer: item.body ? `${item.summary} ${item.body}` : item.summary,
    }))
  );

  return (
    <>
      <FAQJsonLd questions={questions} />

      {/* S1 ページ見出し — 左 = 名乗り / 右 = このページの読み方 (Figma 7848:529) */}
      <Section spacing="none" className="pt-10 pb-16">
        <Breadcrumb
          items={[{ label: bt("home"), href: "/" }, { label: t("title") }]}
        />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Overline>{t("kicker")}</Overline>
            <h1 className="mt-4">{t("title")}</h1>
            <p className={`${bodySmClass} mt-6 text-muted-foreground`}>{t("lead")}</p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Overline>{t("reading.heading")}</Overline>
            <dl className="mt-3">
              {readingRows.map((row) => (
                <MetaRow key={row.label} label={row.label}>
                  {row.value}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* S2 カテゴリ目次 (Figma 7848:530) */}
      <Container>
        <CategoryIndex
          aria-label={t("index.label")}
          items={groups.map((group) => ({
            label: `${group.no}  ${group.title}`,
            href: `#faq-${group.no}`,
          }))}
        />
      </Container>

      {/* S3 アコーディオン本体 — 閉じたまま答えの要点が読める (Figma 7848:531) */}
      <Section spacing="none" className="flex flex-col gap-14 pt-24 pb-24">
        {groups.map((group) => (
          <section key={group.no} id={`faq-${group.no}`}>
            <Overline>{`${group.no} / ${group.en}`}</Overline>
            <h3 className="mt-3">{group.title}</h3>
            <div className="mt-5">
              {group.items.map((item, index) => (
                <DisclosureRow
                  key={item.q}
                  question={item.q}
                  summary={item.summary}
                  // Figma は各グループ先頭行のうち本文を持つものを開いた状態で見せている
                  defaultOpen={index === 0 && Boolean(item.body)}
                >
                  {item.body}
                </DisclosureRow>
              ))}
            </div>
          </section>
        ))}
      </Section>

      {/* S4 章切り — 正解を置かない宣言 (Figma 7848:532) */}
      <ChapterBreak overline={t("chapter.overline")} title={t("chapter.title")}>
        {t("chapter.body")}
      </ChapterBreak>

      {/* S5 見つからなかったときは — 購入 CTA は置かない (Figma 7848:533) */}
      <Section spacing="none" className="pt-24 pb-3">
        <Overline>{t("still.overline")}</Overline>
        <h3 className="mt-4">{t("still.title")}</h3>
        <div className="mt-10">
          {stillRows.map((row) => (
            <LinkRow key={row.href} href={row.href} title={row.title}>
              {row.desc}
            </LinkRow>
          ))}
        </div>
      </Section>
    </>
  );
}

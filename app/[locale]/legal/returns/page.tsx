import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Columns, Container, Section } from "@/components/layout/container";
import {
  CategoryIndex,
  ChapterBreak,
  MetaRow,
  Note,
  Overline,
  PairRow,
  StepRow,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * 返品ポリシー — Figma 確定レイアウト `Common / Layouts` section 7857:39614
 * (PC 7857:39615 / SP 7858:39715) の実装。
 *
 * S1 見出し / S2 このページの内容 / S3 あなたの場合、どうなるか /
 * S4 ご連絡から解決までの流れ / S5 章切り / S6 お受けできないもの /
 * S7 返送先とご連絡先 / S8 静かなリンク の 8 ブロック構成。
 *
 * 内容が配送情報 S7「返品・交換について」と一部重なるが、両方とも凍結済みの
 * 確定レイアウトのため Figma どおり両方を実装する。重複の解消は仕様書改訂時の課題。
 */

type MetaEntry = { label: string; value: string };
type Pair = { term: string; desc: string };
type Step = { step: string; name: string; desc: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("returns");
  return { title: t("title"), description: t("lead") };
}

export default async function ReturnsPage() {
  const t = await getTranslations("returns");
  const bt = await getTranslations("breadcrumb");

  const summary = t.raw("summary.rows") as MetaEntry[];
  const cases = t.raw("cases.rows") as Pair[];
  const flow = t.raw("flow.rows") as Step[];
  const excluded = t.raw("excluded.rows") as Pair[];
  const contact = t.raw("contact.rows") as MetaEntry[];

  const index = [
    { id: "cases", label: t("index.cases") },
    { id: "flow", label: t("index.flow") },
    { id: "excluded", label: t("index.excluded") },
    { id: "contact", label: t("index.contact") },
  ];

  return (
    <>
      {/* S1 ページ見出し (Figma 7857:39656) */}
      <Section spacing="none" className="pt-10 pb-8">
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("breadcrumbParent") },
            { label: t("title") },
          ]}
        />
        <Overline className="mt-10">{t("kicker")}</Overline>
        <h1 className="mt-4">{t("title")}</h1>
        {/* リード幅 304 は Figma 実測。読み幅を絞って要点の対比を効かせる指定 */}
        <p className={`${bodySmClass} mt-6 max-w-76 text-muted-foreground`}>{t("lead")}</p>
        <Note className="mt-8">{t("summary.heading")}</Note>
        <dl className="mt-3 max-w-132">
          {summary.map((row) => (
            <MetaRow key={row.label} label={row.label}>
              {row.value}
            </MetaRow>
          ))}
        </dl>
      </Section>

      {/* S2 このページの内容 (Figma 7857:39676) */}
      <Container>
        <Note className="pb-4 md:hidden">{t("index.label")}</Note>
        <CategoryIndex
          aria-label={t("index.label")}
          density="compact"
          items={index.map((section) => ({
            label: section.label,
            href: `#${section.id}`,
          }))}
        />
      </Container>

      {/* S3 あなたの場合、どうなるか (Figma 7857:39695) */}
      <Section spacing="none" id="cases" className="pt-24 pb-8">
        <h3>{t("cases.heading")}</h3>
        <p className={`${bodySmClass} mt-4 max-w-76 text-muted-foreground`}>
          {t("cases.note")}
        </p>
        <dl className="mt-8 max-w-160 border-b border-border">
          {cases.map((row) => (
            <PairRow key={row.term} term={row.term}>
              {row.desc}
            </PairRow>
          ))}
        </dl>
      </Section>

      {/* S4 ご連絡から解決までの流れ (Figma 7857:39710) */}
      <Section spacing="none" id="flow" className="pt-24 pb-8">
        <h3>{t("flow.heading")}</h3>
        <p className={`${bodySmClass} mt-3 max-w-76 text-muted-foreground`}>{t("flow.note")}</p>
        {/* 順序に意味があるので ol。番号は Figma の表記 (01/02/03) をそのまま出す */}
        <ol className="mt-8 border-b border-border">
          {flow.map((row) => (
            <StepRow key={row.step} step={row.step} name={row.name}>
              {row.desc}
            </StepRow>
          ))}
        </ol>
      </Section>

      {/* S5 章切り — キッカー無し版 (Figma 7857:39777) */}
      <ChapterBreak title={t("chapter.title")}>{t("chapter.body")}</ChapterBreak>

      {/* S6 お受けできないもの (Figma 7857:39780) */}
      <Section spacing="none" id="excluded" className="pt-24 pb-8">
        <h3>{t("excluded.heading")}</h3>
        <p className={`${bodySmClass} mt-4 max-w-76 text-muted-foreground`}>
          {t("excluded.note")}
        </p>
        <dl className="mt-8 max-w-160 border-b border-border">
          {excluded.map((row) => (
            <PairRow key={row.term} term={row.term} tone="quiet">
              {row.desc}
            </PairRow>
          ))}
        </dl>
      </Section>

      {/* S7 返送先とご連絡先 (Figma 7857:39795) */}
      <Section spacing="none" id="contact" className="pt-24 pb-8">
        <h3>{t("contact.heading")}</h3>
        <p className={`${bodySmClass} mt-4 max-w-76 text-muted-foreground`}>
          {t("contact.note")}
        </p>
        <Note className="mt-8">{t("contact.subheading")}</Note>
        <dl className="mt-3 max-w-132">
          {contact.map((row) => (
            <MetaRow key={row.label} label={row.label}>
              {row.value}
            </MetaRow>
          ))}
        </dl>
      </Section>

      {/* S8 静かなリンク — 3 本のみ (Figma 7857:39808) */}
      <Section spacing="none" className="pt-24 pb-12">
        <Columns count={3} gap="md">
          <Link
            href="/products"
            className={`${bodySmClass} text-foreground hover:text-muted-foreground`}
          >
            {t("links.products")}
          </Link>
          <Link
            href="/shipping"
            className={`${bodySmClass} text-foreground hover:text-muted-foreground`}
          >
            {t("links.shipping")}
          </Link>
          <Link
            href="/contact"
            className={`${bodySmClass} text-foreground hover:text-muted-foreground`}
          >
            {t("links.contact")}
          </Link>
        </Columns>
      </Section>
    </>
  );
}

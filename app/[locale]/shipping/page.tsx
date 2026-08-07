import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Container, Section } from "@/components/layout/container";
import {
  CategoryIndex,
  ChapterBreak,
  DefinitionRow,
  MetaRow,
  Note,
  Overline,
  RateRow,
  ValueRow,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * 配送情報 — Figma 確定レイアウト `Common / Layouts` section 7848:39198
 * (PC 7848:39199 / SP 7851:796) の実装。
 *
 * S1 見出し (非対称) / S2 このページの内容 / S3 送料とお届け日数 /
 * S4 発送のタイミング / S5 配送方法とお届け時間帯 / S6 章切り /
 * S7 返品・交換について / S8 静かなリンク の 8 ブロック構成。
 *
 * Figma の指定どおり、料金表は箱組みテーブルを使わず罫線のみの定義行で組む。
 * 最下部の購入導線は 1 行のみ (押し売り CTA を置かない)。
 */

type MetaEntry = { label: string; value: string };
type Rate = { area: string; fee: string; eta: string };
type Term = { term: string; desc: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shipping");
  return { title: t("title"), description: t("lead") };
}

export default async function ShippingPage() {
  const t = await getTranslations("shipping");
  const bt = await getTranslations("breadcrumb");

  const facts = t.raw("facts.rows") as MetaEntry[];
  const rates = t.raw("rates.rows") as Rate[];
  const dispatch = t.raw("dispatch.rows") as Term[];
  const slots = t.raw("method.slots") as string[];
  const returns = t.raw("returns.rows") as Term[];

  const sections = [
    { id: "rates", label: t("index.rates") },
    { id: "dispatch", label: t("index.dispatch") },
    { id: "method", label: t("index.method") },
    { id: "returns", label: t("index.returns") },
  ];

  return (
    <>
      {/* S1 ページ見出し — 左 = 名乗り / 右 = お届けの事実 (Figma 7848:39240) */}
      <Section spacing="none" className="pt-10 pb-8">
        <Breadcrumb
          items={[{ label: bt("home"), href: "/" }, { label: t("title") }]}
        />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <Overline>{t("kicker")}</Overline>
            <h1 className="mt-4">{t("title")}</h1>
            <p className={`${bodySmClass} mt-6 text-muted-foreground`}>{t("lead")}</p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            {/* この右カラム見出しは英字 overline ではなく和文 caption (Figma 7848:39250) */}
            <Note>{t("facts.heading")}</Note>
            <dl className="mt-3">
              {facts.map((row) => (
                <MetaRow key={row.label} label={row.label}>
                  {row.value}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* S2 このページの内容 (Figma 7848:39260) */}
      <Container>
        <CategoryIndex
          aria-label={t("index.label")}
          density="compact"
          items={sections.map((section, i) => ({
            label: `0${i + 1}  ${section.label}`,
            href: `#${section.id}`,
          }))}
        />
      </Container>

      {/* S3 送料とお届け日数 — 罫線のみの定義行 (Figma 7848:39372) */}
      <Section spacing="none" id="rates" className="pt-24 pb-8">
        <h3>{t("rates.heading")}</h3>
        <p className={`${bodySmClass} mt-3 text-muted-foreground`}>{t("rates.note")}</p>
        <div className="mt-10">
          <div
            className="hidden md:flex md:gap-x-4"
            aria-hidden="true"
          >
            <Note className="md:w-168">{t("rates.colArea")}</Note>
            <Note className="md:w-84">{t("rates.colFee")}</Note>
            <Note className="min-w-0 flex-1">{t("rates.colEta")}</Note>
          </div>
          <div className="mt-3 border-b border-border">
            {rates.map((rate) => (
              <RateRow key={rate.area} area={rate.area} fee={rate.fee} eta={rate.eta} />
            ))}
          </div>
          <Note className="mt-8">{t("rates.free")}</Note>
        </div>
      </Section>

      {/* S4 発送のタイミング (Figma 7848:39391) */}
      <Section spacing="none" id="dispatch" className="pt-24 pb-8">
        <h3>{t("dispatch.heading")}</h3>
        <p className={`${bodySmClass} mt-3 text-muted-foreground`}>{t("dispatch.note")}</p>
        <dl className="mt-10 border-b border-border">
          {dispatch.map((row) => (
            <DefinitionRow key={row.term} term={row.term}>
              {row.desc}
            </DefinitionRow>
          ))}
        </dl>
      </Section>

      {/* S5 配送方法とお届け時間帯 — 左 = 本文 / 右 = 選べる値 (Figma 7848:39493) */}
      <Section spacing="none" id="method" className="pt-24 pb-8">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <h3>{t("method.heading")}</h3>
            <p className={`${bodySmClass} mt-4 text-foreground`}>{t("method.body")}</p>
          </div>
          <div className="mt-10 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>{t("method.slotsHeading")}</Note>
            <ul className="mt-3 border-b border-border">
              {slots.map((slot) => (
                <ValueRow key={slot}>{slot}</ValueRow>
              ))}
            </ul>
            <Note className="mt-3">{t("method.slotsNote")}</Note>
          </div>
        </div>
      </Section>

      {/* S6 章切り — キッカー無し版 (Figma 7848:39508) */}
      <ChapterBreak title={t("chapter.title")}>{t("chapter.body")}</ChapterBreak>

      {/* S7 返品・交換について (Figma 7848:39511) */}
      <Section spacing="none" id="returns" className="pt-24 pb-8">
        <h3>{t("returns.heading")}</h3>
        <p className={`${bodySmClass} mt-3 text-muted-foreground`}>{t("returns.note")}</p>
        <dl className="mt-10 border-b border-border">
          {returns.map((row) => (
            <DefinitionRow key={row.term} term={row.term}>
              {row.desc}
            </DefinitionRow>
          ))}
        </dl>
      </Section>

      {/* S8 静かなリンク — 購入導線は 1 行のみ (Figma 7848:39562) */}
      <Section spacing="none" className="pt-24 pb-12">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          <Link
            href="/products"
            className={`${bodySmClass} block text-foreground hover:text-muted-foreground lg:col-span-6`}
          >
            {t("links.products")}
          </Link>
          <Link
            href="/contact"
            className={`${bodySmClass} mt-8 block text-foreground hover:text-muted-foreground lg:col-span-5 lg:col-start-8 lg:mt-0`}
          >
            {t("links.contact")}
          </Link>
        </div>
      </Section>
    </>
  );
}

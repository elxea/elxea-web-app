import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { PortableTextBlock } from "@portabletext/types";

import { getClient } from "@/sanity/lib/client";
import { PAGE_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { PortableText } from "@/components/sanity/portable-text";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import {
  IndexRow,
  LinkRow,
  MetaRow,
  Note,
  Overline,
  RailRow,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * 汎用ページ — Figma 確定レイアウト `Common / Layouts` section 7857:968
 * (PC 7857:969 / SP 7858:39929) の実装。
 *
 * これは 1 枚のページではなく **型 (スロット)** で、Sanity の本文をはめて使う。
 * スロット仕様の正本は Figma 7861:1107。
 *
 * 構成: S1 見出し / S2 章目次 (章が 3 つ以上のときだけ) / S3 本文 (章ごとに
 * レール col1-3 + 本文 col4-9) / S4 章切り (任意) / S5 ページ末情報。
 *
 * 章の切り出し: Sanity の本文は素の PortableText なので、**h2 を章の始まり**として
 * 分割する。h2 より前のブロックは見出しを持たない前置き章として扱う。
 * 「章数は slot」という Figma の指定を、CMS 側に章の概念を足さずに満たす方法として
 * これを採った (Sanity スキーマ変更を伴わない)。
 *
 * 禁じ手 (Figma 明記): 購入導線を置かない。章切りは 1 ページに 1 回まで。
 * 関連ページは最大 3 件。
 */

type Chapter = { title: string | null; blocks: PortableTextBlock[] };

/** h2 を境に本文を章へ割る。h2 が無ければ 1 章 (無題) として返す。 */
function splitIntoChapters(body: PortableTextBlock[]): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter = { title: null, blocks: [] };

  for (const block of body) {
    const isHeading = block._type === "block" && block.style === "h2";
    if (isHeading) {
      if (current.title !== null || current.blocks.length > 0) chapters.push(current);
      const text = Array.isArray(block.children)
        ? block.children.map((child) => (child as { text?: string }).text ?? "").join("")
        : "";
      current = { title: text, blocks: [] };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.title !== null || current.blocks.length > 0) chapters.push(current);
  return chapters;
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const page = await client.fetch(PAGE_BY_SLUG_QUERY, { slug, language: locale });
    if (!page) return {};
    return { title: page.title };
  } catch {
    return {};
  }
}

export default async function GenericPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("page");
  const bt = await getTranslations("breadcrumb");

  let page;
  try {
    const client = getClient();
    page = await client.fetch(PAGE_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <Section spacing="lg">
        <p className={`${bodySmClass} text-muted-foreground`}>{t("loadError")}</p>
      </Section>
    );
  }

  if (!page) notFound();

  const body: PortableTextBlock[] = page.body ?? [];
  const chapters = splitIntoChapters(body);
  const titled = chapters.filter((chapter) => chapter.title);
  /** Figma スロット仕様: 章目次は 3 章以上のときだけ出す */
  const showIndex = titled.length >= 3;

  const updated = page._updatedAt
    ? new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(page._updatedAt))
    : null;
  const published = page._createdAt
    ? new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(page._createdAt))
    : null;

  return (
    <>
      {/* S1 ページ見出し (Figma 7857:39725) */}
      <Section spacing="none" className="pt-12 pb-0">
        <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: page.title }]} />
        {/* 分類ラベルは任意スロット。Sanity の page スキーマに該当フィールドが
            まだ無いため、Figma の既定値 COMMON を出す。
            リード (S1) と章切り (S4) も同様に未実装の任意スロット。
            スキーマに lead / category / pullQuote が入った時点で差し込む。 */}
        <RailRow className="mt-6" rail={<Overline>COMMON</Overline>}>
          <h1>{page.title}</h1>
          {updated ? <Note className="mt-6">{t("updatedAt", { date: updated })}</Note> : null}
        </RailRow>
        <hr className="mt-12 border-border" />
      </Section>

      {/* S2 章目次 — 章が 3 つ以上のときだけ (Figma 7857:39740) */}
      {showIndex ? (
        <Section spacing="none" className="pt-16 pb-0">
          <RailRow rail={<Overline>{t("contents")}</Overline>}>
            <ul>
              {titled.map((chapter, i) => (
                <IndexRow key={chapter.title} step={pad(i + 1)} href={`#chapter-${i + 1}`}>
                  {chapter.title}
                </IndexRow>
              ))}
            </ul>
          </RailRow>
        </Section>
      ) : null}

      {/* S3 本文 — 章ごとにレール + 本文 (Figma 7857:39849) */}
      <Section spacing="none" className="pt-24 pb-8">
        <div className="flex flex-col gap-12">
          {chapters.map((chapter, i) => {
            const index = titled.indexOf(chapter);
            const number = index >= 0 ? pad(index + 1) : null;
            return (
              <section
                key={chapter.title ?? `intro-${i}`}
                id={number ? `chapter-${index + 1}` : undefined}
                className="border-t border-border pt-8 first:border-t-0 first:pt-0"
              >
                <RailRow
                  rail={
                    chapter.title ? (
                      <>
                        <Overline>{number}</Overline>
                        <h2
                          className={
                            "[font:var(--typography-style-h4)] [letter-spacing:var(--typography-style-h4-tracking)] mt-2 text-foreground"
                          }
                        >
                          {chapter.title}
                        </h2>
                      </>
                    ) : null
                  }
                >
                  <PortableText value={chapter.blocks} />
                </RailRow>
              </section>
            );
          })}
        </div>
      </Section>

      {/* S4 章切り — 任意スロット (1 ページに 1 回まで / Figma 7858:39804)。
          Sanity スキーマに pullQuote が入るまで出さない。 */}

      {/* S5 ページ末情報 — 購入導線は置かない (Figma 7858:39811) */}
      <Section spacing="none" className="pt-24 pb-12">
        <RailRow rail={<Overline>PAGE INFO</Overline>}>
          <dl>
            {published ? (
              <MetaRow label={t("published")} labelWidth="medium">
                {published}
              </MetaRow>
            ) : null}
            {updated ? (
              <MetaRow label={t("updated")} labelWidth="medium">
                {updated}
              </MetaRow>
            ) : null}
            <MetaRow label={t("contact")} labelWidth="medium">
              {t("contactValue")}
            </MetaRow>
          </dl>
        </RailRow>

        <RailRow className="mt-16" rail={<Overline>RELATED</Overline>}>
          <div>
            {/* Figma スロット仕様: 関連ページは最大 3 件 */}
            <LinkRow href="/legal/terms" title={t("related.terms")} />
            <LinkRow href="/legal/tokushoho" title={t("related.tokushoho")} />
            <LinkRow href="/contact" title={t("related.contact")} />
          </div>
        </RailRow>
      </Section>
    </>
  );
}

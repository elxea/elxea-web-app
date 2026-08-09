import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CatalogCard, CatalogGrid } from "@/components/catalog/catalog-list";
import {
  CategoryIndex,
  ChapterBreak,
  MetaRow,
  Overline,
  StepRow,
  bodySmClass,
  captionClass,
} from "@/components/editorial/rule-list";
import {
  PageSection,
  SectionBody,
  SectionNote,
  ValueCards,
} from "@/components/editorial/section-blocks";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { ImageCard } from "@/components/ui/image-card";
import { Link } from "@/i18n/navigation";
import { filterOutFictionalFarmers } from "@/lib/fictional-farmers";
import { placeholderValue } from "@/lib/placeholders";
import { isSeedId, withSeedFarmers } from "@/lib/preview-seed";
import { cn } from "@/lib/utils";
import { urlFor } from "@/sanity/lib/image";
import { getClient } from "@/sanity/lib/client";
import { FARMERS_QUERY } from "@/sanity/lib/queries";

/**
 * About — Figma【R2: 確定版】目次付き読み物型 (C案採用)
 * section `8121:1263` (PC `8121:1264` / SP `8121:1333`)。
 *
 * Statement → 目次 (6 章) → 01 わたしたちのこと → 産地タイル → 02 選ぶ基準 →
 * 章切り → 03 つくり方 → 04 つくり手 → 05 お茶との向き合い方 → 06 会社情報 →
 * 静かなリンク の 11 ブロック構成。
 *
 * 旧実装 (R1 世代) は写真ヒーロー + `max-w-3xl` の読み枠に Mission / Story /
 * Values を積む形で、目次・産地・つくり手・会社情報を持たなかった。確定版で全面置換。
 *
 * ## 実装の決めごと
 * - **生 px・生カラーを書かない**。寸法は Tailwind spacing scale (spacing トークンと
 *   同じ 0.25rem 刻み)、文字組みは `typography.style.*`、色は semantic token のみ。
 * - **主見出しは `.page-title` (PC 44 / SP 32)**。Figma の Statement 見出しは 32px
 *   (`elxea/typography/editorial/jp/h1`) だが、ページ主見出しのスケールはプロジェクト
 *   全体裁定 (PC 44 / SP 32) を正とする。忠実度対比表に [仕様] として記録。
 * - **節見出しは `data-slot="section-title"`** (globals.css で h3 プリセット 20px)。
 *   キッカー → 見出しの溝が Figma 実測 SP 24 / PC 32 で、`SectionHead` の既定
 *   (SP 20 / PC 8 = 商品詳細 R2 由来) と合わないため、共有部品を書き換えるのではなく
 *   ページ内で `Overline` + h2 を組む (`AboutSectionHead`)。
 * - **データが無い節・行は枠ごと出さない**。つくり手 (04) は農家データが 0 件なら
 *   節そのものを描画しない。
 * - **会社情報の所在地は仮値**。`lib/placeholders.ts` のレジストリ経由で読むので、
 *   本番相当ビルドは仮値が残っている間は必ず落ちる (台帳 `docs/placeholders.md`)。
 * - 目次は同一ページ内アンカー。ヘッダーが `sticky top-0` なので、各節に
 *   `scroll-mt-*` (SP 80 / PC 96 = ヘッダー高 60/68 + 余白) を当てて見出しが
 *   隠れないようにする。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return {
    title: t("title"),
    description: t("subtitle"),
    openGraph: { title: t("title"), description: t("subtitle") },
  };
}

/** 各節のアンカー id。目次の href と節の id で同じ値を使う。 */
const ANCHOR = {
  us: "us",
  criteria: "criteria",
  how: "how",
  makers: "makers",
  attitude: "attitude",
  company: "company",
} as const;

/** sticky ヘッダー (SP 60 / PC 68) の下に見出しが隠れないための逃げ。 */
const SCROLL_OFFSET = "scroll-mt-20 lg:scroll-mt-24";

/**
 * 節見出し (章番号キッカー + 日本語見出し)。
 * Figma 実測: キッカー h17 → 見出し h27 の溝は SP 24 / PC 32。
 */
function AboutSectionHead({ no, title }: { no: string; title: string }) {
  return (
    <div data-slot="about-section-head">
      <Overline>{no}</Overline>
      <h2 data-slot="section-title" className="mt-6 text-foreground lg:mt-8">
        {title}
      </h2>
    </div>
  );
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const bt = await getTranslations("breadcrumb");

  const index = [
    { no: t("us.no"), label: t("us.short"), href: `#${ANCHOR.us}` },
    { no: t("criteria.no"), label: t("criteria.short"), href: `#${ANCHOR.criteria}` },
    { no: t("how.no"), label: t("how.short"), href: `#${ANCHOR.how}` },
    { no: t("makers.no"), label: t("makers.short"), href: `#${ANCHOR.makers}` },
    { no: t("attitude.no"), label: t("attitude.short"), href: `#${ANCHOR.attitude}` },
    { no: t("company.no"), label: t("company.short"), href: `#${ANCHOR.company}` },
  ];

  const origins = [t("origins.a1"), t("origins.a2"), t("origins.a3"), t("origins.a4")];

  /* 「決めていること」「決めていないこと」を左右で対にする (Figma 8121:1287 系の並び)。 */
  const criteria = [
    { title: t("criteria.decided"), body: t("criteria.d1") },
    { title: t("criteria.undecided"), body: t("criteria.u1") },
    { title: t("criteria.decided"), body: t("criteria.d2") },
    { title: t("criteria.undecided"), body: t("criteria.u2") },
    { title: t("criteria.decided"), body: t("criteria.d3") },
    { title: t("criteria.undecided"), body: t("criteria.u3") },
  ];

  const howSteps = [
    { step: "01", name: t("how.s1Name"), body: t("how.s1Body") },
    { step: "02", name: t("how.s2Name"), body: t("how.s2Body") },
    { step: "03", name: t("how.s3Name"), body: t("how.s3Body") },
  ];

  const attitudeSteps = [
    { step: "01", name: t("attitude.s1Name"), body: t("attitude.s1Body") },
    { step: "02", name: t("attitude.s2Name"), body: t("attitude.s2Body") },
    { step: "03", name: t("attitude.s3Name"), body: t("attitude.s3Body") },
  ];

  const company = [
    { label: t("company.name"), value: t("company.nameValue") },
    { label: t("company.headOffice"), value: placeholderValue("about.headOffice") },
    { label: t("company.branchOffice"), value: placeholderValue("about.branchOffice") },
    { label: t("company.handles"), value: t("company.handlesValue") },
    { label: t("company.contact"), value: placeholderValue("tokushoho.email") },
  ];

  return (
    <>
      {/* パンくず (Figma 8121:1266 / SP 8121:1337) — 上下 SP 16 / PC 24 */}
      <Section spacing="none" className="pt-4 pb-4 lg:pt-6 lg:pb-6">
        <Breadcrumb
          className="mb-0"
          items={[{ label: bt("home"), href: "/" }, { label: t("title") }]}
        />
      </Section>

      {/* Statement (Figma 8121:1268 / SP 8121:1339) */}
      <PageSection data-slot="about-statement" className="pt-12 pb-7 lg:pt-24 lg:pb-17">
        <Overline>{t("overline")}</Overline>
        {/* Figma 実測の溝: キッカー → 見出し SP 23 / PC 31 */}
        <h1 className="page-title mt-6 text-foreground lg:mt-8">{t("statementTitle")}</h1>
        {/* Figma 実測の溝: 見出し → リード SP 28 / PC 58。折返し幅は PC 640 */}
        <div className={cn(bodySmClass, "mt-7 max-w-160 text-muted-foreground lg:mt-14")}>
          <p>{t("statementLead1")}</p>
          <p>{t("statementLead2")}</p>
        </div>
      </PageSection>

      {/* 目次 (Figma 8121:1272 / SP 8121:1343) — PC は 1 段 3 項目 x 2 段 */}
      <Section spacing="none">
        <CategoryIndex
          aria-label={t("title")}
          density="chapters"
          perRow={3}
          items={index.map((item) => ({
            // Figma は「01␣␣わたしたちのこと」の 2 スペース区切り
            label: `${item.no}  ${item.label}`,
            href: item.href,
          }))}
        />
      </Section>

      {/* 01 わたしたちのこと (Figma 8121:1279 / SP 8121:1353) */}
      <PageSection id={ANCHOR.us} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* 本文 col1-6 (実測 640) / 写真 col7-12 (実測 x672 w640) */}
          <div className="lg:col-span-6">
            <AboutSectionHead no={t("us.no")} title={t("us.title")} />
            <SectionBody className={cn(bodySmClass, "text-foreground lg:mt-9")}>
              <p>{t("us.body1")}</p>
              <p className="mt-6">{t("us.body2")}</p>
            </SectionBody>
          </div>
          <div data-slot="about-us-figure" className="mt-10 lg:col-span-6 lg:col-start-7 lg:mt-0">
            <ImageCard
              image={undefined}
              alt={t("us.imageAlt")}
              /* SP 16:9 (343x192) / PC 10:7 (640x448)。ImageCard は aspectRatio を
                 インラインで当てるので、BP ごとに変えるには style 側を打ち消して
                 utility に任せる (生 px は書かない)。 */
              style={{ aspectRatio: undefined }}
              className="aspect-[16/9] lg:aspect-[10/7]"
              sizes="(max-width: 1024px) 100vw, 640px"
            />
          </div>
        </div>
      </PageSection>

      {/* 産地タイル (Figma 8121:1409 / SP 8121:1419) — 写真は撮影後に差替 */}
      <PageSection className="pt-12 lg:pt-16">
        <Overline>{t("origins.overline")}</Overline>
        <ul data-slot="about-origins" className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 lg:mt-12 lg:grid-cols-4 lg:gap-x-8">
          {origins.map((area) => (
            <li data-slot="about-origin" key={area}>
              {/* PC 304x224 / SP 163.5x120 = どちらも 19:14 */}
              <ImageCard image={undefined} alt="" aspectRatio="19/14" sizes="(max-width: 1024px) 50vw, 304px" />
              <p className={cn(captionClass, "mt-2 text-muted-foreground lg:mt-4")}>{area}</p>
            </li>
          ))}
        </ul>
      </PageSection>

      {/* 02 選ぶ基準 (Figma 8121:1284 / SP 8121:1358) */}
      <PageSection id={ANCHOR.criteria} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
        <AboutSectionHead no={t("criteria.no")} title={t("criteria.title")} />
        <ValueCards className="mt-3 lg:mt-13" items={criteria} />
        <SectionNote className="mt-4 max-w-none lg:mt-6">{t("criteria.note")}</SectionNote>
      </PageSection>

      {/* 章切り (Figma 8121:1293 / SP 8121:1367) — 明度反転・中央寄せ・帯 PC 320 */}
      <ChapterBreak
        size="tall"
        align="center"
        overline={t("chapter.overline")}
        title={t("chapter.title")}
      >
        {t("chapter.body")}
      </ChapterBreak>

      {/* 03 つくり方 (Figma 8121:1297 / SP 8121:1371) */}
      <PageSection id={ANCHOR.how} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
        <AboutSectionHead no={t("how.no")} title={t("how.title")} />
        <ol data-slot="about-how" className="mt-7 lg:mt-13">
          {howSteps.map((step) => (
            <StepRow key={step.step} step={step.step} name={step.name} layout="wide">
              {step.body}
            </StepRow>
          ))}
        </ol>
      </PageSection>

      {/* 04 つくり手 (Figma 8121:1429 / SP 8121:1434) — 農家データが 0 件なら節を出さない */}
      <MakersSection />

      {/* 05 お茶との向き合い方 (Figma 8121:1524 / SP 8121:1539) */}
      <PageSection id={ANCHOR.attitude} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
        <AboutSectionHead no={t("attitude.no")} title={t("attitude.title")} />
        <ol data-slot="about-attitude" className="mt-7 lg:mt-13">
          {attitudeSteps.map((step) => (
            <StepRow key={step.step} step={step.step} name={step.name} layout="wide">
              {step.body}
            </StepRow>
          ))}
        </ol>
      </PageSection>

      {/* 06 会社情報 (Figma 8121:1312 / SP 8121:1386) — PC 2 列 / SP 縦積み */}
      <PageSection id={ANCHOR.company} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
        <AboutSectionHead no={t("company.no")} title={t("company.title")} />
        <dl data-slot="about-company" className="mt-7 lg:mt-13">
          {company.map((row) => (
            <MetaRow
              key={row.label}
              label={row.label}
              labelWidth="medium"
              spLayout="stack"
              /* Figma 実測: ラベル列 192 + 溝 32 (値の左端 x288) */
              className="md:gap-x-8"
            >
              {row.value}
            </MetaRow>
          ))}
        </dl>
      </PageSection>

      {/* 静かなリンク (Figma 8121:1330 / SP 8121:1404) — 購入導線は主張しない */}
      <PageSection className="pt-16 pb-15 lg:pt-22 lg:pb-20">
        <div data-slot="about-quiet-links" className="lg:grid lg:grid-cols-12 lg:gap-8">
          <Link
            href="/products"
            className={cn(bodySmClass, "block text-foreground hover:text-muted-foreground lg:col-span-4")}
          >
            {t("links.products")}
          </Link>
          <Link
            href="/journal"
            className={cn(
              bodySmClass,
              "mt-4 block text-foreground hover:text-muted-foreground",
              "lg:col-span-4 lg:col-start-5 lg:mt-0"
            )}
          >
            {t("links.journal")}
          </Link>
        </div>
      </PageSection>
    </>
  );
}

type Farmer = {
  _id: string;
  name: string;
  slug: { current: string };
  imageUrl?: string;
  photo?: { asset: object; alt?: string };
  region?: string;
  country?: string;
};

/** Figma は 3 枚 (PC 3 列 / SP 横スクロール)。 */
const MAKERS_COUNT = 3;

/**
 * 04 つくり手。農家一覧 (`app/[locale]/farmers/page.tsx`) と同じデータ経路
 * (`FARMERS_QUERY` → 架空プロフィール除外 → Preview 限定の見本補完) を使う。
 * 0 件なら節そのものを描画しない (空の枠を出さない)。
 */
async function MakersSection() {
  const locale = await getLocale();
  const t = await getTranslations("about");

  let fetched: Farmer[] = [];
  try {
    const client = getClient();
    fetched = (await client.fetch(FARMERS_QUERY, { language: locale })) ?? [];
  } catch {
    // 取得できないときは節を出さない (エラー文だけの枠を残さない)。
    return null;
  }

  const farmers = (withSeedFarmers(filterOutFictionalFarmers(fetched), MAKERS_COUNT) as Farmer[]).slice(
    0,
    MAKERS_COUNT
  );

  if (farmers.length === 0) return null;

  return (
    <PageSection id={ANCHOR.makers} className={cn("pt-12 lg:pt-16", SCROLL_OFFSET)}>
      <AboutSectionHead no={t("makers.no")} title={t("makers.title")} />
      {/* SP は Figma どおり横スクロール (カード幅 = 内容カラム幅 343 / ピッチ 359)。
          PC は共通の 3 列グリッドに戻す。 */}
      <CatalogGrid className="-mx-4 mt-9 flex gap-x-4 overflow-x-auto px-4 lg:mx-0 lg:mt-13 lg:grid lg:overflow-visible lg:px-0">
        {farmers.map((farmer) => {
          const seeded = isSeedId(farmer._id);
          const image =
            farmer.imageUrl ??
            (farmer.photo?.asset
              ? urlFor(farmer.photo).width(600).height(400).url()
              : undefined);
          return (
            <CatalogCard
              key={farmer._id}
              className="w-full shrink-0 lg:w-auto"
              href={seeded ? undefined : `/farmers/${farmer.slug.current}`}
              image={image}
              imageAlt={farmer.name}
              overline={t("makers.overline")}
              title={farmer.name}
              meta={farmer.region || farmer.country || undefined}
            />
          );
        })}
      </CatalogGrid>
    </PageSection>
  );
}

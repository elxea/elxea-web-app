import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { JOURNALS_QUERY } from "@/sanity/lib/queries";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ImageCard } from "@/components/ui/image-card";
import { ArticleCard } from "@/components/journal/article-card";
import {
  ArticleRail,
  HeroFeature,
  JournalGrid,
  JournalLayout,
} from "@/components/journal/journal-list";
import { urlFor } from "@/sanity/lib/image";
import { previewImageForKey, previewSeedEnabled, withSeedJournals } from "@/lib/preview-seed";

/**
 * elxea Journal 一覧 — Figma の凍結済み兄弟 R2 から導出した実装。
 *
 * ## R2 確定版が「無い」ことの裏取り
 * 全文書ツリーを走査して R2 / 確定版を名前に含むノード 155 件を全列挙した結果、
 * **elxea Journal 一覧の R2 確定版フレームは存在しない**。この画面の R1 は
 * section `7822:2844`「【廃止】 elxea Journal」(PC `7822:2845` / SP `7823:3066`)
 * として **廃止マーカー付きで Archive 済み**。変A 世代 (section `6761:11127`
 * `@/ja/elxea-journal`) が実装の出発点だった。
 * ※ Structure DB の `Figma` プロパティは変A 世代を指す stale 値なので使わない
 *   (C8-1 / C9-1 / C10-1 と同じ罠)。
 *
 * ## よって「凍結済み兄弟 R2」から導出する (C9-1 と同じ作法)
 * 導出元は 2 枚:
 *   - ジャーナル一覧【R2: 確定版】共通リストパターン整合 + 特集枠 + サイドバー
 *     (PC `8073:44722` / SP `8074:4044`) …… 一覧の骨格そのもの
 *   - プレイリスト一覧【R2: 確定版】ジャーナル一覧整合 + **今月号特集枠** +
 *     サイドバー (PC `8085:4299` / SP `8085:4353`) …… 「号」を持つ媒体一覧の先例
 * elxea Journal は定期便に同梱する「号」の媒体なので、後者の
 * 「今月号特集枠」までを含む形が最も近い。したがって部品はジャーナル一覧・
 * プレイリスト一覧と丸ごと共有し (`components/catalog/*` +
 * `components/journal/journal-list.tsx` + `ArticleCard`)、このファイルは
 * elxea Journal のデータをカードの形に写す役だけを持つ。
 *
 * 構成: Breadcrumb → PageHead → 今月号特集枠 → Toolbar (テーマのチップ +
 * 並び替え) → [号グリッド + サイドバー] → もっと見る。
 *
 * 絞り込み (`?category=` = テーマ) / 並び替え (`?sort=`) / 表示件数 (`?show=`)
 * は URL に載せる。既定は新しい順。クエリキーを `theme` ではなく `category` に
 * するのは、共有する `ArticleCard` がカードのキッカーから
 * `?category=` のリンクを張るため (キーを変えるとカードのリンクだけ外れる)。
 *
 * 確定版に枠が無いが実装に残すもの (意図的差分):
 * - なし。
 * 変A から落としたもの (意図的差分):
 * - 中央寄せの PageHead …… R2 共通リストパターンの PageHead は左寄せ。
 * - テーマの色バッジ (Figma `6934:143`) …… R2 共通リストパターンは
 *   「ピル型統一」でカード上の色オーバーレイを持たない。テーマは
 *   ArticleCard のキッカー行 (茜 / 翠 / そひ) として文字で残す。詳細ページも
 *   確定版で同じ理由からバッジを英字キッカーに置き換えている (8110:46893)。
 *   ブランドの色そのものを一覧に戻す判断が要るなら Figma 側に枠を足して
 *   凍結してから実装する — コード側で先に生やさない。
 */

/** 短縮ラベル (Figma Journal Theme Badge `6934:143` が正)。 */
const themeLabels: Record<string, string> = {
  akane: "茜",
  sui: "翠",
  sohi: "そひ",
};

/** チップの並び順 (Figma のテーマ順)。 */
const themeOrder = ["akane", "sui", "sohi"] as const;

/** Figma の記事グリッドは 2 列 x 3 段 = 6 件を初期表示する (8085:4327)。 */
const PAGE_SIZE = 6;

/** サイドバー「ほかの号」の件数 (Figma 8085:4344 は 5 行)。 */
const RAIL_SIZE = 5;

type SearchParams = { category?: string; sort?: string; show?: string };

type JournalItem = {
  _id: string;
  slug: { current: string };
  title: string;
  theme: string;
  summary?: string;
  mainImage?: { asset: object; alt?: string };
  thumbnail?: { asset: object; alt?: string };
  featured?: boolean;
  _createdAt?: string;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("elxeaJournal");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: { title: t("title"), description: t("description") },
  };
}

export default async function ElxeaJournalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("elxeaJournal");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("title") }]} />

      <ListPageHead overline={t("kicker")} title={t("title")} lead={t("description")} />

      <Suspense fallback={<JournalSkeleton />}>
        <JournalContent params={params} />
      </Suspense>
    </Section>
  );
}

function JournalSkeleton() {
  return (
    <JournalGrid className="mt-8 lg:mt-12">
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-4">
          <ImageCard />
          <div className="space-y-1.5">
            <div className="h-3 w-16 bg-muted" />
            <div className="h-4 w-3/4 bg-muted" />
            <div className="h-3 w-full bg-muted" />
          </div>
        </div>
      ))}
    </JournalGrid>
  );
}

/** 特集写真は 1312x546 で切り出す (Figma 8085:4309)。 */
function heroImage(journal: JournalItem): string | undefined {
  const image = journal.mainImage ?? journal.thumbnail;
  if (image?.asset) return urlFor(image).width(1312).height(546).url();
  return previewSeedEnabled() ? previewImageForKey(journal._id) : undefined;
}

/**
 * 号を `ArticleCard` (Figma `ArticleCard — elxea/Journal S3`) の形に写す。
 * テーマはカードのキッカー行に載せる (`category` スロット)。elxea Journal に
 * 日付フィールドは無いので、メタ行 (著者・日付) は空のまま = 出ない。
 */
function toCard(journal: JournalItem) {
  return {
    _id: journal._id,
    slug: journal.slug,
    title: journal.title,
    excerpt: journal.summary,
    thumbnail: journal.thumbnail,
    mainImage: journal.mainImage,
    category: themeLabels[journal.theme]
      ? { title: themeLabels[journal.theme], slug: { current: journal.theme } }
      : undefined,
  };
}

async function JournalContent({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  let fetched: JournalItem[];
  try {
    const client = getClient();
    fetched = await client.fetch(JOURNALS_QUERY, { language: locale });
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  // Preview-only: the dataset has no tea-menu journals, so inject dummy
  // entries to review the grid. No effect when flag unset / real data exists.
  // 見本は `featured` / `_createdAt` を持たないため、下の分岐はいずれも
  // 「未設定」として素通りする (並びは見本の配列順のまま)。
  const journals = withSeedJournals(fetched) as JournalItem[];

  if (journals.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  const sort = params.sort === "oldest" ? "oldest" : "newest";

  const presentThemes = new Set(journals.map((j) => j.theme).filter(Boolean));
  const chips = [
    { value: "all", label: tl("all") },
    ...themeOrder
      .filter((theme) => presentThemes.has(theme))
      .map((theme) => ({ value: theme, label: themeLabels[theme] })),
  ];
  const activeTheme =
    params.category && presentThemes.has(params.category) ? params.category : "all";

  // 今月号は「編集判断で指定」(Figma 8085:4308)。Sanity の featured フラグを
  // 唯一の根拠にし、無ければ先頭の号を充てる。絞り込み中は出さない
  // (絞り込み結果と特集が食い違うため)。
  const featured =
    activeTheme === "all" ? (journals.find((j) => j.featured) ?? journals[0]) : undefined;

  const pool = journals.filter((j) => j._id !== featured?._id);
  const filtered =
    activeTheme === "all" ? pool : pool.filter((j) => j.theme === activeTheme);

  // 並び替え。elxea Journal に公開日フィールドは無いので、Sanity の
  // `_createdAt` (作成日時) を唯一の根拠にする。未設定の号は末尾に落とす。
  const ordered = [...filtered].sort((a, b) => {
    const at = a._createdAt ?? "";
    const bt2 = b._createdAt ?? "";
    if (at === bt2) return 0;
    if (!at) return 1;
    if (!bt2) return -1;
    return sort === "oldest" ? at.localeCompare(bt2) : bt2.localeCompare(at);
  });

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = ordered.slice(0, show);
  const remaining = ordered.length - visible.length;

  const query = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (activeTheme !== "all") usp.set("category", activeTheme);
    if (sort !== "newest") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/elxea-journal?${qs}` : "/elxea-journal";
  };

  const railIssues = journals
    .filter((j) => j._id !== featured?._id)
    .slice(0, RAIL_SIZE)
    .map((j) => ({ label: j.title, href: `/elxea-journal/${j.slug.current}` }));

  const railThemes = chips
    .filter((c) => c.value !== "all")
    .map((c) => ({ label: c.label, href: `/elxea-journal?category=${c.value}` }));

  return (
    <>
      {featured ? (
        <HeroFeature
          className="mt-8 lg:mt-12"
          href={`/elxea-journal/${featured.slug.current}`}
          label={t("featuredIssue")}
          image={heroImage(featured)}
          imageAlt={featured.title}
          meta={themeLabels[featured.theme]}
          title={featured.title}
          lead={featured.summary}
        />
      ) : null}

      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeTheme}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "newest", label: tl("sortNewest") },
          { value: "oldest", label: tl("sortOldest") },
        ]}
      />

      <JournalLayout className="mt-8 lg:mt-12">
        {visible.length === 0 ? (
          <p className="order-1 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <JournalGrid>
            {visible.map((journal) => (
              <ArticleCard
                key={journal._id}
                article={toCard(journal)}
                memberOnlyLabel={tCommon("memberOnly")}
                hrefBase="/elxea-journal"
              />
            ))}
          </JournalGrid>
        )}

        {remaining > 0 ? (
          <MoreRow
            className="order-2 mt-8 lg:col-span-2 lg:mt-12"
            href={query({ show: String(show + PAGE_SIZE) })}
            label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
          />
        ) : null}

        <ArticleRail
          popularTitle={t("otherIssues")}
          popular={railIssues}
          categoryTitle={t("themes")}
          categories={railThemes}
        />
      </JournalLayout>
    </>
  );
}

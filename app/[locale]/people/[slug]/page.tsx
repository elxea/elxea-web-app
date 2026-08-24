import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  PERSON_BY_SLUG_QUERY,
  OTHER_PEOPLE_QUERY,
  ARTICLES_BY_AUTHOR_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { AuthorByline } from "@/components/journal/author-byline";
import { ArticleCard } from "@/components/journal/article-card";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import { FavoriteToggleButton } from "@/components/favorites/favorite-toggle-button";
import { SpecBand } from "@/components/editorial/section-blocks";
import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import {
  InterviewList,
  PersonCardGrid,
  PersonDataBand,
  PersonHead,
  PersonQuote,
  PersonSection,
  PersonSectionBody,
  PersonSectionHead,
  ProcessGrid,
  personBandClass,
  type PersonCardItem,
  type ProcessItem,
} from "@/components/people/person-detail";
import {
  previewImageForKey,
  previewSeedEnabled,
  withSeedPersonDetail,
} from "@/lib/preview-seed";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * People 詳細 — Figma「【採用: 作り手の共通テンプレ】 People 詳細」
 * (section 7822:37212 / PC 7822:37213 / SP 7823:37542、page 7567:5
 * Journal / Layouts) の実装。
 *
 * ## SoT の所在 (2026-08-09 全数走査で確定)
 * Structure DB の `Figma` プロパティ `6703:14332` は
 * `People詳細 変A（部品ベース）— PC/SP @/ja/people/[slug]` (page 6054:15 =
 * elxea / Proposals) を指しており **stale** (本 PJ で 4 件目の stale 実例)。
 * `【R2: 確定版】` を冠する People 詳細フレームは全 14 ページ走査の結果 0 件。
 *
 * ただしこの画面は「R2 が無い」のではなく、**テンプレ側が上位 SoT** という構造:
 * - 農家詳細の確定版 = `【R2: 確定版】 農家詳細 (People 詳細テンプレ統合)` (8079:3747)
 * - その旧版 = `【要修正: People 詳細へ統合】 農家詳細` (統合の向きが農家 → People)
 * - プレイリスト詳細の確定版も `People 詳細テンプレ整合` を名乗る (8089:4518)
 *
 * つまり People 詳細テンプレは複数画面が参照する共通テンプレで、その **R2 世代の
 * 実測値は農家詳細【R2: 確定版】(8079:3748 / 8079:3966) に入っている**。
 * その実測値は `components/farmers/farmer-detail.tsx` (C4-4a) が既に体現している
 * ので、本ページはその部品を `components/people/person-detail.tsx` 経由で
 * そのまま使う (実装を複製しない)。
 *
 * ## 節構成 (農家詳細から茶園 2 節を除いた形)
 *   1. PersonHead     写真 + 氏名 + 肩書 + メタ + 実数 + 聞き手クレジット
 *   2. Quote          反転面・本人の一言
 *   3. THE WORK       手仕事の工程
 *   4. INTERVIEW      一問一答 (本文幅 640 / サイドバー無し)
 *   5. 紹介文          bio (テンプレに枠は無いが既存データを落とさないため)
 *   6. PROFILE        4 カラムのデータ帯
 *   7. この人のお茶    relatedProducts (Shopify)
 *   8. この人の記事    ARTICLES_BY_AUTHOR (既存機能。会員限定バッジを保つため
 *                     テンプレの写真カードではなく ArticleCard を使う)
 *   9. OTHER PEOPLE   ほかの人をたずねる
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 と同じ)。
 *
 * ## 修正した既存バグ
 * 旧実装は `ARTICLES_BY_AUTHOR_QUERY` に `$start` / `$end` を渡していなかった。
 * このクエリは `[$start...$end]` でスライスするので GROQ がパラメータ不足で
 * 失敗し、**try/catch に落ちてページ全体が「読み込めませんでした」になっていた**。
 * 本実装では明示的に範囲を渡す。
 */

/**
 * 記事の節に出す上限。PC 3 列 x 2 段 / SP 2 列 x 3 段でちょうど収まる 6 件。
 *
 * グリッドは `JournalGrid` (ジャーナル一覧の PC 2 列) ではなく `CatalogGrid`
 * (PC 3 列 / SP 2 列) を使う。**詳細ページの中に記事の帯を置くとき**の既存の
 * 正は商品詳細の「読みもの」節 (`app/[locale]/products/[handle]/page.tsx` が
 * `CatalogGrid` + `ArticleCard`) であり、People 詳細テンプレの写真カード帯
 * (PC 3 列 416) とも列リズムが揃う。会員限定バッジを保つためカードは
 * `ArticleCard` のまま使う。
 */
const ARTICLE_LIMIT = 6;

type AuthorRef = {
  name: string;
  role?: string;
  image?: { asset: object; alt?: string };
};

type PhotoRef = { asset: object; alt?: string };

type ProcessStep = {
  name: string;
  description?: string;
  photo?: PhotoRef;
};

type BandRow = { label: string; value: string };

type Person = {
  _id: string;
  name: string;
  slug: { current: string };
  image?: PhotoRef;
  role?: string;
  bio?: string;
  website?: string;
  kicker?: string;
  meta?: string;
  stats?: { value: string; label: string }[];
  interviewer?: AuthorRef;
  quote?: string;
  quoteBy?: string;
  workHead?: string;
  work?: ProcessStep[];
  interview?: { question: string; answer: string }[];
  profileBand?: BandRow[];
  relatedProducts?: string[];
  teasHead?: string;
};

type OtherPerson = {
  _id: string;
  name: string;
  slug: { current: string };
  image?: PhotoRef;
  role?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getClient();
    const person: Person | null = await client.fetch(PERSON_BY_SLUG_QUERY, { slug });
    if (!person) return {};
    const image = person.image?.asset
      ? urlFor(person.image).width(800).url()
      : undefined;
    return {
      title: person.name,
      description: person.meta || person.role || person.bio?.slice(0, 160) || person.name,
      openGraph: {
        title: person.name,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

/** 写真つきカードの画像 URL。プレビュー時のみプレースホルダを補う。 */
function photoUrl(
  photo: PhotoRef | undefined,
  seedKey: string,
  width: number,
  height: number
): string | undefined {
  if (photo?.asset) return urlFor(photo).width(width).height(height).url();
  return previewSeedEnabled() ? previewImageForKey(seedKey) : undefined;
}

/** THE WORK は「番号つき工程」型。農家詳細と同じ整形。 */
function toProcessItems(
  steps: ProcessStep[] | undefined,
  keyPrefix: string
): ProcessItem[] {
  return (steps ?? []).map((step, i) => ({
    key: `${keyPrefix}-${i}`,
    no: String(i + 1).padStart(2, "0"),
    name: step.name,
    description: step.description,
    image: photoUrl(step.photo, `${keyPrefix}-${i}`, 416, 312),
    imageAlt: step.photo?.alt ?? step.name,
  }));
}

export default async function PeoplePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("people");
  const bt = await getTranslations("breadcrumb");
  const tCommon = await getTranslations("common");

  let person: Person | null;
  let others: OtherPerson[] = [];
  let articles: Parameters<typeof ArticleCard>[0]["article"][] = [];
  try {
    const client = getClient();
    person = await client.fetch(PERSON_BY_SLUG_QUERY, { slug });
    if (person) {
      others = (await client.fetch(OTHER_PEOPLE_QUERY, { slug })) ?? [];
      // 旧実装は $start / $end を渡しておらず GROQ が失敗していた (上の注記参照)。
      articles =
        (await client.fetch(ARTICLES_BY_AUTHOR_QUERY, {
          language: locale,
          authorSlug: slug,
          start: 0,
          end: ARTICLE_LIMIT,
        })) ?? [];
    }
  } catch {
    return (
      <div className="page-container py-16">
        <p className={cn(bodySmClass, "text-muted-foreground")}>{t("loadError")}</p>
      </div>
    );
  }

  if (!person) notFound();

  // Preview-only: production dataset の author はまだテンプレの節フィールドを
  // 持たないため、フラグが立っているときだけ未入力欄を見本で埋めて実寸で確認
  // できるようにする。フラグ未設定時は byte-identical (何も足さない)。
  person = withSeedPersonDetail(person);

  /* --- 1. PersonHead ------------------------------------------------------ */

  const heroImage = photoUrl(person.image, person._id, 640, 800);

  /* お気に入りに保存する画像。**絶対 URL でなければ null**。
     API の受け口が `z.string().url()` なので、プレビュー用の見本画像 (相対パス)
     をそのまま渡すと 400 になる。Sanity の画像 URL は絶対なのでそのまま通る。 */
  const favoriteImage =
    heroImage && /^https?:\/\//.test(heroImage) ? heroImage : null;

  /* --- 3. THE WORK -------------------------------------------------------- */

  const workItems = toProcessItems(person.work, "work");

  /* --- 4. INTERVIEW ------------------------------------------------------- */

  const interviewItems = (person.interview ?? []).map((row, i) => ({
    no: `${t("questionPrefix")} ${String(i + 1).padStart(2, "0")}`,
    question: row.question,
    answer: row.answer,
  }));

  /* --- 7. この人のお茶 (Shopify) ------------------------------------------ */

  const teaProducts = (
    await Promise.all(
      (person.relatedProducts ?? []).slice(0, 3).map(async (handle) => {
        try {
          return await getProductByHandle(handle);
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  const teaItems: PersonCardItem[] = teaProducts.map((product) => {
    const p = product!;
    const price = p.priceRange?.minVariantPrice;
    return {
      key: p.handle,
      href: `/products/${p.handle}`,
      image: p.featuredImage?.url ?? undefined,
      imageAlt: p.featuredImage?.altText ?? p.title,
      title: p.title,
      note: p.vendor || undefined,
      meta: price ? formatPrice(price.amount, price.currencyCode) : undefined,
    };
  });

  /* --- 9. ほかの人をたずねる ---------------------------------------------- */

  // 写真を持つ人を先に採る (テンプレのカードは写真前提)。3 件で打ち切る。
  const otherItems: PersonCardItem[] = [...others]
    .sort((a, b) => Number(Boolean(b.image?.asset)) - Number(Boolean(a.image?.asset)))
    .slice(0, 3)
    .map((other) => ({
      key: other._id,
      href: `/people/${other.slug.current}`,
      image: photoUrl(other.image, other._id, 416, 260),
      imageAlt: other.image?.alt ?? other.name,
      title: other.name,
      note: other.role || undefined,
    }));

  return (
    <>
      <PersonHead
        overline={person.kicker || t("kickerDefault")}
        title={person.name}
        role={person.role}
        meta={person.meta}
        image={heroImage}
        imageAlt={person.image?.alt ?? person.name}
        stats={person.stats}
        bylineLabel={person.interviewer ? t("interviewerLabel") : undefined}
        /* この人を覚えておく (Setaka 決定 2026-08-25「人物ページに正式実装」)。
           マイページ /account/favorites の「お気に入りの人」節に出る。
           `targetId` は人の slug — Firestore の他の種類と同じく識別子は slug で、
           locale を混ぜた複合キーにはしない (既存データ互換)。 */
        actions={
          <FavoriteToggleButton
            kind="person"
            targetId={person.slug.current}
            title={person.name}
            imageUrl={favoriteImage}
            labels={{
              add: t("saveAdd"),
              remove: t("saveRemove"),
              saved: t("saveSaved"),
              loading: t("saveLoading"),
              loginRequired: t("saveLoginRequired"),
              statusUnknown: t("saveStatusUnknown"),
              added: t("saveAddedMessage"),
              removed: t("saveRemovedMessage"),
              error: t("saveErrorMessage"),
              loginRequiredMessage: t("saveLoginRequiredMessage"),
              statusRetry: t("saveStatusRetryMessage"),
            }}
          />
        }
        byline={
          person.interviewer ? (
            <AuthorByline
              name={person.interviewer.name}
              role={person.interviewer.role}
              avatarUrl={
                person.interviewer.image?.asset
                  ? urlFor(person.interviewer.image).width(64).height(64).url()
                  : undefined
              }
            />
          ) : undefined
        }
      >
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            /* /people には一覧ページが無いので中間階層を作らない
               (存在しない導線を発明しない)。 */
            { label: person.name },
          ]}
          locale={locale}
        />
      </PersonHead>

      {person.quote ? (
        <PersonQuote quote={person.quote} attribution={person.quoteBy} />
      ) : null}

      {workItems.length > 0 ? (
        <PersonSection>
          <PersonSectionHead overline={t("workKicker")} title={person.workHead} />
          <PersonSectionBody>
            <ProcessGrid items={workItems} />
          </PersonSectionBody>
        </PersonSection>
      ) : null}

      {interviewItems.length > 0 ? (
        <PersonSection>
          <PersonSectionHead
            overline={t("interviewKicker")}
            title={t("interviewHead")}
          />
          {/* テンプレの INTERVIEW だけ見出し → 本体が PC 76 (他の節は 52)。 */}
          <PersonSectionBody className="lg:mt-19">
            <InterviewList items={interviewItems} />
          </PersonSectionBody>
        </PersonSection>
      ) : null}

      {/* テンプレに枠は無いが、既存の紹介文・外部リンクを落とさないため読み物として
          残す (農家詳細が bio を同じ扱いにしているのと揃える)。 */}
      {person.bio || person.website ? (
        <PersonSection>
          <div className="max-w-160">
            {person.bio ? (
              <p className={cn(bodySmClass, "whitespace-pre-line text-foreground")}>
                {person.bio}
              </p>
            ) : null}
            {person.website ? (
              <a
                href={person.website}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  captionClass,
                  "mt-6 inline-block text-muted-foreground underline underline-offset-4",
                  "transition-colors hover:text-foreground"
                )}
              >
                {person.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        </PersonSection>
      ) : null}

      {person.profileBand && person.profileBand.length > 0 ? (
        <PersonDataBand>
          <div className="page-container pt-16 pb-27 lg:pt-24">
            <PersonSectionHead overline={t("profileKicker")} />
            <SpecBand
              className={personBandClass}
              items={person.profileBand.map((row) => ({
                term: row.label,
                value: row.value,
              }))}
            />
          </div>
        </PersonDataBand>
      ) : null}

      {teaItems.length > 0 ? (
        <PersonSection>
          <PersonSectionHead overline={t("teasKicker")} title={person.teasHead} />
          <PersonSectionBody>
            <PersonCardGrid items={teaItems} />
          </PersonSectionBody>
        </PersonSection>
      ) : null}

      {articles.length > 0 ? (
        <PersonSection>
          <PersonSectionHead
            overline={t("storiesKicker")}
            title={t("articlesByAuthor")}
          />
          <PersonSectionBody>
            <CatalogGrid>
              {articles.map((article) => (
                <ArticleCard
                  key={article._id}
                  article={article}
                  memberOnlyLabel={tCommon("memberOnly")}
                  /* この帯は節見出し (`PersonSectionHead` = h2「この人の記事」) を
                     持つので、カード見出しはその下位 = h3。体裁は変わらない
                     (globals.css の article-card-title は h2 / h3 同値)。 */
                  headingLevel="h3"
                />
              ))}
            </CatalogGrid>
          </PersonSectionBody>
        </PersonSection>
      ) : null}

      {otherItems.length > 0 ? (
        <PersonSection>
          <PersonSectionHead overline={t("otherKicker")} title={t("otherHead")} />
          <PersonSectionBody>
            <PersonCardGrid items={otherItems} noteScale="caption" />
          </PersonSectionBody>
        </PersonSection>
      ) : null}
    </>
  );
}

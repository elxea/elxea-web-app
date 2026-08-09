import * as React from "react";

import {
  bodySmClass,
  captionClass,
  h3Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import { ImageCard } from "@/components/ui/image-card";
import { cn } from "@/lib/utils";

/**
 * 著者ページの骨格部品 (C14-1).
 *
 * ## Figma の正本 — R2 確定版は「無い」ので凍結決定から導出する
 * ジャーナル:著者 の専用デザインは **凍結時に廃止されている**:
 * section `7805:1952`「【廃止: People 詳細へ統合】 ジャーナル:著者」
 * (R1 PC `7805:1953` / SP `7809:36662`)。つまり著者ページは自前の画面を
 * 持たず、**People 詳細テンプレに統合する** のが凍結された判断である。
 *
 * その People 詳細テンプレは `Journal / Layouts` の section `7822:37212`
 * 「【採用: 作り手の共通テンプレ】 People 詳細」(PC `7822:37213` /
 * SP `7823:37542`)。R2 確定版はこのテンプレを 2 回適用済みで、
 * どちらも PC/SP の実寸がテンプレと一致する:
 *   - 農家詳細   【R2: 確定版】People 詳細テンプレ統合 (PC `8079:3748` / SP `8079:3966`)
 *   - プレイリスト詳細【R2: 確定版】People 詳細テンプレ整合 (PC `8089:4518` / SP `8089:4622`)
 *     ※ PC 1440x4891 / SP 375x7024 はテンプレ `7822:37213` / `7823:37542` と同寸
 * よって本ファイルは「People 詳細テンプレの 3 度目の適用」であり、
 * 節構成・実測値はテンプレと上記 2 つの確定版を根拠とする。
 *
 * ## テンプレの PersonHead (Figma `7822:37254`) 実測 (PC 1440)
 * - BreadcrumbRow  上余白 48 / 枠高 44 (タップ域)
 * - Photo          x64 640x800 (ポートレート 4:5)、Breadcrumb から 32
 * - HeroText       x736 640、写真上端から **+96** のオフセット
 * - kicker         12/17 ls1.5 (overline)  → name 20
 * - name           32/38 → 実装は主見出し 44px (`.page-title`)
 *                  ※「ページ主見出しは一覧・詳細とも PC 44 / SP 32」の裁定
 *                    (2026-08-08) に追従。journal-list.tsx StackPageHead と同じ。
 * - role           20/27 (h3 プリセット) → name から 28
 * - meta           14/25 (body-sm)      → role から 20
 * - 罫線           1px border 全幅       → meta から 4 (罫線は 1 段階のみ)
 * - Stats          32/35 の実数 + 12/17 のラベル → 罫線から 24
 * - byline 見出し  12/18 → Stats から 36 / byline 本体は見出しから 4
 *
 * ## なぜ farmers / playlist の Head を import しないか
 * `components/farmers/farmer-detail.tsx` が同じ理由を明文化している通り、
 * People 詳細テンプレ派生の各ページは **並列レーンで実測値が動く** ため、
 * 骨格部品は当面ページ側に置き、main 合流後に「People 詳細テンプレ共通骨格」
 * として 1 本に寄せるのが正 (別タスク)。トークン (rule-list) / ImageCard の
 * ような素の共有部品は本ファイルでも再利用する。
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list からの
 * 再輸出)、色は semantic token、寸法は Tailwind spacing scale (= spacing.*
 * トークンと同じ 0.25rem 刻み)。生 px・生カラーは書かない。
 */

/* -------------------------------------------------------------------------- */
/* AuthorSection / AuthorSectionHead — 各節の共通枠                            */
/* -------------------------------------------------------------------------- */

/** 節の共通枠 (Figma テンプレの節上余白 PC 96 / SP 64)。 */
export function AuthorSection({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="author-section"
      className={cn("page-container pt-16 pb-12 lg:pt-24", className)}
      {...props}
    />
  );
}

/**
 * 節見出し。Figma はキッカー h17 (overline) → 8 → 見出し h27 (h3 プリセット)。
 * 体裁は `globals.css` の `h2[data-slot="section-title"]` 規則が当てる
 * (unlayered な `h2 { font: … }` に Tailwind utilities が勝てないため)。
 */
export function AuthorSectionHead({
  overline,
  title,
  className,
}: {
  overline: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="author-section-head" className={className}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
      {title ? (
        <h2 data-slot="section-title" className="mt-2 text-foreground">
          {title}
        </h2>
      ) : null}
    </div>
  );
}

/** 見出しの下に置く本体ブロックの共通マージン (Figma PC 52 / SP 56)。 */
export function AuthorSectionBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="author-section-body"
      className={cn("mt-14 lg:mt-13", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* AuthorHead — ポートレート + 氏名 + 肩書 + 実数 (Figma テンプレ 7822:37254)   */
/* -------------------------------------------------------------------------- */

export type AuthorStat = { value: React.ReactNode; label: React.ReactNode };

export type AuthorHeadProps = {
  /** 英字キッカー (例 AUTHOR — JOURNAL)。 */
  overline: React.ReactNode;
  /** 氏名 (ページ主見出し)。 */
  title: string;
  /** 肩書 1 行 (Figma role / jp/h3)。 */
  role?: React.ReactNode;
  /** 紹介文 (Figma meta / jp/body-sm)。 */
  meta?: React.ReactNode;
  image?: string;
  imageAlt?: string;
  /** 実数表示 (ARTICLES / SINCE)。空配列なら罫線ごと出さない。 */
  stats?: readonly AuthorStat[];
  /** 外部リンク等の見出し (例「リンク」)。 */
  bylineLabel?: React.ReactNode;
  /** 外部リンク本体を差し込む。 */
  byline?: React.ReactNode;
  /** パンくず。 */
  children?: React.ReactNode;
};

export function AuthorHead({
  overline,
  title,
  role,
  meta,
  image,
  imageAlt,
  stats,
  bylineLabel,
  byline,
  children,
}: AuthorHeadProps) {
  return (
    <section
      data-slot="author-head"
      className="page-container pt-6 pb-10 lg:pt-12 lg:pb-8"
    >
      {/* Breadcrumb は自前で mb-8 を持つ。行高は Figma の 44 (タップ域) が正なので
          ここで打ち消す (農家詳細 / プレイリスト詳細と同じ扱い)。 */}
      {children ? (
        <div className="flex min-h-11 items-center [&_nav]:mb-0">{children}</div>
      ) : null}

      <div className="mt-6 lg:mt-8 lg:grid lg:grid-cols-2 lg:gap-x-8">
        {/* SP はポートレートも全幅 (テンプレ SP 7823:37542 = x0 w375 h469 = 4:5)。
            PC はテンプレ 7822:37262 の 640x800 に戻す。`.sp-full-bleed` は
            C4-2R で入った共通ユーティリティ (負マージンを --page-margin に取る)。 */}
        <ImageCard
          className="sp-full-bleed rounded-none lg:col-start-1 lg:rounded-md"
          aspectRatio="4/5"
          image={image}
          alt={imageAlt ?? title}
          width={640}
          height={800}
          sizes="(max-width: 1024px) 100vw, 640px"
          priority
        />

        {/* Figma の HeroText は PC で写真上端から +96 下げた位置に始まる。 */}
        <div
          data-slot="author-head-text"
          className="mt-8 lg:col-start-2 lg:mt-24"
        >
          <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
          <h1 className="page-title mt-4 text-foreground lg:mt-5">{title}</h1>
          {role ? (
            <p
              data-slot="author-head-role"
              className={cn(h3Class, "mt-5 text-foreground lg:mt-7")}
            >
              {role}
            </p>
          ) : null}
          {meta ? (
            <p className={cn(bodySmClass, "mt-3 text-muted-foreground lg:mt-5")}>
              {meta}
            </p>
          ) : null}

          {stats && stats.length > 0 ? (
            <dl
              data-slot="author-stats"
              className="mt-4 flex gap-x-8 border-t border-border pt-6 lg:mt-7 lg:gap-x-12"
            >
              {stats.map((stat, i) => (
                <div key={i} className="flex items-baseline gap-3">
                  {/* Figma は en/h1 (32px / Light)。h1 トークンが同値。 */}
                  <dd className="m-0 [font:var(--typography-style-h1)] text-foreground">
                    {stat.value}
                  </dd>
                  <dt className={cn(overlineClass, "text-muted-foreground")}>
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}

          {byline ? (
            <div className="mt-7 lg:mt-9">
              {bylineLabel ? (
                <p className={cn(captionClass, "text-muted-foreground")}>
                  {bylineLabel}
                </p>
              ) : null}
              <div className="mt-2 lg:mt-1">{byline}</div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import * as React from "react";

import { Link } from "@/i18n/navigation";
import {
  bodySmClass,
  captionClass,
  h3Class,
  h4Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import { ImageCard } from "@/components/media/image-card";
import { cn } from "@/lib/utils";

/**
 * 農家詳細の骨格部品 (C4-4a).
 *
 * Figma が正本 — 農家詳細【R2: 確定版】People 詳細テンプレ統合 (茶園セクション拡張)
 * PC `8079:3748` / SP `8079:3966`。確定版の 9 ブロック構成をそのまま節にする:
 *   1. PersonHead     写真 + 見出し + 肩書 + メタ + 実数 + 聞き手クレジット
 *   2. Quote          反転面・本人の一言
 *   3. THE WORK       手仕事の工程 (写真 + 番号 + 工程名 + 説明)
 *   4. INTERVIEW      一問一答 (本文幅 640 / サイドバー無し)
 *   5. PROFILE        4 カラムのデータ帯 (muted 面)
 *   6. THE FIELD      茶園データ帯 (muted 面)
 *   7. THE FIELD      茶園の一年 (写真 + 番号 + 季節名 + 説明)
 *   8. TEAS           このひとが育てたお茶 (購入導線は最下部・価格のみ)
 *   9. OTHER PEOPLE   ほかの人をたずねる
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 と同じ)。
 *
 * ## なぜ components/playlist/playlist-detail.tsx を import しないか
 * プレイリスト詳細も同じ People 詳細テンプレ派生で、節枠・写真グリッドは形が近い。
 * それでも共用しないのは 2 点の理由による:
 *  1. C4-4a と C4-2R (プレイリスト SP 写真) が並列レーンで走っており、
 *     playlist 側の SP 写真の扱いが変わると農家側の実測値まで巻き添えで動く。
 *  2. 農家確定版の SP は写真ブロック間の余白が 88 / 56 とプレイリスト実装
 *     (40) と異なり、そのまま共用すると Figma から外れる。
 * 両レーンが main に入った後に「People 詳細テンプレ共通骨格」として 1 本に
 * 寄せるのが正で、それは別タスクで行う。トークン (rule-list) / ImageCard /
 * SpecBand のような素の共有部品は本ファイルでも再利用している。
 *
 * Figma 実測 (px) → 実装の対応:
 * - セクション上余白        PC 96 / SP 64            → `pt-16 lg:pt-24`
 * - キッカー → 見出し       PC 8  / SP 8             → `mt-2`
 * - 見出し → 本体           PC 52 / SP 56            → `mt-14 lg:mt-13`
 * - 3 カラム                PC 416 gap32 / SP 縦積み  → `lg:grid-cols-3 lg:gap-x-8`
 * - 本文カラム              PC 640 / SP 343          → `max-w-160`
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list からの再輸出)、
 * 色は semantic token、寸法は Tailwind spacing scale (= spacing.* トークンと同じ
 * 0.25rem 刻み)。生 px・生カラーは書かない。
 */

/* -------------------------------------------------------------------------- */
/* FarmerSection — 各節の共通枠                                                */
/* -------------------------------------------------------------------------- */

export function FarmerSection({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="farmer-section"
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
export function FarmerSectionHead({
  overline,
  title,
  className,
}: {
  overline: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="farmer-section-head" className={className}>
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
export function FarmerSectionBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="farmer-section-body"
      className={cn("mt-14 lg:mt-13", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* FarmerHead — 写真 + 見出し (Figma 8079:3750 / 8079:3970)                     */
/* -------------------------------------------------------------------------- */

export type FarmerStat = { value: React.ReactNode; label: React.ReactNode };

export type FarmerHeadProps = {
  /** 英字キッカー (例 PEOPLE 04 — ROASTER, HONYAMA)。 */
  overline: React.ReactNode;
  /** 氏名 (ページ主見出し)。 */
  title: string;
  /** 肩書 1 行 (Figma role / jp/h3)。 */
  role?: React.ReactNode;
  /** 産地・年数などのメタ 1 行 (Figma meta / jp/body-sm)。 */
  meta?: React.ReactNode;
  image?: string;
  imageAlt?: string;
  /** 実数表示 (YEARS / STORIES)。空配列なら罫線ごと出さない。 */
  stats?: readonly FarmerStat[];
  /** クレジットの見出し (例「聞き手」)。 */
  bylineLabel?: React.ReactNode;
  /** AuthorByline を差し込む。 */
  byline?: React.ReactNode;
  /** パンくず。 */
  children?: React.ReactNode;
};

/**
 * Figma 実測 (PC 1440 / SP 375) → 実装:
 * - BreadcrumbRow   上余白 PC 48 / SP 24、枠高 44 (タップ域)
 * - Photo           PC x64 640x800 (4:5) / SP 全幅 469 (4:5)。Breadcrumb から PC 32 / SP 24
 * - HeroText        PC x736 640、写真上端から +96 のオフセット / SP は写真下に 32 で積む
 * - kicker → name   PC 20 / SP 16
 * - name → role     PC 28 / SP 20
 * - role → meta     PC 20 / SP 12
 * - meta → 罫線     PC 29 / SP 16   (`mt-7 lg:mt-4` 相当、PC は 28 に丸め)
 * - 罫線 → Stats    PC 24 / SP 25   (`pt-6`)
 * - Stats → byline見出し PC 36 / SP 28
 * - byline見出し → byline PC 5 / SP 8
 *
 * 主見出しは 44px display (`.page-title`)。Figma の農家詳細フレームは 32px だが、
 * ページ主見出しは 44px に揃える全体裁定 (C4-2 / C4-3 と同じ) に従う。
 */
export function FarmerHead({
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
}: FarmerHeadProps) {
  return (
    <section
      data-slot="farmer-head"
      className="page-container pt-6 pb-10 lg:pt-12 lg:pb-8"
    >
      {/* Breadcrumb は自前で mb-8 を持つ。行高は Figma の 44 (タップ域) が正なので
          ここで打ち消す。 */}
      {children ? (
        <div className="flex min-h-11 items-center [&_nav]:mb-0">{children}</div>
      ) : null}

      <div className="mt-6 lg:mt-8 lg:grid lg:grid-cols-2 lg:gap-x-8">
        {/* SP は写真も全幅 (Figma 8079:3973 = x0 w375 h469 = 4:5)。PC 8079:3753
            では本文カラム内 640x800 なので lg で戻す。`.sp-full-bleed` は
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
          data-slot="farmer-head-text"
          className="mt-8 lg:col-start-2 lg:mt-24"
        >
          <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
          <h1 className="page-title mt-4 text-foreground lg:mt-5">{title}</h1>
          {role ? (
            <p
              data-slot="farmer-head-role"
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
              data-slot="farmer-stats"
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

/* -------------------------------------------------------------------------- */
/* FarmerQuote — 反転面の引用 (Figma 8079:3771 / 8079:3990)                     */
/* -------------------------------------------------------------------------- */

/**
 * Figma 実測: 全幅の反転面 (primary / primary-foreground)。引用は 640 幅で
 * 中央寄せの列に置くが、行そのものは左揃え。上余白 PC 88 / SP 64、
 * 引用 → 帰属 PC 54 / SP 32、下余白 PC 66 / SP 66。
 */
export function FarmerQuote({
  quote,
  attribution,
  className,
}: {
  quote: React.ReactNode;
  attribution?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="farmer-quote"
      className={cn("bg-primary text-primary-foreground", className)}
    >
      <div className="page-container pt-16 pb-16 lg:pt-22">
        <blockquote className={cn(h3Class, "mx-auto max-w-160")}>
          {quote}
        </blockquote>
        {attribution ? (
          <p
            className={cn(
              captionClass,
              "mx-auto mt-8 max-w-160 opacity-70 lg:mt-13"
            )}
          >
            {attribution}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ProcessGrid — 番号つき工程の 3 カラム (THE WORK / 茶園の一年)                 */
/* -------------------------------------------------------------------------- */

export type ProcessItem = {
  key: string;
  image?: string;
  imageAlt?: string;
  /** 通し番号 (「01」)。 */
  no: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
};

/**
 * Figma 実測:
 * - PC 3 列 416 / gap-x 32、写真 416x312 (4:3)
 * - SP 縦積み、写真 375x250 (3:2)、ブロック間 88
 * - 写真 → 番号 16、番号 → 工程名 8、工程名 → 説明 4
 *   (「近接比: 工程内 16px : 工程ブロック間 96px」の注記どおり、罫線は 0 本で
 *    グルーピングは余白のみ)
 * - SP の写真は Figma どおり全幅 375 (ページ余白外)。C4-2R で入った
 *   `.sp-full-bleed` でページ余白を打ち消して再現する。
 */
export function ProcessGrid({
  items,
  className,
}: {
  items: readonly ProcessItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ol
      data-slot="process-grid"
      className={cn(
        "grid grid-cols-1 gap-x-8 gap-y-22 lg:grid-cols-3 lg:gap-y-0",
        className
      )}
    >
      {items.map((item) => (
        <li data-slot="process-item" key={item.key}>
          <ImageCard
            className="sp-full-bleed rounded-none [--fc-ar:3/2] lg:rounded-md lg:[--fc-ar:4/3]"
            style={{ aspectRatio: "var(--fc-ar)" }}
            image={item.image}
            alt={item.imageAlt ?? ""}
            width={416}
            height={312}
            sizes="(max-width: 1024px) 100vw, 416px"
          />
          <p className={cn(overlineClass, "mt-4 text-muted-foreground")}>
            {item.no}
          </p>
          <p className={cn(h4Class, "mt-2 text-foreground")}>{item.name}</p>
          {item.description ? (
            <p className={cn(bodySmClass, "mt-2 text-foreground lg:mt-1")}>
              {item.description}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* InterviewList — 一問一答 (Figma 8079:3793 / 8079:4011)                       */
/* -------------------------------------------------------------------------- */

export type InterviewItem = {
  /** 通し番号ラベル (「Q 01」)。 */
  no: React.ReactNode;
  question: React.ReactNode;
  answer: React.ReactNode;
};

/**
 * Figma 実測: 本文幅 PC 640 / SP 343 (サイドバー無し)。
 * 番号 h17 (overline) → 5 → 問い h24 (h4) → 20 → 答え (body-sm)。
 * 設問間 (答えの下端 → 次の番号) は Figma 上で PC 44〜48 / SP 36〜44 と
 * 揺れているので、上限側に寄せて PC 48 / SP 40 に固定する。罫線は引かない。
 * 「問いの前 : 後 = 2.8倍」の非対称余白で問いと答えを切り分ける
 * (Figma DEVIATION 注記 P6)。
 */
export function InterviewList({
  items,
  className,
}: {
  items: readonly InterviewItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ol
      data-slot="interview-list"
      className={cn("flex max-w-160 flex-col gap-10 lg:gap-12", className)}
    >
      {items.map((item, i) => (
        <li data-slot="interview-row" key={i}>
          <p className={cn(overlineClass, "text-muted-foreground")}>{item.no}</p>
          <p className={cn(h4Class, "mt-1 text-foreground")}>{item.question}</p>
          <p className={cn(bodySmClass, "mt-5 text-foreground")}>{item.answer}</p>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* FarmerDataBand — muted 面のデータ帯 (PROFILE / THE FIELD)                    */
/* -------------------------------------------------------------------------- */

/**
 * Figma 実測: 全幅の muted 面。キッカー → 行 PC 27 / SP 24、
 * 上余白 PC 96 / SP 64、下余白 110 (PC / SP 共通)。
 * 4 カラム定義帯そのものは共有部品 `SpecBand` を使い、罫線を消して
 * (確定版の帯は罫線を持たない) 余白だけ差し替える。
 */
export function FarmerDataBand({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="farmer-data-band"
      className={cn("bg-muted", className)}
      {...props}
    />
  );
}

/** `SpecBand` に渡して確定版の帯 (罫線なし・キッカー直下 27/24) に合わせる。 */
export const farmerBandClass = "border-t-0 gap-y-6 pt-6 lg:pt-7";

/* -------------------------------------------------------------------------- */
/* FarmerCardGrid — 写真つき 3 カラム (TEAS / OTHER PEOPLE)                     */
/* -------------------------------------------------------------------------- */

export type FarmerCardItem = {
  key: string;
  image?: string;
  imageAlt?: string;
  /** リンクにするとき。無ければ非リンク。 */
  href?: string;
  title: React.ReactNode;
  /** 産地メモ / 肩書。 */
  note?: React.ReactNode;
  /** 価格などの補助行。 */
  meta?: React.ReactNode;
};

/**
 * Figma 実測:
 * - PC 3 列 416 / gap-x 32、写真 416x260 (8:5)
 * - SP 縦積み、写真 375x234 (8:5)、ブロック間 56
 * - 写真 → 見出し 16、見出し → note 4、note → meta 2 (→ `mt-1` に丸め)
 * - SP の写真は Figma どおり全幅 375 (`.sp-full-bleed`)。
 */
export function FarmerCardGrid({
  items,
  noteScale = "body-sm",
  className,
}: {
  items: readonly FarmerCardItem[];
  /**
   * note 行のスケール。TEAS は body-sm (14px) / OTHER PEOPLE の肩書は
   * caption (12px) と Figma で異なる。
   */
  noteScale?: "body-sm" | "caption";
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      data-slot="farmer-card-grid"
      className={cn(
        "grid grid-cols-1 gap-x-8 gap-y-14 lg:grid-cols-3 lg:gap-y-0",
        className
      )}
    >
      {items.map((item) => {
        const photo = (
          <ImageCard
            className="sp-full-bleed rounded-none lg:rounded-md"
            aspectRatio="8/5"
            image={item.image}
            alt={item.imageAlt ?? ""}
            width={416}
            height={260}
            sizes="(max-width: 1024px) 100vw, 416px"
            hover={Boolean(item.href)}
          />
        );

        const body = (
          <>
            <p className={cn(h4Class, "mt-4 text-foreground")}>{item.title}</p>
            {item.note ? (
              <p
                className={cn(
                  noteScale === "caption" ? captionClass : bodySmClass,
                  "mt-1 text-muted-foreground"
                )}
              >
                {item.note}
              </p>
            ) : null}
            {item.meta ? (
              <p className={cn(bodySmClass, "mt-1 text-foreground")}>
                {item.meta}
              </p>
            ) : null}
          </>
        );

        return (
          <li data-slot="farmer-card" key={item.key} className="group">
            {item.href ? (
              <Link href={item.href} className="block">
                {photo}
                <div className="underline-offset-4 group-hover:underline">
                  {body}
                </div>
              </Link>
            ) : (
              <>
                {photo}
                {body}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

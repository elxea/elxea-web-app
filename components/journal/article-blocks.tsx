import * as React from "react";
import Image from "next/image";

import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { ImageCard } from "@/components/media/image-card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 記事本文テンプレの共通骨格 (C4-4b 基盤).
 *
 * Figma が正本 — elxea Journal 詳細【R2: 確定版】本文完結 + 末尾のみ回遊
 * (PC 8110:46893 / SP 8110:47043)。同じ骨格 (2px の追従バー / 中央 640 の本文
 * カラム / 24 一定の縦リズム / 裁ち落とし写真 / 節ラベル + 行 / 末尾の pill 回遊)
 * を `journal` 系の記事ページが共有するため、ページ側ではなくここに置いて共有
 * する (`components/editorial/section-blocks.tsx` と同じ位置づけ)。
 *
 * Figma 実測 (px) → 実装の対応:
 * - 本文カラム        PC 640 中央 (x400 / 1440)      → `mx-auto max-w-160`
 * - ページ上下余白    上 PC 96 / SP 64、下 PC 160 / SP 64
 *                                                    → `pt-16 lg:pt-24` / `pb-16 lg:pb-40`
 * - 縦リズム          24 一定 (カラムの auto-layout gap) → `mt-6`
 * - Head 内 gap       PC 16 / SP 12                   → `mt-3 lg:mt-4`
 * - 節見出し (本文 H2) 前 56 + リズム 24 = 80 / 後 20 + 24 = 44
 *                                                    → `mt-20` / 直後要素 `mt-11`
 * - 裁ち落とし写真    PC 720 (= 640 + 40 x2) / SP 全幅 375
 *                                                    → `.sp-full-bleed lg:-mx-10`
 *                     アスペクト SP 3/2 (375x250) / PC 5/3 (720x432)
 * - 写真キャプション  写真枠の左下・余白 PC 16 / SP 12 → `p-3 lg:p-4`
 * - 節ラベル          jp/overline 12 / tracking .125em → `overlineClass`
 * - 節ラベル→本体     16 (お茶) / 8 (読みもの)        → `gap="md"` / `gap="sm"`
 * - product row       thumb PC 160 / SP 96、gap PC 24 / SP 16、info 内 gap 8、
 *                     リンクのタップ域 49 (py 12)
 * - read row          thumb 56 + gap 16 + py 8 (行 72)、行間 8
 * - NextRead pill     h48 / px16 / py8 / 全角丸 / primary 面、行 gap 8 中央寄せ
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list から再輸出
 * された CSS 変数)。色は semantic token。寸法は Tailwind spacing scale
 * (= spacing.* トークンと同じ 0.25rem 刻み)。生 px・生カラーは書かない。
 *
 * 既知の未移行 (意図的・別タスク): 兄弟ページ `app/[locale]/journal/[slug]/page.tsx`
 * (ジャーナル記事詳細 / Figma 8074:44849) は同型のマークアップをページ内に
 * インラインで持つ。値は近いが確定版どうしで差がある (節ラベルが caption /
 * pill が枠線版 / 写真に角丸あり / 読みもの行が連続) ため、そちらの移行は
 * 承認済み忠実度表 (docs/fidelity/c4-2r-fidelity.md) の再検証を伴う別タスクで行う。
 */

/* -------------------------------------------------------------------------- */
/* ArticleColumn — 中央 640 の本文カラム (Figma 8110:46898 / SP 8110:47049)     */
/* -------------------------------------------------------------------------- */

export function ArticleColumn({
  className,
  ...props
}: React.ComponentProps<"article">) {
  return (
    <article
      data-slot="article-column"
      className={cn("mx-auto w-full max-w-160", className)}
      {...props}
    />
  );
}

/** ページ上下余白 (Figma 上 PC 96 / SP 64、下 PC 160 / SP 64)。 */
export const articlePagePadding = "pt-16 pb-16 lg:pt-24 lg:pb-40";

/* -------------------------------------------------------------------------- */
/* ArticleHead — キッカー + 主見出し + クレジット (Figma 8110:46900 / 47050)    */
/* -------------------------------------------------------------------------- */

export type ArticleHeadProps = {
  /** 英字キッカー (`ELXEA JOURNAL` など)。 */
  overline: React.ReactNode;
  title: React.ReactNode;
  /** 著者クレジットなど、見出しの下に置く 1 行。無い記事もある。 */
  children?: React.ReactNode;
  className?: string;
};

export function ArticleHead({
  overline,
  title,
  children,
  className,
}: ArticleHeadProps) {
  return (
    <header data-slot="article-head" className={className}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
      {/* ページ主見出しは一覧・詳細で統一 (Setaka 裁定 2026-08-08):
          44px display トークン = `.page-title`。Figma 記事詳細の functional
          52px 束縛は Figma 側を追従修正中のため、実装は DS 最大の display
          (44px / lh 1.2) を正とする。SP は base h1 32px のまま。 */}
      <h1 className="page-title mt-3 text-foreground lg:mt-4">{title}</h1>
      {children ? <div className="mt-3 lg:mt-4">{children}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleLead — 明朝のリード文 (Figma 8110:46904 / 8110:47054)                 */
/* -------------------------------------------------------------------------- */

export function ArticleLead({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="article-lead"
      className={cn("text-foreground", className)}
      /* font ショートハンドを先に、family を後に当てるため style で順序を固定
         する (どちらもトークン参照。明朝 = typography.family.special)。 */
      style={{
        font: "var(--typography-style-body-lg)",
        letterSpacing: "var(--typography-style-body-lg-tracking)",
        fontFamily: "var(--typography-family-special)",
      }}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleImageBleed — 本文から左右にはみ出す写真 (Figma 8110:46906 / 47056)    */
/* PC 720 (= 640 + 40 x2) / SP 全幅 375。キャプションは写真枠の左下。            */
/* -------------------------------------------------------------------------- */

export type ArticleImageBleedProps = {
  src?: string;
  alt: string;
  /** 写真のクレジット・撮影メモ (`PHOTO — 朝霧の斜面 5:40`)。無い写真もある。 */
  caption?: React.ReactNode;
  priority?: boolean;
  className?: string;
};

export function ArticleImageBleed({
  src,
  alt,
  caption,
  priority,
  className,
}: ArticleImageBleedProps) {
  return (
    <figure
      data-slot="article-image-bleed"
      className={cn("sp-full-bleed relative lg:-mx-10", className)}
    >
      <ImageCard
        /* Figma の photo 枠は角丸なし。アスペクトは SP 3/2 → PC 5/3。 */
        className="rounded-none [--bleed-ar:3/2] lg:[--bleed-ar:5/3]"
        style={{ aspectRatio: "var(--bleed-ar)" }}
      >
        {src ? (
          <Image
            src={src}
            alt={alt}
            width={1440}
            height={864}
            sizes="(max-width: 1024px) 100vw, 720px"
            className="h-full w-full object-cover"
            priority={priority}
          />
        ) : null}
      </ImageCard>
      {caption ? (
        <figcaption
          className={cn(
            captionClass,
            "absolute inset-x-0 bottom-0 p-3 text-muted-foreground lg:p-4"
          )}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleProse — 本文の縦リズム (Figma 8110:46909 ほか)                        */
/* -------------------------------------------------------------------------- */

/**
 * PortableText 本文のマージンを Figma の縦リズムに合わせる枠。
 *
 * - 段落間 24 …… 下マージンを 0 に倒し、間隔は隣接セレクタの上マージンだけで
 *   作る (マージン相殺の影響を受けないようにするため)。
 * - 節見出し前 80 (前 56 + リズム 24) / 後 44 (後 20 + リズム 24) …… 見出し側の
 *   mb ではなく直後要素の mt で作る。`h2 + *` は型セレクタを含み `> * + *` より
 *   詳細度が高いので、隣接段落の mt-6 を確実に上書きする。
 * - 段落の文字組みは jp/body (16 / lh 1.75)。共有シリアライザ
 *   (`components/sanity/portable-text.tsx`) は body-sm 相当を当てるので、
 *   この枠の中だけトークン経由で body に戻す。
 * - 節見出しの体裁は PC / SP でプリセットが 1 段変わる
 *   (PC 8110:46910 = jp/h1 32 / lh 1.2 / 300、SP 8110:47060 = jp/h2 24 / lh 1.3 / 400)。
 *   `globals.css` の `[data-slot="article-prose"] h2` 規則で PC 側だけ h1 に
 *   上書きし、SP は base の h2 プリセットをそのまま使う。unlayered な
 *   `h2 { font: … }` が Tailwind utilities に勝つため、utility 側からは
 *   指定できない (catalog-card-title / page-title と同じ理由)。
 */
export function ArticleProse({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="article-prose"
      className={cn(
        "[&>*]:mb-0! [&>*+*]:mt-6!",
        "[&_h2]:mt-20! [&_h2]:mb-0! [&_h3]:mt-20! [&_h3]:mb-0!",
        "[&_h2+*]:mt-11! [&_h3+*]:mt-11!",
        "[&_p]:[font:var(--typography-style-body)]",
        "[&_p]:[letter-spacing:var(--typography-style-body-tracking)]",
        "[&_p]:text-foreground",
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleBlock — 節ラベル + 本体 (Figma 8110:46925 / 8110:46934)               */
/* -------------------------------------------------------------------------- */

/** ラベル→本体の余白。md = 16 (お茶の節) / sm = 8 (読みものの節)。 */
export type ArticleBlockGap = "sm" | "md";

export type ArticleBlockProps = {
  label: React.ReactNode;
  gap?: ArticleBlockGap;
  children: React.ReactNode;
  className?: string;
};

export function ArticleBlock({
  label,
  gap = "md",
  children,
  className,
}: ArticleBlockProps) {
  return (
    <section data-slot="article-block" className={className}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{label}</p>
      <div className={gap === "sm" ? "mt-2" : "mt-4"}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleProductRow — 同梱品の行 (Figma 8110:46927 / SP 8110:47074)            */
/* thumb PC 160 / SP 96 + info (名称 / メタ / 詳細リンク)。                     */
/* -------------------------------------------------------------------------- */

export type ArticleProductRowProps = {
  image?: string;
  imageAlt?: string;
  title: React.ReactNode;
  /** 産地・同梱文脈などの補足。無い品もある。 */
  meta?: React.ReactNode;
  href?: string;
  linkLabel?: React.ReactNode;
};

export function ArticleProductRow({
  image,
  imageAlt,
  title,
  meta,
  href,
  linkLabel,
}: ArticleProductRowProps) {
  return (
    <li
      data-slot="article-product-row"
      className="flex items-center gap-4 lg:gap-6"
    >
      <div className="size-24 shrink-0 lg:size-40">
        <ImageCard
          image={image}
          alt={imageAlt ?? ""}
          className="rounded-none"
          style={{ aspectRatio: "1/1" }}
          width={320}
          height={320}
          sizes="(max-width: 1024px) 96px, 160px"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(bodySmClass, "text-foreground")}>{title}</p>
        {/* Figma の SP (8110:47076) は info を「名称 → 詳細リンク」の 2 段だけに
            しており、産地などのメタ行を持たない (幅 231 に収めるため)。PC のみ出す。 */}
        {meta ? (
          <p className={cn(overlineClass, "mt-2 hidden text-muted-foreground lg:block")}>
            {meta}
          </p>
        ) : null}
        {href && linkLabel ? (
          <Link
            href={href}
            /* inline-flex にするとベースライン揃えの分だけ上に余白が乗り、
               Figma の「メタ→リンク 8」がずれるのでブロックレベルの flex にする
               (幅は Figma と同じ hug = `w-fit`)。 */
            className={cn(
              bodySmClass,
              "mt-2 flex w-fit py-3 text-foreground underline-offset-4 hover:underline"
            )}
          >
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleReadRow — 末尾の読みもの行 (Figma 8110:46936 / SP 8110:47082)         */
/* thumb 56 + gap 16 + py 8 → 行 72 (タップ域 72)。                             */
/* -------------------------------------------------------------------------- */

export type ArticleReadRowProps = {
  href: string;
  image?: string;
  imageAlt?: string;
  title: React.ReactNode;
};

export function ArticleReadRow({
  href,
  image,
  imageAlt,
  title,
}: ArticleReadRowProps) {
  return (
    <li data-slot="article-read-row">
      <Link href={href} className="flex items-center gap-4 py-2">
        <div className="size-14 shrink-0">
          <ImageCard
            image={image}
            alt={imageAlt ?? ""}
            className="rounded-none"
            style={{ aspectRatio: "1/1" }}
            width={112}
            height={112}
            sizes="56px"
          />
        </div>
        <span
          className={cn(
            bodySmClass,
            "min-w-0 flex-1 text-foreground underline-offset-4 hover:underline"
          )}
        >
          {title}
        </span>
      </Link>
    </li>
  );
}

/** 読みもの行のリスト。行間 8 (Figma の related row 間 gap)。 */
export function ArticleReadList({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="article-read-list"
      className={cn("space-y-2", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleNextRead — 末尾のテーマ回遊 pill (Figma 8110:46945 / SP 8110:47091)   */
/* 行き止まりを作らないための導線。primary 面の全角丸・h48。                     */
/* -------------------------------------------------------------------------- */

export function ArticleNextRead({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="article-next-read"
      className={cn("flex flex-wrap items-center justify-center gap-2", className)}
      {...props}
    />
  );
}

export function ArticlePill({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-slot="article-pill"
      className={cn(
        bodySmClass,
        /* Figma は h48 の枠に py8 で上寄せ (items-start)。中央寄せにすると
           文字の上端が Figma より 3.5px 下がるので上寄せのまま合わせる。 */
        "flex h-12 items-start rounded-full bg-primary px-4 py-2 text-primary-foreground",
        "transition-opacity hover:opacity-90",
        className
      )}
    >
      {children}
    </Link>
  );
}

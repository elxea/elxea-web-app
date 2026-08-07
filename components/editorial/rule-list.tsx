import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Editorial rule-list primitives (C2 基盤).
 *
 * Figma が正本 — Common / Layouts の FAQ 確定レイアウト (section 7848:450)。
 * 罫線 1 本で区切る「読み物」系の行部品をまとめる。FAQ 以外の静的ページ
 * (配送情報 / 返品ポリシー / 特商法 / 汎用ページ) も同じ行型を使うため、
 * ページ側ではなくここに置いて共有する。
 *
 * 値の出どころ:
 * - 文字組みは `typography.style.*` トークンの font shorthand
 *   (`--typography-style-*` / `--typography-style-*-tracking`) のみを使う。
 *   Figma の `elxea/typography/editorial/*` と size / weight / lineHeight /
 *   letterSpacing が一致するため、新規トークンは足していない。
 *   既知の差分: overline の lineHeight が Figma 1.4 / トークン 1.5 (12px 換算で
 *   1.2px)。共有トークンを 1 ページ都合で動かさないため踏襲する。
 * - 色は semantic token (foreground / muted-foreground / border / primary)。
 * - 寸法は Tailwind spacing scale (= spacing.* トークンと同じ 0.25rem 刻み)。
 *   生 px・生カラーはこのファイルに書かない。
 */

/** `typography.style.overline` — 12px / 600 / tracking .125em。英字キッカー用。 */
const OVERLINE =
  "[font:var(--typography-style-overline)] [letter-spacing:var(--typography-style-overline-tracking)]";
/** `typography.style.caption` — 12px / 400 / tracking .05em。*/
const CAPTION =
  "[font:var(--typography-style-caption)] [letter-spacing:var(--typography-style-caption-tracking)]";
/** `typography.style.body-sm` — 14px / 400 / tracking .05em。本文・補足。 */
const BODY_SM =
  "[font:var(--typography-style-body-sm)] [letter-spacing:var(--typography-style-body-sm-tracking)]";
/** `typography.style.h4` — 16px / 500 / tracking .02em。行の主見出し。 */
const H4 =
  "[font:var(--typography-style-h4)] [letter-spacing:var(--typography-style-h4-tracking)]";

export { OVERLINE as overlineClass, BODY_SM as bodySmClass };

/* -------------------------------------------------------------------------- */
/* Overline — 英字キッカー (Figma 7848:39289 ほか)                              */
/* -------------------------------------------------------------------------- */

export function Overline({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="overline"
      className={cn(OVERLINE, "text-muted-foreground", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* MetaRow — label / value の 2 列 (Figma 7848:39293 "row / 答え")              */
/* PC: label 幅 140px・行高 44 / SP: label 幅 120px・行高 52 (値が折り返す)      */
/* -------------------------------------------------------------------------- */

export type MetaRowProps = {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function MetaRow({ label, children, className }: MetaRowProps) {
  return (
    <div
      data-slot="meta-row"
      className={cn("flex gap-4 border-t border-border pt-3 pb-4", className)}
    >
      {/* dl の直下は dt/dd (または両者を包む div) でなければならないため、
          ラッパは div のまま中身を dt/dd にする。dd の既定 margin は打ち消す。 */}
      <dt className={cn(CAPTION, "w-30 shrink-0 text-muted-foreground md:w-35")}>{label}</dt>
      <dd className={cn(BODY_SM, "m-0 min-w-0 flex-1 text-foreground")}>{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CategoryIndex — 罫線だけの目次 (Figma 7848:530 / SP 7851:39430)             */
/* PC: 4 列を上下の罫線で挟む / SP: 縦 1 列で各項目の上に罫線                    */
/* -------------------------------------------------------------------------- */

export type CategoryIndexItem = { label: string; href: string };

/**
 * roomy = FAQ 7848:530 (帯の高さ 128 / SP 行 64)
 * compact = 配送情報 7848:39261 (帯の高さ 96 / SP 行 56)
 */
export type CategoryIndexDensity = "roomy" | "compact";

const INDEX_PADDING: Record<CategoryIndexDensity, { pc: string; sp: string }> = {
  roomy: { pc: "md:pt-12 md:pb-14", sp: "pt-8 pb-3" },
  compact: { pc: "md:py-9", sp: "pt-4 pb-4" },
};

export function CategoryIndex({
  items,
  density = "roomy",
  className,
  ...props
}: {
  items: CategoryIndexItem[];
  density?: CategoryIndexDensity;
} & React.ComponentProps<"nav">) {
  const padding = INDEX_PADDING[density];
  return (
    <nav
      data-slot="category-index"
      data-density={density}
      className={cn("border-b border-border md:border-t", className)}
      {...props}
    >
      <ul className={cn("md:grid md:grid-cols-4 md:gap-8", padding.pc)}>
        {items.map((item) => (
          <li key={item.href} className="border-t border-border md:border-t-0">
            <Link
              href={item.href}
              className={cn(
                BODY_SM,
                "block text-foreground hover:text-muted-foreground md:py-0",
                padding.sp
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* DisclosureRow — 閉じたまま「答えの要点」1 行が読める開閉行                    */
/* Figma 7848:39430 (open) / 7848:39435 (closed)                               */
/* JS を持たない native <details> で組む (SSR で開閉が壊れない・a11y 標準準拠)。 */
/* -------------------------------------------------------------------------- */

export type DisclosureRowProps = {
  /** 質問。閉じていても読める。 */
  question: React.ReactNode;
  /** 答えの要点。Figma の要件どおり閉じたままでも読める位置に出す。 */
  summary: React.ReactNode;
  /** 本文。無い行は開閉マークを出さない (開いても増える情報が無いため)。 */
  children?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DisclosureRow({
  question,
  summary,
  children,
  defaultOpen = false,
  className,
}: DisclosureRowProps) {
  const body = React.Children.count(children) > 0 ? children : null;

  const head = (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1 max-w-250">
        <p className={cn(H4, "text-foreground")}>{question}</p>
        <p className={cn(BODY_SM, "mt-2 text-muted-foreground")}>{summary}</p>
      </div>
      {body ? (
        <span
          aria-hidden="true"
          className={cn(
            BODY_SM,
            "w-10 shrink-0 text-right text-foreground",
            // 開いていれば − / 閉じていれば ＋ (Figma 7848:39433 / 7848:39438)
            "before:content-['＋'] group-open:before:content-['−']"
          )}
        />
      ) : null}
    </div>
  );

  if (!body) {
    return (
      <div
        data-slot="disclosure-row"
        className={cn("border-t border-border pt-6 pb-7", className)}
      >
        {head}
      </div>
    );
  }

  return (
    <details
      data-slot="disclosure-row"
      open={defaultOpen}
      className={cn("group border-t border-border", className)}
    >
      <summary className="cursor-pointer list-none pt-6 pb-7 [&::-webkit-details-marker]:hidden">
        {head}
      </summary>
      <div className={cn(BODY_SM, "max-w-216 pb-7 text-foreground")}>{body}</div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* ChapterBreak — 明度反転の章切り (Figma 7848:532)                            */
/* 全幅の帯。内容カラムは呼び出し側の Container が担う。                         */
/* -------------------------------------------------------------------------- */

export type ChapterBreakProps = {
  /** 英字キッカー。配送情報の章切り (7848:39508) のように無い版もある。 */
  overline?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function ChapterBreak({ overline, title, children, className }: ChapterBreakProps) {
  return (
    <div
      data-slot="chapter-break"
      className={cn("bg-primary text-primary-foreground", className)}
    >
      {/* キッカーがある版 (FAQ 7848:532) は上余白 56、無い版 (配送情報 7848:39508) は 96。
          どちらも帯の高さ 192 に収まる Figma 実測どおりの配分。 */}
      <div className={cn("page-container pb-10", overline ? "pt-14" : "pt-24")}>
        {overline ? (
          <p className={cn(OVERLINE, "text-primary-foreground")}>{overline}</p>
        ) : null}
        <p
          className={cn(
            "[font:var(--typography-style-h3)] [letter-spacing:var(--typography-style-h3-tracking)]",
            "text-primary-foreground",
            overline && "mt-4"
          )}
        >
          {title}
        </p>
        {children ? (
          <p className={cn(BODY_SM, "mt-4 max-w-160 text-primary-foreground")}>{children}</p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* LinkRow — title / desc / → の遷移行 (Figma 7849:39321)                      */
/* PC: title 300px → 52px 空き → desc 640px → 右端に矢印 / SP: 縦積み           */
/* -------------------------------------------------------------------------- */

export type LinkRowProps = {
  href: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function LinkRow({ href, title, children, className }: LinkRowProps) {
  return (
    <Link
      data-slot="link-row"
      href={href}
      className={cn(
        "group flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-6 pb-6",
        "md:flex-nowrap md:gap-x-13 md:pb-4",
        className
      )}
    >
      <span className={cn(H4, "min-w-0 flex-1 text-foreground md:w-75 md:flex-none")}>
        {title}
      </span>
      {/* SP は矢印を見出しと同じ行に置き、説明文を次の行へ回す (Figma SP 7851:39678)。
          PC は title / desc / → の 3 列 (Figma 7849:39321) なので矢印を末尾へ送る。 */}
      <span
        aria-hidden="true"
        className={cn(BODY_SM, "w-10 shrink-0 text-right text-foreground md:order-1 md:ml-auto")}
      >
        →
      </span>
      {children ? (
        <span className={cn(BODY_SM, "basis-full text-muted-foreground md:w-160 md:basis-auto")}>
          {children}
        </span>
      ) : null}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* DefinitionRow — title / desc の定義行 (Figma 7848:39394 / 7848:39514)        */
/* LinkRow と同じ骨格だが遷移しないので矢印もリンクも持たない。                  */
/* -------------------------------------------------------------------------- */

export type DefinitionRowProps = {
  term: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function DefinitionRow({ term, children, className }: DefinitionRowProps) {
  return (
    <div
      data-slot="definition-row"
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 pb-6",
        "md:flex-nowrap md:gap-x-13 md:pb-4",
        className
      )}
    >
      <dt className={cn(H4, "min-w-0 flex-1 text-foreground md:w-75 md:flex-none")}>{term}</dt>
      <dd className={cn(BODY_SM, "m-0 basis-full text-muted-foreground md:w-160 md:basis-auto")}>
        {children}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RateRow — 地域 / 送料 / お届け目安 の 3 列 (Figma 7848:39378)               */
/* 箱組みテーブルを使わず罫線のみで組む Figma の指定に従う。                     */
/* PC: 地域 x0 / 送料 x672 / 目安 x1008  SP: 地域を上、送料と目安を下段へ        */
/* -------------------------------------------------------------------------- */

export type RateRowProps = {
  area: React.ReactNode;
  fee: React.ReactNode;
  eta: React.ReactNode;
  className?: string;
};

export function RateRow({ area, fee, eta, className }: RateRowProps) {
  return (
    <div
      data-slot="rate-row"
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 pb-4",
        "md:flex-nowrap md:pt-5 md:pb-5",
        className
      )}
    >
      <span className={cn(H4, "basis-full text-foreground md:w-168 md:basis-auto")}>{area}</span>
      <span className={cn(BODY_SM, "w-45 shrink-0 text-foreground md:w-84")}>{fee}</span>
      <span className={cn(BODY_SM, "min-w-0 flex-1 text-muted-foreground")}>{eta}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ValueRow — 値だけを並べる行 (Figma 7848:39497 お届け時間帯)                  */
/* -------------------------------------------------------------------------- */

export function ValueRow({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="value-row"
      className={cn(BODY_SM, "border-t border-border pt-3 pb-3 text-foreground", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* PairRow — 幅 640 の狭い二段組 (Figma 7857:39698 / 7857:39783)               */
/* 左 304 + 溝 32 + 右 304。DefinitionRow (幅 1312) より狭い版で、              */
/* 「状況 → どうなるか」「対象 → 理由」のように読ませる対で使う。SP は縦積み。   */
/* -------------------------------------------------------------------------- */

/** strong = 左が見出し級 (7857:39698 h=88) / quiet = 左右とも本文級 (7857:39783 h=60) */
export type PairRowTone = "strong" | "quiet";

export type PairRowProps = {
  term: React.ReactNode;
  children: React.ReactNode;
  tone?: PairRowTone;
  className?: string;
};

export function PairRow({ term, children, tone = "strong", className }: PairRowProps) {
  return (
    <div
      data-slot="pair-row"
      data-tone={tone}
      className={cn(
        "flex flex-wrap gap-x-8 gap-y-2 border-t border-border",
        tone === "strong" ? "pt-5 pb-6" : "pt-5 pb-5",
        className
      )}
    >
      <dt
        className={cn(
          tone === "strong" ? H4 : BODY_SM,
          "basis-full text-foreground md:w-76 md:shrink-0 md:basis-auto"
        )}
      >
        {term}
      </dt>
      <dd
        className={cn(
          tone === "strong" ? BODY_SM : CAPTION,
          "m-0 basis-full md:w-76 md:basis-auto",
          tone === "strong" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* StepRow — 番号 / ステップ名 / 説明 の手順行 (Figma 7857:39713)              */
/* PC: 番号 x0 (列幅 112) / 名前 x112 (列幅 336) / 説明 x448                   */
/* SP: 番号と名前を同じ行に、説明を次の行へ                                     */
/* -------------------------------------------------------------------------- */

export type StepRowProps = {
  /** 01 / 02 のような順番。装飾ではなく順序情報なので読み上げにも残す。 */
  step: React.ReactNode;
  name: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function StepRow({ step, name, children, className }: StepRowProps) {
  return (
    <li
      data-slot="step-row"
      className={cn(
        "flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-5 pb-6",
        "md:flex-nowrap md:gap-x-0",
        className
      )}
    >
      <span className={cn(BODY_SM, "w-12 shrink-0 text-muted-foreground md:w-28")}>{step}</span>
      <span className={cn(H4, "min-w-0 flex-1 text-foreground md:w-84 md:flex-none")}>
        {name}
      </span>
      <span className={cn(BODY_SM, "basis-full text-foreground md:w-76 md:basis-auto")}>
        {children}
      </span>
    </li>
  );
}

/** 補足の小さい注記 (Figma 7848:39390 / 7848:39507)。 */
export function Note({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="note"
      className={cn(CAPTION, "text-muted-foreground", className)}
      {...props}
    />
  );
}

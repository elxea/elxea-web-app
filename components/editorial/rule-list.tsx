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

export function CategoryIndex({
  items,
  className,
  ...props
}: { items: CategoryIndexItem[] } & React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="category-index"
      className={cn("border-b border-border md:border-t", className)}
      {...props}
    >
      <ul className="md:grid md:grid-cols-4 md:gap-8 md:pt-12 md:pb-14">
        {items.map((item) => (
          <li key={item.href} className="border-t border-border md:border-t-0">
            <Link
              href={item.href}
              className={cn(
                BODY_SM,
                "block pt-8 pb-3 text-foreground hover:text-muted-foreground md:py-0"
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
  overline: React.ReactNode;
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
      <div className="page-container pt-14 pb-10">
        <p className={cn(OVERLINE, "text-primary-foreground")}>{overline}</p>
        <p
          className={cn(
            "[font:var(--typography-style-h3)] [letter-spacing:var(--typography-style-h3-tracking)]",
            "mt-4 text-primary-foreground"
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

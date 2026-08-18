import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * 検索まわりの DS 部品 (C2 R3)。
 *
 * Figma 正本: `Common / Layouts` section 7967:1325「開閉・アクション時UI」
 * - InputUnderline (Proposed) — elxea/search  6936:126
 * - 検索パネル (開時)                          7967:42151
 *
 * 値はすべて typography.style.* / spacing scale / semantic color 経由。
 * 生 px・生カラーは書かない。
 */

/** `typography.style.h2` — 24px / 400 / lineHeight 1.3。検索語の入力サイズ。 */
const H2 =
  "[font:var(--typography-style-h2)] [letter-spacing:var(--typography-style-h2-tracking)]";
/** `typography.style.caption` — 12px。 */
const CAPTION =
  "[font:var(--typography-style-caption)] [letter-spacing:var(--typography-style-caption-tracking)]";
/** `typography.style.body-sm` — 14px。 */
const BODY_SM =
  "[font:var(--typography-style-body-sm)] [letter-spacing:var(--typography-style-body-sm-tracking)]";

/* -------------------------------------------------------------------------- */
/* InputUnderline — 下線だけの大きな入力 (Figma 6936:126)                       */
/* 枠を持たず、下罫線 2px と 24px の文字だけで入力欄であることを示す。           */
/* -------------------------------------------------------------------------- */

export type InputUnderlineProps = Omit<React.ComponentProps<"input">, "size">;

export function InputUnderline({ className, ...props }: InputUnderlineProps) {
  return (
    <input
      data-slot="input-underline"
      type="search"
      className={cn(
        H2,
        // Figma: border-b 2px / pt 8 / pb 16 / 幅は親追従
        "w-full border-b-2 border-border bg-transparent pt-2 pb-4 text-foreground",
        "placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none",
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* SearchPanel — ヘッダー直下に開く検索パネル (Figma 7967:42151)                */
/* PC は Header の下に全幅で開き、下に scrim を敷いて外側クリックで閉じる。      */
/* scrim の開閉制御は呼び出し側 (Header) の責務で、ここは見た目だけを持つ。      */
/* -------------------------------------------------------------------------- */

export type SearchPanelProps = {
  /** 「よく探されるもの」。Figma は 4 件。 */
  suggestions?: { label: string; href: string }[];
  suggestionsLabel?: React.ReactNode;
  inputProps?: InputUnderlineProps;
  className?: string;
};

export function SearchPanel({
  suggestions = [],
  suggestionsLabel,
  inputProps,
  className,
}: SearchPanelProps) {
  return (
    <div
      data-slot="search-panel"
      className={cn("bg-background page-inset py-8", className)}
    >
      <InputUnderline {...inputProps} />
      {suggestions.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-6">
          {suggestionsLabel ? (
            <span className={cn(CAPTION, "text-muted-foreground")}>{suggestionsLabel}</span>
          ) : null}
          {suggestions.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(BODY_SM, "font-medium text-foreground hover:text-muted-foreground")}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

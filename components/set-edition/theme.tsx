import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Set Edition のテーマ (茜 / 翠 / そひ) — 正本 1 箇所 (C3)。
 *
 * これまで一覧 (`/elxea-journal`) と詳細 (`/elxea-journal/[slug]`) が
 * `themeLabels` / `themeColors` を各自コピーで持っていた。片方だけ直す事故が
 * 起きる形なので、ラベル・色・バッジ表現をここに集約する。
 *
 * 呼称 (Setaka 2026-08-11 確定): roji の読み物の総称が「elxea Journal」で、
 * その 2 種類が「Personal Edition」(会員・動的) と「Set Edition」(買い切り・
 * プリセット)。`/elxea-journal` は Set Edition。「ニュースレター」は使わない。
 * URL は互換のため変更しない。
 *
 * 色は semantic / brand トークン (`--color-brand-tea-*`) 参照のみ。生カラーは書かない。
 */

export type SetEditionTheme = "akane" | "sui" | "sohi";

/** 短縮ラベル (Figma Journal Theme Badge 6934:143 が正)。 */
const THEME_LABELS: Record<SetEditionTheme, string> = {
  akane: "茜",
  sui: "翠",
  sohi: "そひ",
};

const THEME_COLORS: Record<SetEditionTheme, string> = {
  akane: "var(--color-brand-tea-red)",
  sui: "var(--color-brand-tea-green)",
  sohi: "var(--color-brand-tea-warm)",
};

/** 未知のテーマ値 (Sanity 側で増えた場合) のフォールバック。 */
const FALLBACK_COLOR = "var(--color-brand-ash)";

function isKnownTheme(theme: string): theme is SetEditionTheme {
  return theme === "akane" || theme === "sui" || theme === "sohi";
}

export function themeLabel(theme: string): string {
  return isKnownTheme(theme) ? THEME_LABELS[theme] : theme;
}

export function themeColor(theme: string): string {
  return isKnownTheme(theme) ? THEME_COLORS[theme] : FALLBACK_COLOR;
}

/**
 * テーマバッジ。DS の `Badge` (rounded-full / text-xs / px-2) をそのまま使い、
 * 背景色だけテーマトークンで差し替える (新規部品を作らない)。
 */
export function ThemeBadge({
  theme,
  className,
}: {
  theme: string;
  className?: string;
}) {
  return (
    <Badge
      data-slot="set-edition-theme-badge"
      variant="default"
      className={cn("tracking-wider text-foreground", className)}
      style={{ backgroundColor: themeColor(theme) }}
    >
      {themeLabel(theme)}
    </Badge>
  );
}

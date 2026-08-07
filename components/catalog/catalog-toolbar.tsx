"use client";

import * as React from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { bodySmClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * Catalog toolbar (C3 基盤).
 *
 * Figma が正本 — 【R2: 確定版】共通リストパターンの Toolbar
 * (PC 8061:1789 / 8063:2152、SP 8062:2017 / 8063:2381)。
 *
 * Figma 実測 (px) → 実装:
 * - Chip: 高さ 44 (`h-11`) / 全丸め / gap 8 (`gap-2`)
 *   PC padding 16x8 (`lg:px-4 lg:py-2`) / SP padding 12x12 (`px-3 py-3`)
 * - 選択中は塗り (primary / primary-foreground)、未選択は 1px 罫線 (border)
 * - SP は横スクロール (Figma "Chips (横スクロール)")、PC は Select 180x44 が右端
 *
 * 絞り込み・並び替えの状態は URL クエリに載せる (`?category=` / `?sort=`)。
 * 戻る・共有・SSR いずれでも同じ結果になるようにするため、クライアント state に
 * 閉じ込めない。
 */

/**
 * `href` を持つ chip は「別ページへ移動するチップ」として `<Link>` で描画する
 * (ジャーナルのタグ / カテゴリページ。Figma 8082:3870 / 8083:4205 の「一覧R2と
 * 同一チップ列」)。`href` が無い chip は従来どおり同一ページ内の `?category=`
 * 絞り込みボタンとして描画する。関数ではなく文字列を渡す形にしているのは、
 * Server Component から Client Component へ関数を渡せないため。
 */
export type CatalogChip = { value: string; label: string; href?: string };

export type CatalogToolbarProps = {
  chips: CatalogChip[];
  /** 現在選択中の chip value。未指定は先頭 (すべて)。 */
  activeChip?: string;
  /** 並び替えの選択肢。空なら Select を出さない。 */
  sortOptions?: CatalogChip[];
  activeSort?: string;
  /** Select の aria-label (i18n 済み文字列)。 */
  sortLabel: string;
  className?: string;
};

export function CatalogToolbar({
  chips,
  activeChip,
  sortOptions = [],
  activeSort,
  sortLabel,
  className,
}: CatalogToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = activeChip ?? chips[0]?.value;

  const hrefWith = React.useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === undefined) params.delete(key);
      else params.set(key, value);
      // 絞り込み・並び替えを変えたら表示件数は初期値に戻す。
      params.delete("show");
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams]
  );

  return (
    <div
      data-slot="catalog-toolbar"
      className={cn("flex items-center justify-between gap-4", className)}
    >
      <div
        data-slot="catalog-chips"
        role="group"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0"
      >
        {chips.map((chip) => {
          const selected = chip.value === current;
          const chipClass = cn(
            bodySmClass,
            "flex h-11 shrink-0 items-center rounded-full px-3 py-3 whitespace-nowrap lg:px-4 lg:py-2",
            selected
              ? "bg-primary text-primary-foreground"
              : "border border-border text-foreground hover:bg-muted"
          );

          if (chip.href) {
            return (
              <Link
                key={chip.value}
                href={chip.href}
                data-slot="catalog-chip"
                aria-current={selected ? "page" : undefined}
                className={chipClass}
              >
                {chip.label}
              </Link>
            );
          }

          return (
            <button
              key={chip.value}
              type="button"
              data-slot="catalog-chip"
              aria-pressed={selected}
              onClick={() =>
                router.push(hrefWith("category", chip.value === chips[0]?.value ? undefined : chip.value))
              }
              className={chipClass}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {sortOptions.length > 0 ? (
        <NativeSelect
          data-slot="catalog-sort"
          aria-label={sortLabel}
          value={activeSort ?? sortOptions[0]?.value}
          onChange={(event) => router.push(hrefWith("sort", event.target.value))}
          className="hidden h-11 w-45 shrink-0 rounded-full lg:block"
        >
          {sortOptions.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}

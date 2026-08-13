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
 *   padding 16x8 (`px-4 py-2`) — PC / SP 共通。
 *   W4 で標準化した DS Chip Module (8171:269) が正本。旧凍結ノードの SP 値
 *   12x12 は Chip Module 化以前の値なので採らない。高さ 44 は padding ではなく
 *   `h-11` が担保しているため、padding 変更でタップ域は縮まない。
 * - 選択中は塗り (primary / primary-foreground)、未選択は 1px 罫線 (border)
 * - SP は横スクロール (Figma "Chips (横スクロール)")、PC は Select 180x44 が右端
 *
 * S2: SP で「まだ右に続いている」が伝わらない問題への対処
 * (Figma【Sprint1 追補 B案】8205:5548 / CategoryScroller 8206:15)。
 * チップ列が画面幅を超えるときだけ、右端に幅 64 のフェードと、列の下に高さ 2 の
 * スクロールインジケータを出す。Figma 実測 (px) → 実装:
 * - フェード      64 幅 (`w-16`) / チップ列と同じ高さ 44 / 透明 → background
 * - インジケータ  チップ列の 8 下 (`mt-2`) / 高さ 2 (`h-0.5`) / 全丸め
 *                 溝 = border 色 / つまみ = muted-foreground 色
 *                 つまみ幅 = 可視範囲の割合、位置 = スクロール量の割合
 * どちらも SP 限定 (`lg:hidden`)。PC はチップ列が全部見えていて隠れ幅が無いため。
 * SP の並び替え (意図的な Figma 差分):
 * Figma の SP フレームには Select が無いが、以前の実装は `hidden lg:block` を
 * `<select>` 自体に当てていたため、SP では並び替えが一切できず、かつ
 * NativeSelect のラッパ (相対配置 + シェブロン絶対配置) だけが残って
 * シェブロンが浮く状態だった。SP でも並び替えは使えるべき機能なので、
 * 「PC は右端に横並び / SP はチップ列の下に右寄せで 1 段落とす」に変える
 * (見た目は PC と同じ DS の NativeSelect をそのまま使い、追加の意匠は足さない)。
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
  /**
   * 絞り込みを載せる URL クエリのキー。既定は `category` (商品一覧 / お茶メニュー)。
   * 農家一覧は絞り込み軸が産地なので `region` を渡す。既定値を変えていないので
   * 既存ページの URL は不変。
   */
  chipParam?: string;
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
  chipParam = "category",
  sortOptions = [],
  activeSort,
  sortLabel,
  className,
}: CatalogToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = activeChip ?? chips[0]?.value;

  /**
   * チップ列を持たない呼び出し (コレクション詳細 — コレクション自体が絞り込みの
   * 結果なのでチップは二重の facet になる) では、残る中身が並び替え Select だけに
   * なる。Select は Figma どおり PC 限定 (`hidden lg:block`) なので、SP では
   * Toolbar の中身が空になり `mt-8` 分の幽霊余白が残ってしまう。チップが無いときは
   * 枠ごと PC 限定にして SP で場所を取らないようにする。
   * 既存の呼び出しは全て非空のチップ列を渡すため、描画は一切変わらない。
   */
  const chipless = chips.length === 0;

  /**
   * チップ列の「隠れている幅」を測る。可視幅 / 全幅 と スクロール量 / 全幅 の 2 つが
   * あればフェードとインジケータは描ける。
   *
   * 初期値は「隠れ幅なし」(ratio = 1) にしてある。サーバ側では要素を測れないので、
   * 初回描画をクライアントと揃えて hydration のズレを起こさないため。実際の値は
   * マウント後の計測で入り、そこで初めてフェードとインジケータが出る。
   */
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState({ ratio: 1, offset: 0 });

  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    if (scrollWidth <= clientWidth) {
      setVisible({ ratio: 1, offset: 0 });
      return;
    }
    setVisible({ ratio: clientWidth / scrollWidth, offset: scrollLeft / scrollWidth });
  }, []);

  React.useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el) return;
    // 画面回転・フォント読み込み・チップ列の差し替えで幅が変わる。
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, chips]);

  const scrollable = visible.ratio < 1;
  // 右端まで来たらフェードは消す。もう先が無いのに最後のチップを霞ませない。
  const hasMoreRight = scrollable && visible.offset + visible.ratio < 0.999;

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

  // 出すものが何も無いときは枠ごと出さない。early return は hooks より後に置く
  // (rules-of-hooks: 呼び出し順を分岐させられない)。
  if (chipless && sortOptions.length === 0) return null;

  return (
    <div
      data-slot="catalog-toolbar"
      className={cn(
        "items-center justify-between gap-4",
        chipless ? "hidden justify-end lg:flex" : "flex",
        className
      )}
    >
      {chipless ? null : (
      <div data-slot="catalog-chip-scroller" className="relative min-w-0 flex-1 lg:flex-none">
      <div
        ref={scrollerRef}
        onScroll={measure}
        data-slot="catalog-chips"
        role="group"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0"
      >
        {chips.map((chip) => {
          const selected = chip.value === current;
          // 状態は Figma `Chip / Category (Module)` 8171:269 の 6 バリアント
          // (default / hover / focus / selected / selected-hover / disabled) に
          // 揃える。Figma に無い状態は足さない (unselected の active は Chip に
          // 定義が無いので作らない)。
          //
          // 意図的な Figma 差分: 角丸。Chip Module は radius-lg (8px) だが、
          // このツールバーの正本は R2 確定版の共通リストパターン Toolbar
          // (8061:1789) で全丸めであり、商品一覧・お茶メニューも同じ部品を
          // 共有している。Figma 側に 2 つの正本が併存している状態なので、
          // ここでは形は既存 (全丸め) のまま「状態だけ」を Chip Module へ寄せる。
          // 形の統一は Chip Module の注記どおり Figma 側の次回改訂で決める。
          const chipClass = cn(
            bodySmClass,
            "flex h-11 shrink-0 items-center rounded-full px-3 py-3 whitespace-nowrap lg:px-4 lg:py-2",
            "transition-colors duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            selected
              ? "bg-primary text-primary-foreground hover:bg-brand-charcoal"
              : "border border-border text-foreground hover:bg-secondary",
            "aria-disabled:pointer-events-none aria-disabled:text-muted-foreground aria-disabled:opacity-50"
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
                router.push(
                  hrefWith(chipParam, chip.value === chips[0]?.value ? undefined : chip.value)
                )
              }
              className={chipClass}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* 右端フェード。チップ列は `-mx-4` で画面端まで抜けているので、
          フェードもその端 (`-right-4`) に合わせる。装飾なので触れない。 */}
      {hasMoreRight ? (
        <div
          data-slot="catalog-chips-fade"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 -right-4 h-11 w-16 bg-linear-to-r from-transparent to-background lg:hidden"
        />
      ) : null}

      {/* スクロールインジケータ。つまみの幅が可視範囲の割合、位置がスクロール量。
          読み上げ対象ではない (同じ情報はチップ列そのものが持っている)。 */}
      {scrollable ? (
        <div
          data-slot="catalog-chips-scrollbar"
          aria-hidden="true"
          className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-border lg:hidden"
        >
          <div
            data-slot="catalog-chips-scrollbar-thumb"
            className="h-full rounded-full bg-muted-foreground"
            style={{
              width: `${visible.ratio * 100}%`,
              marginInlineStart: `${visible.offset * 100}%`,
            }}
          />
        </div>
      ) : null}
      </div>
      )}

      {sortOptions.length > 0 ? (
        <NativeSelect
          data-slot="catalog-sort"
          aria-label={sortLabel}
          value={activeSort ?? sortOptions[0]?.value}
          onChange={(event) => router.push(hrefWith("sort", event.target.value))}
          /**
           * PC 限定は「外枠ごと」消す。`hidden` を `<select>` 側に置くと、
           * NativeSelect の外枠 div (chevron は absolute なので中身幅 0) が
           * フロー要素として SP に残り、Toolbar の `flex gap-4` を 1 つ分 (16px)
           * 食う。その結果チップ列の右端が画面右端まで届かなかった
           * (SP 375 で x=359 止まり)。
           */
          wrapperClassName="hidden shrink-0 lg:block"
          className="h-11 w-45 rounded-full"
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

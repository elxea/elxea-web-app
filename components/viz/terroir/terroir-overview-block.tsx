"use client";

/**
 * お茶リスト先頭のテロワール地図の枠と遅延読み込み。
 *
 * 作りは `terroir-lens-block.tsx` と同じ。違うのは 2 点:
 *
 * - **一覧の先頭にあるので、画面に入るのを待たない**。ページを開いた時点で
 *   ほぼ確実に視界に入るため、`useInViewOnce` で待つと「開いてから遅れて
 *   地図が現れる」だけになる。`next/dynamic` の分割 (SSR しない) は残す
 * - **表示中のメニュー群を受け取る**。フィルタで一覧が変わればここに来る
 *   `items` が変わり、地図の尺度が追従する
 *
 * 座標が 1 件も引けないときはブロックごと描かない (空の枠を出すと
 * 「地図が壊れている」ように見えるため。`TeaOriginBlock` と同じ方針)。
 */

import dynamic from "next/dynamic";

import { useMemo } from "react";

import {
  terroirOverviewFor,
  type TerroirOverviewItem,
} from "@/lib/roji/tea-terroir-overview";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const TerroirOverviewMap = dynamic(
  () => import("./terroir-overview-map").then((m) => m.TerroirOverviewMap),
  {
    ssr: false,
    // 読み込み前も地の色は変わらない (地図が入るときに面がちらつかない)。
    loading: () => (
      <div
        className="h-64 w-full rounded-sm lg:h-96"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
        aria-hidden="true"
      />
    ),
  }
);

export interface TerroirOverviewBlockProps {
  /** いま一覧に出ているメニュー群。フィルタ後の集合をそのまま渡す。 */
  items: readonly TerroirOverviewItem[];
  /** 地図の代替テキスト (i18n 済み)。地図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function TerroirOverviewBlock({
  items,
  label,
  className,
}: TerroirOverviewBlockProps) {
  // 地図側は内容の鍵で組み直しを判断するが、無駄な再計算はここで止める。
  const data = useMemo(() => terroirOverviewFor(items), [items]);

  if (!data) return null;

  return (
    <div data-slot="terroir-overview-block" className={cn(className)}>
      <TerroirOverviewMap data={data} label={label} />
    </div>
  );
}

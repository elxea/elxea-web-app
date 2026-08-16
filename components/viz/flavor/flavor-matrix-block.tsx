"use client";

/**
 * 味の四象限の枠と遅延読み込み。
 *
 * 中身 (`flavor-matrix.tsx`) は SVG filter の合成を毎フレーム回すので、画面に
 * 入るまで render しない。Server Component の page.tsx から `ssr: false` を
 * 直接書けないので、このクライアント側ラッパーを 1 枚挟む
 * (`components/viz/map/origin-map-frame.tsx` と同じ公式手順)。
 */

import dynamic from "next/dynamic";

import { useMemo } from "react";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { flavorMatrixFor } from "@/lib/roji/tea-flavor";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const FlavorMatrix = dynamic(
  () => import("./flavor-matrix").then((m) => m.FlavorMatrix),
  { ssr: false }
);

export interface FlavorMatrixBlockProps {
  /** 銘柄番号。Sanity `teaMenu.productNumber`。 */
  menuNumber: string | number | null | undefined;
  /** 図の代替テキスト (i18n 済み)。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function FlavorMatrixBlock({ menuNumber, label, className }: FlavorMatrixBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  // 描画側の effect は `data` の同一性で組み直しを判断する。毎 render で
  // 作り直すと、絵が落ち着くたびに組み直しが走る。
  const data = useMemo(() => flavorMatrixFor(menuNumber), [menuNumber]);

  return (
    <div ref={ref} data-slot="flavor-matrix-block" className={cn(className)}>
      {inView ? (
        <FlavorMatrix data={data} label={label} />
      ) : (
        // 読み込み前も地の色は変わらない (読み込みで面がちらつかない)。
        <div
          className="h-96 w-full lg:h-140"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

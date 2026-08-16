"use client";

/**
 * 香りの場の枠と遅延読み込み。作りは `flavor-matrix-block.tsx` と同じ。
 */

import dynamic from "next/dynamic";

import { useMemo } from "react";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { aromaFieldFor } from "@/lib/roji/tea-aroma";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const AromaField = dynamic(() => import("./aroma-field").then((m) => m.AromaField), {
  ssr: false,
});

export interface AromaFieldBlockProps {
  /** 銘柄番号。Sanity `teaMenu.productNumber`。 */
  menuNumber: string | number | null | undefined;
  /** 図の代替テキスト (i18n 済み)。 */
  label: string;
  className?: string;
}

export function AromaFieldBlock({ menuNumber, label, className }: AromaFieldBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  // 描画側の effect は `data` の同一性で描き直しを判断する (flavor と同じ)。
  const data = useMemo(() => aromaFieldFor(menuNumber), [menuNumber]);

  return (
    <div ref={ref} data-slot="aroma-field-block" className={cn(className)}>
      {inView ? (
        <AromaField data={data} label={label} />
      ) : (
        <div
          className="h-96 w-full lg:h-140"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

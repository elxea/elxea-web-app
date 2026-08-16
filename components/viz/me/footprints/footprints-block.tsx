"use client";

/**
 * 「味わいの足あと」の枠と遅延読み込み。
 *
 * 中身 (`footprints-scene.tsx`) は 40 点の放射グラデーションを毎フレーム描き直す
 * ので、画面に入るまで render しない。Server Component の page.tsx から
 * `ssr: false` を直接書けないので、このクライアント側ラッパーを 1 枚挟む
 * (`components/viz/flavor/flavor-matrix-block.tsx` と同じ公式手順)。
 *
 * 読み込み前の面も生成りで塗っておく。ここを空にすると、スクロールで図に
 * 入った瞬間に地の色がちらつく。高さは中身の枠と同じ値を持たせる (ずれると
 * 読み込みの前後でページが跳ねる)。
 */

import dynamic from "next/dynamic";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const FootprintsScene = dynamic(
  () => import("./footprints-scene").then((m) => m.FootprintsScene),
  { ssr: false }
);

export interface FootprintsBlockProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function FootprintsBlock({ label, className }: FootprintsBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} data-slot="footprints-block" className={cn(className)}>
      {inView ? (
        <FootprintsScene label={label} />
      ) : (
        <div
          className="h-120 w-full sm:h-140 lg:h-160"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

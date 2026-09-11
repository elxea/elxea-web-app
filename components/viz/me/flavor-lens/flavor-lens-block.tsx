"use client";

/**
 * 好みの位置 (手もとのレンズ) の枠と遅延読み込み。
 *
 * 中身 (`flavor-lens-scene.tsx`) は 26 銘柄 + 40 杯を毎フレーム Canvas に描く
 * ので、画面に入るまで render しない。Server Component の page.tsx から
 * `ssr: false` を直接書けないので、このクライアント側ラッパーを 1 枚挟む
 * (`components/viz/flavor/flavor-matrix-block.tsx` と同じ公式手順)。
 *
 * 読み込み前の板は **同じ高さ・同じ地の色**にしておく。ここを空にすると、
 * 図が差し込まれた瞬間にページが跳ねる。
 */

import dynamic from "next/dynamic";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const FlavorLensScene = dynamic(
  () => import("./flavor-lens-scene").then((m) => m.FlavorLensScene),
  { ssr: false }
);

export interface FlavorLensBlockProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  /** 足あとレンズの初期値。マイページ文脈なので既定 true。 */
  defaultFootprints?: boolean;
  className?: string;
}

export function FlavorLensBlock({
  label,
  defaultFootprints = true,
  className,
}: FlavorLensBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} data-slot="flavor-lens-block" className={cn(className)}>
      {inView ? (
        <FlavorLensScene label={label} defaultFootprints={defaultFootprints} />
      ) : (
        <div
          className="h-120 w-full lg:h-160"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

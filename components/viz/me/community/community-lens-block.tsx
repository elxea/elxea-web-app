"use client";

/**
 * 「みんなの気配」の枠と遅延読み込み。
 *
 * 中身 (`community-lens.tsx`) は枠の寸法が決まった時点で気配の面を
 * `ImageData` へ焼き、そのあと rAF を回す。開いただけで焼くのは無駄なので、
 * 画面に入るまで render しない。Server Component の page.tsx から
 * `ssr: false` を直接書けないので、このクライアント側ラッパーを 1 枚挟む
 * (`components/viz/flavor/flavor-matrix-block.tsx` と同じ公式手順)。
 *
 * 描画側は props を持たない (`label` 以外)。データは
 * `lib/roji/me/community-field.ts` が持っており、差し替えはそちらだけで済む。
 */

import dynamic from "next/dynamic";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const CommunityLens = dynamic(
  () => import("./community-lens").then((m) => m.CommunityLens),
  { ssr: false }
);

export interface CommunityLensBlockProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function CommunityLensBlock({ label, className }: CommunityLensBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} data-slot="community-lens-block" className={cn(className)}>
      {inView ? (
        <CommunityLens label={label} />
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

"use client";

/**
 * 「ことばの庭」の枠と遅延読み込み。
 *
 * 中身 (`word-garden.tsx`) は **DOM に置いてから実測する** 組版をするので、
 * サーバでは組めない (文字の幅が分からない)。画面に入るまで render しないことで
 * 「開いただけでは 1 バイトも落ちない」も同時に成立する
 * (`components/viz/flavor/flavor-matrix-block.tsx` と同じ公式手順)。
 */

import dynamic from "next/dynamic";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const WordGarden = dynamic(() => import("./word-garden").then((m) => m.WordGarden), {
  ssr: false,
});

export interface WordGardenBlockProps {
  /** スクリーンリーダー向けの説明。 */
  label: string;
  className?: string;
}

export function WordGardenBlock({ label, className }: WordGardenBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} data-slot="word-garden-block" className={cn(className)}>
      {inView ? (
        <WordGarden label={label} />
      ) : (
        // 読み込み前も地の色は変わらない (読み込みで面がちらつかない)。
        <div
          className="h-140 w-full md:h-160 lg:h-180"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

"use client";

/**
 * 「roji プロファイル」の枠と遅延読み込み。
 *
 * `components/viz/me/community/community-lens-block.tsx` と同じ公式手順
 * (`dynamic(..., { ssr: false })` + `useInViewOnce`)。中身
 * (`profile-stage.tsx`) は Canvas を毎フレーム描くので、画面に入るまで
 * render しない。
 */

import dynamic from "next/dynamic";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";

const ProfileStage = dynamic(
  () => import("./profile-stage").then((m) => m.ProfileStage),
  { ssr: false },
);

export interface ProfileStageBlockProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  /** 倍率スライダーの説明。省略時は板側の既定 (日本語) を使う。 */
  zoomLabel?: string;
  facet: ProfileFacet;
  category?: TeaCategory;
  className?: string;
}

export function ProfileStageBlock({ label, zoomLabel, facet, category, className }: ProfileStageBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();

  return (
    <div ref={ref} data-slot="profile-stage-block" className={cn(className)}>
      {inView ? (
        <ProfileStage label={label} zoomLabel={zoomLabel} facet={facet} category={category} />
      ) : (
        /* 場所取りは板と同寸 (高さは板が決める)。ここで別の高さを持つと、
           読み込みの前後で板の大きさが跳ねる。 */
        <div
          className="h-full w-full"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

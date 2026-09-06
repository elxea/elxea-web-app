"use client";

/**
 * データ取得を一切行わない静止プレビュー。Storybook の視覚回帰専用。
 *
 * 本番の `/dev/profile` は `ProfileStage` (3本のGETから取得・操作あり) を使う。
 * こちらは固定 seed の `ProfileScene` を props でそのまま受け取り、1回だけ
 * 描画する — 決定的なので story の差分がそのまま意味を持つ (Spec §「テスト計画」4)。
 */

import { useEffect, useRef } from "react";

import { CanvasProfileRenderer } from "@/components/viz/profile/renderers/canvas";
import { cameraForFraming } from "@/components/viz/profile/camera";
import type { ProfileScene } from "@/components/viz/profile/renderer";
import { sceneFraming } from "@/lib/profile/framing";
import type { ProfileFacet } from "@/lib/profile/contract";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

export interface ProfileStagePreviewProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  scene: ProfileScene;
  z?: number;
  className?: string;
}

export function ProfileStagePreview({ label, scene, z = 0, className }: ProfileStagePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new CanvasProfileRenderer();
    renderer.mount(host, { reducedMotion: true });
    const rect = host.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    /* 本番の板 (`ProfileStage`) と同じ決め方で中心と倍率を出す。story だけ別の
       写し方をすると、視覚回帰が「本番で見えるもの」を見なくなる。 */
    const facet: ProfileFacet = scene.field?.facet ?? scene.words?.facet ?? "tea";
    const framing = sceneFraming(scene, facet);
    const camera = cameraForFraming({
      anchor: framing.anchor,
      radius: framing.radius,
      viewW: rect.width,
      viewH: rect.height,
      z,
    });
    renderer.draw(scene, camera);
    return () => renderer.destroy();
  }, [scene, z]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className={className}
      /* 高さは呼び出し側 (story の枠) が決める。ここで `minHeight` を持つと、
         機械検査が小さな枠を並べて数えるときだけ縦横比が崩れる。 */
      style={{ width: "100%", height: "100%", backgroundColor: ROJI_VIZ_COLOR.kinari }}
    />
  );
}

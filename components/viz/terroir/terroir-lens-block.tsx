"use client";

/**
 * 土地を読むの枠と遅延読み込み。
 *
 * 中身 (`terroir-lens-map.tsx`) は maplibre-gl (JS だけで gzip 271KB) と
 * 標高タイル十数枚を読む。品目ページで最も重い部品なので、**画面に近づくまで
 * 1 バイトも落とさない**。SSR で読めないのは maplibre-gl が import 時に
 * `window` に触れるため (`components/viz/map/origin-map-frame.tsx` と同じ事情)。
 */

import dynamic from "next/dynamic";

import { useMemo } from "react";

import { useInViewOnce } from "@/components/viz/use-in-view-once";
import { terroirDataFor } from "@/lib/roji/tea-terroir";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const TerroirLensMap = dynamic(
  () => import("./terroir-lens-map").then((m) => m.TerroirLensMap),
  { ssr: false }
);

export interface TerroirLensBlockProps {
  /** 産地の座標。引けないときは既定の主産地に落ちる。 */
  origin: { lat: number | null; lng: number | null };
  /** 産地名 (i18n 不要の地名)。 */
  placeLabel: string | null;
  /** 地図の代替テキスト (i18n 済み)。地図の中に説明文を置かないので必須。 */
  label: string;
  copy: {
    elevationUnit: string;
    teaLabel: string;
    close: string;
    hint: string;
  };
  className?: string;
}

export function TerroirLensBlock({
  origin,
  placeLabel,
  label,
  copy,
  className,
}: TerroirLensBlockProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  // 地図側は `data` の同一性で「板を組み直すか」を決める。毎 render で作り
  // 直すと、標高タイルの取得からやり直しになる。依存は素の値で取る
  // (`origin` はページ側で毎 render 作られるオブジェクトなので識別子にならない)。
  const data = useMemo(
    () => terroirDataFor({ lat: origin.lat, lng: origin.lng }, placeLabel),
    [origin.lat, origin.lng, placeLabel]
  );

  return (
    <div ref={ref} data-slot="terroir-lens-block" className={cn(className)}>
      {inView ? (
        <TerroirLensMap data={data} label={label} copy={copy} />
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

"use client";

/**
 * 産地の地図の本体。MapLibre GL JS をここでだけ読む。
 *
 * このファイルは **必ず遅延読み込みで到達させる** (`origin-map-frame.tsx` 参照)。
 * maplibre-gl は JS だけで gzip 271KB あり、品目ページの他の要素より重い。
 * 地図が画面に入るまで 1 バイトも落とさないのが前提の構成になっている。
 *
 * スタイル・画角・色の根拠は `lib/viz/map-style.ts` に置いてある。
 * ここが持つのは「MapLibre をどう起動して、いつ壊すか」だけ。
 */

import { useEffect, useRef } from "react";
// maplibre-gl 6 は default export を持たない (5 までの `import maplibregl from` は
// TS1192 になる)。`MapLibreMap` は `Map` の別名 export で、グローバルの `Map` を
// 隠さずに済むのでこちらを使う。
import { MapLibreMap, Marker } from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  ITEM_MAP_ZOOM,
  centerForPin,
  originMapStyle,
} from "@/lib/viz/map-style";
import { cn } from "@/lib/utils";

import { createOriginPinElement } from "./origin-pin";

export interface OriginMapProps {
  /** 産地の緯度 (WGS84)。 */
  lat: number;
  /** 産地の経度 (WGS84)。 */
  lng: number;
  /** 画角。既定は品目ページの小地図。 */
  zoom?: number;
  /** スクリーンリーダー向けの説明。地図の中に文字を置かないので必須。 */
  label: string;
  className?: string;
}

/** `prefers-reduced-motion: reduce` が有効か。SSR では常に false 扱い。 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function OriginMap({
  lat,
  lng,
  zoom = ITEM_MAP_ZOOM,
  label,
  className,
}: OriginMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = prefersReducedMotion();
    const point = { lng, lat };

    /**
     * center は高さに依存する (ピンを上端から 57px に置くため南へずらす)。
     * 高さは CSS が決めるので、生成時と リサイズ時の両方でここから引く。
     */
    const centerFor = (height: number) =>
      centerForPin(point, { zoom, height: height || container.clientHeight });

    const map = new MapLibreMap({
      container,
      style: originMapStyle({ reducedMotion }),
      center: centerFor(container.clientHeight),
      zoom,
      bearing: 0,
      pitch: 0,
      // 静止画として扱う。ドラッグ・スクロールズーム・回転・傾きすべて無効で、
      // ページのスクロールも奪わない。
      interactive: false,
      // 帰属表示は法的義務が無い (Natural Earth = PD / MapLibre = BSD-3-Clause)。
      // 「文字を地図に重ねない」原則を守るため既定のコントロールを切る。
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: reducedMotion ? 0 : 300,
      // NOTE: `preserveDrawingBuffer` は maplibre-gl 6 で MapOptions から消えた。
      // 表示専用でスクリーンショット API も使わないので、指定しないのが正しい
      // (既定の false と同じ挙動)。
    });

    // ピンは Marker (DOM) で描く。symbol レイヤーにしないのは意匠を CSS で持つため。
    const marker = new Marker({
      element: createOriginPinElement(),
      anchor: "center",
    })
      .setLngLat([lng, lat])
      .addTo(map);

    // 高さが変わるとピンの見かけの位置がずれるので center を引き直す。
    // (BP をまたぐリサイズ・SP の URL バー出入りで実際に起きる)
    const resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? container.clientHeight;
      if (height > 0) map.jumpTo({ center: centerFor(height), zoom });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      marker.remove();
      map.remove();
    };
  }, [lat, lng, zoom]);

  return (
    <div
      ref={containerRef}
      data-slot="origin-map"
      role="img"
      aria-label={label}
      className={cn("h-full w-full", className)}
    />
  );
}

export default OriginMap;

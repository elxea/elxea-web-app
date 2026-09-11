"use client";

/**
 * お茶リストの先頭に置くテロワール地図。
 *
 * 表示中のメニュー群の産地を 1 枚に置き、**その全部が収まる尺度に自動で合わせる**。
 * 静岡と奈良と九州が並んでいれば 3 か所すべてが見える画角になり、
 * カテゴリーで絞り込めばその産地群だけの画角に寄る。
 *
 * ## 単品詳細の「土地を読む」とは別物
 *
 * あちらは 1 か所の土地を五つのレンズで読む図で、尺度は固定 (襞が見える縮尺に
 * 意味がある)。**そちらの尺度はこの実装では一切変えていない**。
 * こちらは「いま何を見ているか」の縮図なので、逆に尺度が動くことが仕様になる。
 *
 * ## 実装で踏むと痛い点
 *
 * - **`fitBounds` は枠の実寸を読む**。`next/dynamic` で遅れて差し込まれるので、
 *   構築の瞬間には枠がまだ最終の高さになっていないことがある。
 *   `load` 後に `resize()` してから合わせる (`terroir-lens-map.tsx` と同じ事故)
 * - **0 幅の矩形を渡すと最大ズームまで寄る**。最小の広がりはデータ層
 *   (`OVERVIEW_MIN_SPAN_LNG`) が保証しているので、ここでは矩形をそのまま使う
 * - **WebGL2 が無い環境では構築時に例外が飛ぶ**。一覧ページごと落とさないよう
 *   必ず捕まえ、地の色だけ残す
 *
 * 色はお茶のカテゴリー (`docs/roji-dataviz-rules.md`)。
 * DEM は Mapterhorn (キー不要)。帰属表示は画面内に必ず出す。
 */

import {
  MapLibreMap,
  Marker,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { TEA_CATEGORY_COLOR, TEA_CATEGORY_LABEL } from "@/lib/roji/tea-category";
import {
  ELEVATION_RAMP,
  TERROIR_BASE,
} from "@/lib/roji/tea-terroir";
import {
  terroirOverviewKey,
  type TerroirOverviewData,
  type TerroirOverviewPin,
} from "@/lib/roji/tea-terroir-overview";
import { DEM_ATTRIBUTION, DEM_TILEJSON_URL } from "@/lib/viz/dem";
import { MAPLIBRE_WORKER_URL } from "@/lib/viz/map-style";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/** 枠の縁から点までの最小の余白 (px)。`fitBounds` に渡す。 */
const FIT_PADDING = 44;
/** 寄りすぎの上限。1 点だけのときに地表が塗り絵にならない値。 */
const MAX_FIT_ZOOM = 9.6;

/** 県止まりの点の直径 (px)。市町村まで降りた点より小さくする。 */
const PIN_SIZE = { area: 9, prefecture: 7 } as const;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 産地の点。色はカテゴリー、大きさは座標の粒度。
 *
 * 生成りの縁を付けるのは、段彩の濃い側 (深い緑) に点が沈まないようにするため。
 * 単品ページの `createOriginPinElement` を使わないのは、あちらが 1 色 (graphite)
 * 固定で、色がカテゴリーを表すという恒久ルールに乗らないから。
 */
function createPinElement(pin: TerroirOverviewPin): HTMLElement {
  const size = pin.precision === "prefecture" ? PIN_SIZE.prefecture : PIN_SIZE.area;
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.backgroundColor = TEA_CATEGORY_COLOR[pin.category];
  el.style.boxShadow = `0 0 0 1.5px ${ROJI_VIZ_COLOR.kinari}`;
  el.style.opacity = pin.precision === "prefecture" ? "0.78" : "1";
  el.style.pointerEvents = "none";
  el.setAttribute("data-slot", "terroir-overview-pin");
  el.setAttribute("data-category", pin.category);
  return el;
}

export interface TerroirOverviewMapProps {
  data: TerroirOverviewData;
  /** スクリーンリーダー向けの説明。地図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function TerroirOverviewMap({ data, label, className }: TerroirOverviewMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  // 内容が本当に変わったときだけ画角を合わせ直すための鍵。
  // 一覧はサーバーで render し直されるので、オブジェクトの同一性は当てにならない。
  const dataKey = terroirOverviewKey(data);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = prefersReducedMotion();
    setWorkerUrl(MAPLIBRE_WORKER_URL);

    const style: StyleSpecification = {
      version: 8,
      sources: {
        dem: {
          type: "raster-dem",
          // 単品詳細の地図と同じ Mapterhorn。キー不要・CORS 開放。
          url: DEM_TILEJSON_URL,
        },
      },
      layers: [
        {
          id: "bg",
          type: "background",
          paint: { "background-color": ROJI_VIZ_COLOR.kinari },
        },
        {
          id: "relief",
          type: "color-relief",
          source: "dem",
          paint: {
            "color-relief-color": [
              "interpolate",
              ["linear"],
              ["elevation"],
              ...ELEVATION_RAMP.flat(),
            ],
            // 広い画角では段彩が強いと点が読めない。単品より一段落とす。
            "color-relief-opacity": TERROIR_BASE.elev.relief * 0.82,
          },
        },
        {
          id: "hillshade",
          type: "hillshade",
          source: "dem",
          paint: {
            "hillshade-method": "multidirectional",
            "hillshade-shadow-color": "rgba(40,50,34,0.42)",
            "hillshade-highlight-color": "rgba(255,253,246,0.18)",
            "hillshade-accent-color": "rgba(0,0,0,0)",
            "hillshade-exaggeration": TERROIR_BASE.elev.hillshade,
          },
        },
      ],
    } as StyleSpecification;

    let map: MapLibreMap | null = null;
    try {
      map = new MapLibreMap({
        container: host,
        style,
        center: [data.center.lng, data.center.lat],
        zoom: 5,
        // 静止画として扱う。ページのスクロールも奪わない。
        interactive: false,
        attributionControl: false,
        renderWorldCopies: false,
        fadeDuration: reduced ? 0 : 300,
      });
      mapRef.current = map;
    } catch (error) {
      // WebGL2 が無い環境。一覧ページごと落とさず、地の色だけ残す。
      console.warn("[terroir-overview] base map unavailable", error);
      mapRef.current = null;
      return;
    }

    const activeMap = map;
    activeMap.on("error", (event) => {
      console.warn("[terroir-overview] base map error", event.error);
    });

    const fit = () => {
      // 枠の実寸は構築時にはまだ確定していないことがある。合わせる直前に測り直す。
      activeMap.resize();
      activeMap.fitBounds(
        [
          [data.bounds.west, data.bounds.south],
          [data.bounds.east, data.bounds.north],
        ],
        { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, animate: false }
      );
    };

    if (activeMap.loaded()) fit();
    else activeMap.once("load", fit);

    for (const pin of data.pins) {
      const marker = new Marker({ element: createPinElement(pin), anchor: "center" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(activeMap);
      markersRef.current.push(marker);
    }

    // 枠の幅が変わると同じ矩形でも要るズームが変わる (BP をまたぐ / SP の
    // URL バー出入り)。合わせ直さないと点が枠の外へ出る。
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fit, 200);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      activeMap.remove();
      mapRef.current = null;
    };
    // `data` そのものではなく内容の鍵で組み直す (毎 render の作り直しを防ぐ)。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataKey が data の内容を代表する
  }, [dataKey]);

  /* maplibre は自分の canvas に `role="region" aria-label="Map"` を固定で付ける
     (`Map.Title` の既定文言)。器の div は既に `role="img" aria-label={label}` を
     持っているので、同じ地図が 2 つのアクセシブルな要素として現れるうえ、
     地図を複数並べると **全部が同名の region** になって landmark-unique (axe) に
     触れる (2026-08-18 の CI で実測。見本ページが 3 枚並べているため出た)。
     canvas 側にも実際のラベルを載せて区別できるようにする。読み上げの内容と
     しても "Map" より正確になる。
     `dataKey` を依存に含めるのは、地図が組み直された後に付け直すため。 */
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.setAttribute("aria-label", label);
  }, [label, dataKey]);

  return (
    <div data-slot="terroir-overview" className={cn("flex flex-col gap-3", className)}>
      <div
        className="relative h-64 w-full overflow-hidden rounded-sm lg:h-96"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        <div
          ref={hostRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
        />
      </div>

      {/* 凡例 = カテゴリー。絞り込みが 1 カテゴリーなら 1 行になる。 */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2" data-slot="terroir-overview-legend">
        {data.categories.map((category) => (
          <li
            key={category}
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-category={category}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: TEA_CATEGORY_COLOR[category] }}
            />
            {TEA_CATEGORY_LABEL[category]}
          </li>
        ))}
      </ul>

      {/* 帰属表示は法的義務 (Mapterhorn)。地図の中には文字を置かない原則に従い
          枠の外に出す (`terroir-lens-map.tsx` の但し書きと同じ扱い)。 */}
      <p className="roji-viz-caption text-xs text-muted-foreground">
        {DEM_ATTRIBUTION}
      </p>
    </div>
  );
}

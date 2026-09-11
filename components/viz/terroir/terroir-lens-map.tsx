"use client";

/**
 * 土地を読む — ひとつの地図、五つのレンズ。
 *
 * 位置とズームを固定した 1 枚の地図に、5 つのレンズを opacity だけで溶け替える。
 * 地図が動かないので、板 (SVG / Canvas) は一度作れば投影とずれない。
 *
 * | レンズ | 何を見せるか | 作り |
 * |---|---|---|
 * | 標高   | 段彩 + 多方向陰影 + 主曲線・計曲線 | MapLibre + SVG |
 * | 地形図 | 紙に刷った等高線。**計曲線に標高の数値** | SVG のみ (地図を伏せる) |
 * | 気候   | あたたかさのにじみ (水彩の縁) | Canvas + SVG filter |
 * | 土     | 仮の地質 4 分類の面と筆致 | Canvas |
 * | 茶園   | 薄暮に灯る園 | Canvas |
 *
 * **茶園の点はどのレンズにも残る**。点に触れると土地の性格カードが開き、
 * 園名・標高 (DEM 実測値)・土地の言葉・銘柄が出る。
 * **数値はカードの標高と地形図の計曲線だけ** — roji の「数字を出さない」原則の
 * 唯一の例外が標高である、という設計をそのまま持ち込んでいる。
 *
 * ## 実装で踏むと痛い点 (すべて実測で確かめた既知の罠)
 *
 * - **等高線のグリッドを粗くすると「ズレて見える」**。陰影の尾根より粗いと、
 *   同じ標高から作った線なのに別物に見える。逆に**にじみと地質面は粗くしないと
 *   成立しない** (細かいと霧の斑・迷彩柄になる)。線は細かく、面は粗く
 * - **SVG filter の変位は板の縁を破る**。`feDisplacementMap` は板の外から画素を
 *   引くので、枠ぴったりの canvas だと縁が破れた紙のように出る。**板を枠より
 *   `PLATE_MARGIN` px 大きく作り、縁を枠外へ追い出す**
 * - **薄暮の帳は思ったより濃く要る**。生成りの下地が明るいので 0.5 では山が
 *   石膏模型のように白く残る
 * - **計曲線のラベルはこの縮尺だと勝手に増える**。短い輪は飛ばし、間隔も広く取る
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド 候補 30 (30-terroir-interactive) +
 * 21-terroir-styles/05-labeled-contour (標高ラベル表現を 5 つ目のレンズに統合)。
 */

import { contours as d3contours } from "d3-contour";
import { MapLibreMap, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  CONTOUR_RAMP,
  ELEVATION_RAMP,
  SOIL_CLASSES,
  TERROIR_BASE,
  TERROIR_DISCLAIMER,
  TERROIR_LENSES,
  TERROIR_LENS_LABEL,
  TERROIR_SPAN_LNG,
  WARMTH_RAMP,
  type TerroirData,
  type TerroirLens,
} from "@/lib/roji/tea-terroir";
import {
  asContourValues,
  contourLabelSpots,
  contourToSvgPath,
} from "@/lib/viz/contour-path";
import {
  DEM_TILEJSON_URL,
  createScreenProjection,
  loadDem,
  smoothGrid,
  zoomForLngSpan,
  type Dem,
} from "@/lib/viz/dem";
import { MAPLIBRE_WORKER_URL } from "@/lib/viz/map-style";
import { NARROW_PLANE } from "@/lib/viz/quadrant";
import {
  ROJI_VIZ_COLOR,
  ROJI_VIZ_SERIF,
  clamp01,
  hexToRgb,
  rampFn,
  seededRandom,
} from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 板を枠より何 px 大きく作るか。にじみの縁を枠外へ追い出す「のりしろ」。 */
const PLATE_MARGIN = 48;
/** 画面横方向のサンプル数。線はこの細かさで起こす。 */
const FIELD_COLUMNS = 420;
/** 等高線の主曲線 / 計曲線 (m)。 */
const CONTOUR_STEP = 100;
const CONTOUR_INDEX = 500;
/** DEM のズーム。span 0.3 度なら 12 で 1 セルおよそ 16m。 */
const DEM_ZOOM = 12;

const warmColor = rampFn(WARMTH_RAMP);
const contourColor = rampFn(CONTOUR_RAMP);

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  return node;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}

/** 画面 (0..1) 基準でグリッドを bilinear 参照する。 */
function sampleGrid(
  grid: Float64Array,
  width: number,
  height: number,
  fx: number,
  fy: number
): number {
  const x = clamp01(fx) * width - 0.5;
  const y = clamp01(fy) * height - 0.5;
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(y)));
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const a = grid[y0 * width + x0];
  const b = grid[y0 * width + x0 + 1];
  const c = grid[(y0 + 1) * width + x0];
  const d = grid[(y0 + 1) * width + x0 + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** 仮の気温分布: 気温減率 + 南北のわずかな差 + なだらかなゆらぎ。 */
function temperatureAt(elevation: number, x: number, y: number): number {
  const base = 15.6 - (1 - y) * 0.35;
  const wobble =
    0.9 * Math.sin(x * 6.1 + 1.2) * Math.cos(y * 4.7 - 0.6) +
    0.5 * Math.sin(x * 11.3 - 2.4) * Math.sin(y * 9.1 + 0.8);
  return base - elevation * 0.0061 + wobble;
}

/** 仮の地質分類: 標高 + ゆらぎ。 */
function soilIndexAt(elevation: number, x: number, y: number): number {
  const wobble =
    150 * Math.sin(x * 7.3 + 0.4) * Math.cos(y * 5.9 - 1.1) +
    85 * Math.sin(x * 13.1 - 1.7) * Math.sin(y * 10.7 + 2.2);
  const v = elevation + wobble;
  if (v < SOIL_CLASSES[1].cut) return 0;
  if (v < SOIL_CLASSES[2].cut) return 1;
  if (v < SOIL_CLASSES[3].cut) return 2;
  return 3;
}

interface Lamp {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface TerroirGardenView {
  id: string;
  name: string;
  word: string;
  tea: string;
  /** DEM 実測の標高 (m)。引けなければ null。 */
  elevation: number | null;
  x: number;
  y: number;
}

export interface TerroirLensMapProps {
  data: TerroirData;
  /** スクリーンリーダー向けの説明。地図の中に説明文を置かないので必須。 */
  label: string;
  /** カードの見出しに使う語 (i18n 済み)。 */
  copy: {
    elevationUnit: string;
    teaLabel: string;
    close: string;
    hint: string;
  };
  className?: string;
}

export function TerroirLensMap({ data, label, copy, className }: TerroirLensMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const elevRef = useRef<SVGSVGElement>(null);
  const contourRef = useRef<SVGSVGElement>(null);
  const climRef = useRef<HTMLCanvasElement>(null);
  const soilRef = useRef<HTMLCanvasElement>(null);
  const teaRef = useRef<HTMLCanvasElement>(null);

  const mapRef = useRef<MapLibreMap | null>(null);
  const lampsRef = useRef<Lamp[]>([]);
  const lensRef = useRef<TerroirLens>("elev");

  const [lens, setLens] = useState<TerroirLens>("elev");
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * 基層 (段彩と陰影) の状態。`unavailable` は WebGL2 が無い環境。
   *
   * 板は基層と独立に組めるので、ここが `unavailable` でも図は成立する。
   * DOM に出しておくのは、**基層が出ていないことを黙って見逃さない**ため
   * (人の目には「淡い地図」と「地図が無い」の区別が付きにくい)。
   */
  const [baseState, setBaseState] = useState<"pending" | "ready" | "unavailable">(
    "pending"
  );
  /** 枠幅が大きく変わったら板を組み直す (投影が変わるため作り直しが要る)。 */
  const [rebuildKey, setRebuildKey] = useState(0);

  /**
   * 組み上がった板の情報を **どの組み立ての結果か** の刻印つきで持つ。
   *
   * 刻印を持たせるのは「組み直しの前に古い値を消す」ための setState を
   * effect の頭で撃たないため (`react-hooks/set-state-in-effect`)。刻印が
   * 今の `data` / `rebuildKey` と一致しないときは **古い結果として単に使わない**
   * ので、消す操作そのものが要らない。
   *
   * 枠の実寸をここに含めるのは、render 中に `hostRef.current.clientWidth` を
   * 読めないため (`react-hooks/refs`)。板を組んだときに測った値だけを見る。
   */
  const [plate, setPlate] = useState<{
    key: number;
    data: TerroirData;
    gardens: TerroirGardenView[];
    width: number;
    height: number;
  } | null>(null);

  const plateReady = plate !== null && plate.key === rebuildKey && plate.data === data;
  const gardens = plateReady ? plate.gardens : [];
  const frameSize = plateReady
    ? { width: plate.width, height: plate.height }
    : { width: 0, height: 0 };

  const bleedId = `roji-bleed-${useId().replace(/:/g, "")}`;

  /**
   * 灯の rAF ループから「いまどのレンズか」を読むための写し。
   *
   * ループは板を組んだ effect の中で 1 本だけ回っており、レンズが変わるたびに
   * 張り直すと灯の呼吸が途切れる。よってループは state ではなく ref を読む。
   * (render 中に代入すると `react-hooks/refs` に掛かるので effect で写す)
   */
  useEffect(() => {
    lensRef.current = lens;
  }, [lens]);

  /* ── 地図と板の組み立て (1 回きり。data / 枠幅が変わったら作り直す) ── */
  useEffect(() => {
    const host = hostRef.current;
    const mapHost = mapHostRef.current;
    if (!host || !mapHost) return;

    const abort = new AbortController();
    const buildKey = rebuildKey;
    const reduced = prefersReducedMotion();
    let disposed = false;
    let frame = 0;

    setWorkerUrl(MAPLIBRE_WORKER_URL);

    const style: StyleSpecification = {
      version: 8,
      sources: {
        dem: {
          type: "raster-dem",
          // MapLibre 側も同じ Mapterhorn を読む。板の等高線と陰影が
          // 同じ標高から起きるので、線と陰影がずれない。
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
            "color-relief-opacity": TERROIR_BASE.elev.relief,
            "color-relief-opacity-transition": { duration: 700, delay: 0 },
          },
        },
        {
          id: "hillshade",
          type: "hillshade",
          source: "dem",
          paint: {
            // 1 行足すだけで四方向からの光になり、稜線の襞が細かく出る。
            "hillshade-method": "multidirectional",
            "hillshade-shadow-color": "rgba(40,50,34,0.42)",
            "hillshade-highlight-color": "rgba(255,253,246,0.18)",
            "hillshade-accent-color": "rgba(0,0,0,0)",
            "hillshade-exaggeration": TERROIR_BASE.elev.hillshade,
            "hillshade-exaggeration-transition": { duration: 700, delay: 0 },
          },
        },
      ],
    } as StyleSpecification;

    const viewWidth = host.clientWidth || 640;
    const viewHeight = host.clientHeight || 480;
    const zoom = zoomForLngSpan(viewWidth, TERROIR_SPAN_LNG);

    /**
     * 板の投影。**地図とは独立に持つ**。
     *
     * 地図は `interactive: false` で動かないので投影は純粋な計算でしかなく、
     * 地図インスタンスから引く理由が無い。むしろ引くと、WebGL2 が無い環境で
     * 地図の構築が例外を投げたときに板まで 1 枚も出なくなる。
     */
    const projection = createScreenProjection({
      center: data.center,
      zoom,
      width: viewWidth,
      height: viewHeight,
    });

    // 地図 (段彩と陰影の基層) は無くても成立する層として扱う。
    let map: MapLibreMap | null = null;
    try {
      map = new MapLibreMap({
        container: mapHost,
        style,
        center: [data.center.lng, data.center.lat],
        zoom,
        // 位置・ズームは固定。板がずれないための前提であって、単なる好みではない。
        interactive: false,
        attributionControl: false,
        renderWorldCopies: false,
        fadeDuration: reduced ? 0 : 300,
      });
      mapRef.current = map;
    } catch (error) {
      // WebGL2 が無い環境 (古い端末・GPU 無効化・一部の headless) では
      // MapLibre が構築時に投げる。基層だけ諦めて板は組む。
      console.warn("[terroir-lens] base map unavailable, plates only", error);
      mapRef.current = null;
      // 例外は同期に飛ぶので、そのまま setState すると effect の本体から
      // 連鎖 render を起こす。次のマイクロタスクへ送って render の外に出す。
      queueMicrotask(() => {
        if (!disposed) setBaseState("unavailable");
      });
    }
    if (map) {
      // `load` はスタイルが立った時点。段彩と陰影のタイルまで出揃うのは `idle`。
      map.once("idle", () => {
        if (!disposed) setBaseState("ready");
      });
      map.on("error", (event) => {
        console.warn("[terroir-lens] base map error", event.error);
      });
    }

    const build = async () => {
      const activeMap = map;
      if (activeMap) {
        await new Promise<void>((resolve) => {
          if (activeMap.loaded()) resolve();
          else activeMap.once("load", () => resolve());
        });
        // MapLibre は構築時の枠の大きさで canvas を焼く。この図は
        // `next/dynamic` で遅れて差し込まれるので、構築の瞬間には枠がまだ
        // 最終の高さになっていないことがある (実測: 640px の枠に対して
        // 300px の canvas)。その差は CSS で引き伸ばされるだけなので**エラーも
        // 警告も出ず**、段彩と陰影が枠の上端に潰れて出る。組み上がった時点で
        // 測り直す。
        activeMap.resize();
      }
      if (disposed) return;

      const plateWidth = viewWidth + PLATE_MARGIN * 2;
      const plateHeight = viewHeight + PLATE_MARGIN * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      // 板が覆う範囲。板は枠より PLATE_MARGIN px 大きい。
      const nw = projection.unproject(-PLATE_MARGIN, -PLATE_MARGIN);
      const se = projection.unproject(viewWidth + PLATE_MARGIN, viewHeight + PLATE_MARGIN);
      const dem: Dem = await loadDem({
        z: DEM_ZOOM,
        view: { west: nw.lng, east: se.lng, north: nw.lat, south: se.lat },
        signal: abort.signal,
      });
      if (disposed) return;

      /* ── 板の座標系での標高グリッド ── */
      const gw = FIELD_COLUMNS;
      const gh = Math.max(2, Math.round((gw * plateHeight) / plateWidth));
      const field = new Float64Array(gw * gh);
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const point = projection.unproject(
            -PLATE_MARGIN + ((i + 0.5) * plateWidth) / gw,
            -PLATE_MARGIN + ((j + 0.5) * plateHeight) / gh
          );
          const uv = dem.toUv(point.lng, point.lat);
          field[j * gw + i] = dem.elevationAtUv(clamp01(uv[0]), clamp01(uv[1]));
        }
      }
      let minElev = Infinity;
      let maxElev = -Infinity;
      for (let i = 0; i < field.length; i++) {
        if (field[i] < minElev) minElev = field[i];
        if (field[i] > maxElev) maxElev = field[i];
      }

      /** 面積平均で粗いグリッドを作る (にじみ・土の面はここから描く)。 */
      const coarsen = (columns: number) => {
        const rows = Math.max(2, Math.round((columns * gh) / gw));
        const out = new Float64Array(columns * rows);
        const sx = gw / columns;
        const sy = gh / rows;
        for (let j = 0; j < rows; j++) {
          const j0 = Math.floor(j * sy);
          const j1 = Math.max(j0 + 1, Math.min(gh, Math.floor((j + 1) * sy)));
          for (let i = 0; i < columns; i++) {
            const i0 = Math.floor(i * sx);
            const i1 = Math.max(i0 + 1, Math.min(gw, Math.floor((i + 1) * sx)));
            let sum = 0;
            let count = 0;
            for (let jj = j0; jj < j1; jj++) {
              for (let ii = i0; ii < i1; ii++) {
                sum += field[jj * gw + ii];
                count++;
              }
            }
            out[j * columns + i] = sum / count;
          }
        }
        return { grid: out, width: columns, height: rows };
      };

      const smoothed = smoothGrid(field, gw, gh, 1);
      const lowest = Math.ceil(minElev / CONTOUR_STEP) * CONTOUR_STEP;
      const thresholds: number[] = [];
      for (let v = lowest; v < maxElev; v += CONTOUR_STEP) thresholds.push(v);
      const bands = d3contours().size([gw, gh]).thresholds(thresholds)(asContourValues(smoothed));

      /* ── レンズ 1: 標高 (段彩は地図側 / ここは線だけ) ── */
      const elevSvg = elevRef.current;
      if (elevSvg) {
        while (elevSvg.firstChild) elevSvg.removeChild(elevSvg.firstChild);
        elevSvg.setAttribute("viewBox", `-0.5 -0.5 ${gw} ${gh}`);
        const lines = el("g", { fill: "none" });
        for (const band of bands) {
          const isIndex = band.value % CONTOUR_INDEX === 0;
          lines.appendChild(
            el("path", {
              d: contourToSvgPath(band),
              stroke: ROJI_VIZ_COLOR.sumi,
              "stroke-width": isIndex ? 0.7 : 0.3,
              "stroke-opacity": isIndex ? 0.42 : 0.17,
              "stroke-linejoin": "round",
              "vector-effect": "non-scaling-stroke",
            })
          );
        }
        elevSvg.appendChild(lines);
      }

      /* ── レンズ 2: 地形図 (紙に刷った等高線・計曲線に標高) ── */
      const contourSvg = contourRef.current;
      if (contourSvg) {
        while (contourSvg.firstChild) contourSvg.removeChild(contourSvg.firstChild);
        contourSvg.setAttribute("viewBox", `-0.5 -0.5 ${gw} ${gh}`);
        contourSvg.appendChild(
          el("rect", {
            x: -1,
            y: -1,
            width: gw + 2,
            height: gh + 2,
            fill: ROJI_VIZ_COLOR.kinari,
          })
        );
        // 面: 段彩を淡く敷く (線が主役なので彩度は抑える)
        const fills = el("g", {});
        for (const band of bands) {
          fills.appendChild(
            el("path", {
              d: contourToSvgPath(band),
              fill: rgbCss(contourColor(band.value)),
              stroke: "none",
            })
          );
        }
        contourSvg.appendChild(fills);

        const lines = el("g", { fill: "none" });
        const labels = el("g", {});
        // 見た目の字の大きさは板の px で決めたいので、viewBox 単位へ換算する。
        const unit = gw / plateWidth;
        const labelSize = 9 * unit;
        for (const band of bands) {
          const isIndex = band.value % CONTOUR_INDEX === 0;
          lines.appendChild(
            el("path", {
              d: contourToSvgPath(band),
              stroke: ROJI_VIZ_COLOR.sumi,
              "stroke-width": isIndex ? 0.62 : 0.2,
              "stroke-opacity": isIndex ? 0.72 : 0.34,
              "stroke-linejoin": "round",
              "vector-effect": "non-scaling-stroke",
            })
          );
          if (!isIndex) continue;
          const spots = contourLabelSpots(band, {
            minRingLength: gw * 0.18,
            spacing: gw * 0.34,
          });
          for (const spot of spots) {
            const text = el("text", {
              transform: `translate(${spot.x},${spot.y}) rotate(${spot.angle})`,
              "text-anchor": "middle",
              dy: "0.34em",
              "font-family": ROJI_VIZ_SERIF,
              "font-size": labelSize,
              fill: ROJI_VIZ_COLOR.sumi,
              "fill-opacity": 0.82,
              // 紙色の縁取りで線を白抜きし、数値が線に埋もれないようにする。
              stroke: ROJI_VIZ_COLOR.kinari,
              "stroke-width": labelSize * 0.42,
              "stroke-opacity": 0.9,
              "paint-order": "stroke",
              "stroke-linejoin": "round",
            });
            text.textContent = String(band.value);
            labels.appendChild(text);
          }
        }
        contourSvg.appendChild(lines);
        contourSvg.appendChild(labels);
      }

      /* ── レンズ 3: 気候 (あたたかさのにじみ) ── */
      const climCanvas = climRef.current;
      if (climCanvas) {
        climCanvas.width = Math.round(plateWidth * dpr);
        climCanvas.height = Math.round(plateHeight * dpr);
        const ctx = climCanvas.getContext("2d");
        if (ctx) {
          // にじみなので粗いグリッドから描く。細かいと霧の斑になる。
          const coarse = coarsen(110);
          const off = document.createElement("canvas");
          off.width = coarse.width;
          off.height = coarse.height;
          const octx = off.getContext("2d");
          if (octx) {
            const image = octx.createImageData(coarse.width, coarse.height);
            for (let j = 0; j < coarse.height; j++) {
              for (let i = 0; i < coarse.width; i++) {
                const e = coarse.grid[j * coarse.width + i];
                const x = (i + 0.5) / coarse.width;
                const y = (j + 0.5) / coarse.height;
                const t = temperatureAt(e, x, y);
                // 水彩らしさ: 連続色 65% + 0.5 度刻みの段 35% (縁が立つ)
                const stepped = Math.round(t * 2) / 2;
                const a = warmColor(t);
                const b = warmColor(stepped);
                const p = (j * coarse.width + i) * 4;
                image.data[p] = a[0] + (b[0] - a[0]) * 0.35;
                image.data[p + 1] = a[1] + (b[1] - a[1]) * 0.35;
                image.data[p + 2] = a[2] + (b[2] - a[2]) * 0.35;
                image.data[p + 3] = 224;
              }
            }
            octx.putImageData(image, 0, 0);
            ctx.clearRect(0, 0, climCanvas.width, climCanvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(off, 0, 0, climCanvas.width, climCanvas.height);
          }
        }
      }

      /* ── レンズ 4: 土 (面 + 筆致) ── */
      const soilCanvas = soilRef.current;
      if (soilCanvas) {
        soilCanvas.width = Math.round(plateWidth * dpr);
        soilCanvas.height = Math.round(plateHeight * dpr);
        const ctx = soilCanvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, plateWidth, plateHeight);

          // 面: 地質図の面は手で塗った塊なので、粗いグリッドから描いて境界を
          // 大きく取る (標高グリッドのままだと迷彩柄になる)。
          const coarse = coarsen(130);
          const off = document.createElement("canvas");
          off.width = coarse.width;
          off.height = coarse.height;
          const octx = off.getContext("2d");
          if (octx) {
            const image = octx.createImageData(coarse.width, coarse.height);
            const tints = SOIL_CLASSES.map((s) => hexToRgb(s.tint));
            for (let j = 0; j < coarse.height; j++) {
              for (let i = 0; i < coarse.width; i++) {
                const k = soilIndexAt(
                  coarse.grid[j * coarse.width + i],
                  (i + 0.5) / coarse.width,
                  (j + 0.5) / coarse.height
                );
                const p = (j * coarse.width + i) * 4;
                image.data[p] = tints[k][0];
                image.data[p + 1] = tints[k][1];
                image.data[p + 2] = tints[k][2];
                image.data[p + 3] = 208;
              }
            }
            octx.putImageData(image, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(off, 0, 0, plateWidth, plateHeight);
          }

          // 手: 分類ごとの筆致を撒く (乱数は固定種で毎回同じ絵になる)
          const rnd = seededRandom(20260817);
          const spacing = 11;
          ctx.lineCap = "round";
          for (let y = spacing * 0.5; y < plateHeight; y += spacing) {
            for (let x = spacing * 0.5; x < plateWidth; x += spacing) {
              const jx = x + (rnd() - 0.5) * spacing;
              const jy = y + (rnd() - 0.5) * spacing;
              const nx = jx / plateWidth;
              const ny = jy / plateHeight;
              // 面と同じ粗さで拾う (色と筆致が一致する)
              const k = soilIndexAt(
                sampleGrid(coarse.grid, coarse.width, coarse.height, nx, ny),
                nx,
                ny
              );
              const soil = SOIL_CLASSES[k];
              if (rnd() > soil.density) continue;
              ctx.strokeStyle = soil.ink;
              ctx.fillStyle = soil.ink;
              ctx.globalAlpha = 0.17 + rnd() * 0.13;
              if (soil.mark === "dot") {
                ctx.beginPath();
                ctx.arc(jx, jy, 0.8 + rnd() * 0.45, 0, Math.PI * 2);
                ctx.fill();
              } else if (soil.mark === "slash") {
                ctx.lineWidth = 0.65;
                ctx.beginPath();
                ctx.moveTo(jx - 2.2, jy + 1.9);
                ctx.lineTo(jx + 2.2, jy - 1.9);
                ctx.stroke();
              } else if (soil.mark === "bar") {
                ctx.lineWidth = 0.9;
                ctx.beginPath();
                ctx.moveTo(jx - 2.9, jy);
                ctx.lineTo(jx + 2.9, jy);
                ctx.stroke();
              } else {
                ctx.lineWidth = 0.6;
                ctx.beginPath();
                ctx.moveTo(jx - 1.9, jy);
                ctx.lineTo(jx + 1.9, jy);
                ctx.moveTo(jx, jy - 1.9);
                ctx.lineTo(jx, jy + 1.9);
                ctx.stroke();
              }
            }
          }
          ctx.globalAlpha = 1;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }

      /* ── 茶園の点 (どのレンズでも残る) ── */
      const lampScale = Math.min(1.05, Math.max(0.42, viewWidth / 1600));
      const views: TerroirGardenView[] = [];
      const lamps: Lamp[] = [];
      for (const garden of data.gardens) {
        const projected = projection.project(garden.lng, garden.lat);
        const elevation = dem.elevationAt(garden.lng, garden.lat);
        const rounded = elevation === null ? null : Math.round(elevation);
        views.push({
          id: garden.id,
          name: garden.name,
          word: garden.word,
          tea: garden.tea,
          elevation: rounded,
          x: projected.x,
          y: projected.y,
        });
        lamps.push({
          id: garden.id,
          x: projected.x,
          y: projected.y,
          // 高い園ほど灯がわずかに大きい。
          radius: (86 + (rounded ?? 300) * 0.045) * lampScale,
        });
      }
      lampsRef.current = lamps;

      /* ── レンズ 5: 茶園 (薄暮 + 行灯) ── */
      const teaCanvas = teaRef.current;
      const drawTea = (time: number) => {
        if (!teaCanvas) return;
        const ctx = teaCanvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewWidth, viewHeight);

        // 薄暮の帳。生成りの下地が明るいので、薄いと山が石膏模型のように白く残る。
        const veil = ctx.createRadialGradient(
          viewWidth * 0.5,
          viewHeight * 0.5,
          0,
          viewWidth * 0.5,
          viewHeight * 0.5,
          Math.hypot(viewWidth, viewHeight) * 0.6
        );
        veil.addColorStop(0, "rgba(26,28,22,0.68)");
        veil.addColorStop(1, "rgba(18,20,16,0.86)");
        ctx.fillStyle = veil;
        ctx.fillRect(0, 0, viewWidth, viewHeight);

        ctx.globalCompositeOperation = "lighter";
        lampsRef.current.forEach((lamp, index) => {
          const phase = time * 0.00075 + index * 1.7;
          const brightness = 0.86 + 0.14 * Math.sin(phase);
          const radius = lamp.radius * (1 + 0.05 * Math.sin(phase * 0.83 + 0.6));
          const gradient = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, radius);
          gradient.addColorStop(0.0, `rgba(247,232,196,${0.5 * brightness})`);
          gradient.addColorStop(0.18, `rgba(238,214,164,${0.3 * brightness})`);
          gradient.addColorStop(0.5, `rgba(206,178,124,${0.11 * brightness})`);
          gradient.addColorStop(1.0, "rgba(180,152,102,0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(lamp.x, lamp.y, radius, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalCompositeOperation = "source-over";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      };

      if (teaCanvas) {
        teaCanvas.width = Math.round(viewWidth * dpr);
        teaCanvas.height = Math.round(viewHeight * dpr);
        drawTea(0);
      }

      setPlate({
        key: buildKey,
        data,
        gardens: views,
        width: viewWidth,
        height: viewHeight,
      });

      if (!reduced) {
        // 灯だけが動く。他のレンズは静止画なので、茶園レンズのときしか描き直さない。
        const tick = (time: number) => {
          if (lensRef.current === "tea") drawTea(time);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }
    };

    build().catch((error) => {
      if (abort.signal.aborted) return;
      // 標高タイルが引けなくても地図の基層は出る。黙って壊れるより、
      // 「板が無い状態」で立たせて、レンズ切替を標高だけに畳む。
      console.error("[terroir-lens] plate build failed", error);
    });

    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      map?.remove();
      mapRef.current = null;
    };
    // 枠幅の変化そのものではなく、ResizeObserver が「大きく変わった」と判定した
    // ときにだけ `rebuildKey` が進む。スクロールバーの出入りで組み直さないため。
  }, [data, rebuildKey]);

  /* ── レンズ切替: 基層の濃さも一緒に動かす ── */
  useEffect(() => {
    const map = mapRef.current;
    // 基層が無い (WebGL2 の無い環境) ときは板だけで成立するので何もしない。
    if (!map || !map.loaded() || !map.getLayer("relief")) return;
    const base = TERROIR_BASE[lens];
    map.setPaintProperty("relief", "color-relief-opacity", base.relief);
    map.setPaintProperty("hillshade", "hillshade-exaggeration", base.hillshade);
  }, [lens]);

  /* ── 枠の大きさが変わったら組み直す ── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let last = host.clientWidth;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      // 基層は板の組み直しを待たずに追随させる (canvas を焼き直すだけで安い)。
      mapRef.current?.resize();
      const next = host.clientWidth;
      if (Math.abs(next - last) < 24) return;
      last = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 投影が変わるとカードの位置が意味を失うので先に畳む。
        setOpenId(null);
        setRebuildKey((k) => k + 1);
      }, 260);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const openGarden = gardens.find((g) => g.id === openId) ?? null;
  const dark = lens === "tea";
  // 4 象限の図と同じ境目を使う (`lib/viz/quadrant.ts` の NARROW_PLANE)。
  // 枠がまだ測れていない (width 0) 間は広い枠として扱い、名前を消さない。
  const narrow = frameSize.width > 0 && frameSize.width < NARROW_PLANE;

  const handleSelect = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const plateClass = (active: boolean) =>
    cn(
      "absolute block transition-opacity duration-700 ease-in-out",
      // 板は枠より一回り大きい (`PLATE_MARGIN`)。にじみの縁を枠外へ逃がす。
      "-inset-12",
      active ? "opacity-100" : "opacity-0"
    );

  return (
    <div
      data-slot="terroir-lens"
      data-lens={lens}
      data-base={baseState}
      className={cn("flex flex-col gap-4", className)}
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={label}
        className="relative h-120 w-full overflow-hidden lg:h-160"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        {/* 高さを `inset-0` に頼らない。MapLibre は起動時に container へ
            `.maplibregl-map` を付け、そのスタイル (maplibre-gl.css) が
            `position: relative` を当てて **Tailwind の `absolute` を打ち消す**。
            すると絶対配置で決まっていた高さが消えて container が 0 になり、
            MapLibre は既定の 300px にフォールバックする。**エラーも警告も出ず**
            段彩と陰影だけが枠の上端に潰れて出る (実測: 640px の枠に 300px)。
            `h-full w-full` で高さを自前に持たせれば position に依存しない。 */}
        <div ref={mapHostRef} className="absolute inset-0 h-full w-full" />

        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <svg ref={elevRef} className={plateClass(lens === "elev")} preserveAspectRatio="none" />
          <svg
            ref={contourRef}
            className={plateClass(lens === "contour")}
            preserveAspectRatio="none"
          />
          <canvas
            ref={climRef}
            className={plateClass(lens === "clim")}
            style={{ filter: `url(#${bleedId})` }}
          />
          <canvas ref={soilRef} className={plateClass(lens === "soil")} />
          <canvas
            ref={teaRef}
            className={cn(
              "absolute inset-0 block h-full w-full transition-opacity duration-700 ease-in-out",
              lens === "tea" ? "opacity-100" : "opacity-0"
            )}
          />
        </div>

        {/* にじみ (気候レンズの水彩ぼかし)。板の外から画素を引くので、
            板を枠より大きく作ってあることが前提。 */}
        <svg className="pointer-events-none absolute size-0" aria-hidden="true">
          <filter
            id={bleedId}
            x="-6%"
            y="-6%"
            width="112%"
            height="112%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011 0.015"
              numOctaves={3}
              seed={7}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale={26}
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation={3.2} />
          </filter>
        </svg>

        {/* 茶園の点。どのレンズでも残る。 */}
        <div className="absolute inset-0">
          {gardens.map((garden) => (
            <button
              key={garden.id}
              type="button"
              data-slot="terroir-plot"
              data-selected={openId === garden.id ? "true" : undefined}
              onClick={() => handleSelect(garden.id)}
              style={{ left: garden.x, top: garden.y }}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-3 py-2.5 text-center whitespace-nowrap"
            >
              <span
                aria-hidden="true"
                data-slot="terroir-plot-dot"
                className={cn(
                  "mx-auto block size-2 rounded-full border transition-all duration-300",
                  dark
                    ? "border-brand-gold/70 bg-brand-gold/80"
                    : "border-brand-graphite bg-background",
                  openId === garden.id && !dark && "bg-brand-graphite"
                )}
                // 灯そのものの滲み。トークンの elevation shadow は「面が浮く」
                // 影で、光が滲む表現には使えないのでここだけ実値で書く。
                style={dark ? { boxShadow: "0 0 10px rgba(240,220,176,0.85)" } : undefined}
              />
              {/* 狭い枠では園の名前を出さない。5 園ぶんの名前を並べると SP 幅では
                  隣の園の名前と重なって、どちらも読めなくなる (実測: 390px 幅で
                  「尾根下の園」と「谷あいの園」が重なった)。名前は点に触れた
                  ときのカードで出るので、情報は失われない。 */}
              {narrow ? null : (
                <span
                  className={cn(
                    "roji-viz-caption mt-1.5 block text-xs transition-colors duration-700",
                    dark ? "text-brand-cream/80" : "text-foreground/80"
                  )}
                >
                  {garden.name}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 土地の性格カード。標高だけが実測値。 */}
        {openGarden ? (
          <div
            data-slot="terroir-card"
            className={cn(
              "absolute z-10 w-52 rounded-sm border border-brand-stone/60 bg-background p-4 shadow-lg",
              // 枠の上半分の点は下に開く。上に開くと奥 (北) の別の園を覆う。
              openGarden.y < frameSize.height * 0.45 ? "translate-y-5" : "-translate-y-full"
            )}
            style={{
              // カードが枠からはみ出さないよう左右に折り返す (幅 208 + 余白 8)。
              left: Math.min(
                Math.max(openGarden.x + 16, 8),
                Math.max(8, frameSize.width - 216)
              ),
              top: openGarden.y,
            }}
          >
            <p className="roji-viz-caption-wide text-sm text-foreground">{openGarden.name}</p>
            <p className="roji-viz-caption mt-2 text-xs text-muted-foreground">
              {copy.elevationUnit.replace(
                "{value}",
                openGarden.elevation === null ? "—" : String(openGarden.elevation)
              )}
            </p>
            <div className="mt-3 h-px w-full bg-border" aria-hidden="true" />
            <p className="roji-viz-caption mt-3 text-xs leading-relaxed text-foreground">
              {openGarden.word}
            </p>
            <p className="roji-viz-caption mt-3 text-xs text-muted-foreground">
              {copy.teaLabel} {openGarden.tea}
            </p>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="roji-viz-caption mt-3 text-xs text-muted-foreground underline underline-offset-4"
            >
              {copy.close}
            </button>
          </div>
        ) : null}
      </div>

      {/* 操作と凡例は地図の外に置く。地図の中に文字を重ねない原則 (産地の地図と同じ)。 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <nav aria-label={label} className="flex flex-wrap gap-x-5 gap-y-2">
          {TERROIR_LENSES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={lens === item}
              onClick={() => setLens(item)}
              disabled={!plateReady && item !== "elev"}
              className={cn(
                "roji-viz-caption-wide border-b pb-1 text-xs transition-colors duration-300",
                lens === item
                  ? "border-brand-graphite text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                !plateReady && item !== "elev" && "opacity-40"
              )}
            >
              {TERROIR_LENS_LABEL[item]}
            </button>
          ))}
        </nav>
        <p className="roji-viz-caption text-xs text-muted-foreground">{copy.hint}</p>
      </div>

      <TerroirLegend lens={lens} />

      <p className="roji-viz-caption text-xs text-muted-foreground">{TERROIR_DISCLAIMER}</p>
    </div>
  );
}

/** 凡例。レンズと一緒に入れ替わる。数値は標高だけ (roji 原則の唯一の例外)。 */
function TerroirLegend({ lens }: { lens: TerroirLens }) {
  if (lens === "elev" || lens === "contour") {
    const ramp = lens === "contour" ? CONTOUR_RAMP : ELEVATION_RAMP;
    const lo = ramp[0][0];
    const hi = ramp[ramp.length - 1][0];
    const stops = ramp
      .map(([v, c]) => `${c} ${Math.round(((v - lo) / (hi - lo)) * 100)}%`)
      .join(",");
    return (
      <div data-slot="terroir-legend" className="flex items-center gap-3">
        <span className="roji-viz-caption-wide text-xs text-muted-foreground">標 高 m</span>
        <span
          aria-hidden="true"
          className="block h-2.5 w-40 border border-brand-stone/50"
          style={{ background: `linear-gradient(to right, ${stops})` }}
        />
        <span className="roji-viz-caption text-xs text-muted-foreground">
          {lo} — {hi}
        </span>
      </div>
    );
  }

  if (lens === "clim") {
    const lo = WARMTH_RAMP[0][0];
    const hi = WARMTH_RAMP[WARMTH_RAMP.length - 1][0];
    const stops = WARMTH_RAMP.map(
      ([v, c]) => `${c} ${Math.round(((v - lo) / (hi - lo)) * 100)}%`
    ).join(",");
    return (
      <div data-slot="terroir-legend" className="flex items-center gap-3">
        <span className="roji-viz-caption-wide text-xs text-muted-foreground">あ た た か さ</span>
        <span
          aria-hidden="true"
          className="block h-2.5 w-40 border border-brand-stone/50"
          style={{ background: `linear-gradient(to right, ${stops})` }}
        />
        <span className="roji-viz-caption text-xs text-muted-foreground">
          す ず し い / あ た た か い
        </span>
      </div>
    );
  }

  if (lens === "soil") {
    return (
      <ul data-slot="terroir-legend" className="flex flex-wrap gap-x-5 gap-y-2">
        {SOIL_CLASSES.map((soil) => (
          <li key={soil.name} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="block h-3 w-5 border border-brand-stone/40"
              style={{ backgroundColor: soil.tint }}
            />
            {soil.name}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-slot="terroir-legend" className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="block size-3 rounded-full bg-brand-gold/80"
        style={{ boxShadow: "0 0 9px rgba(235,214,168,0.9)" }}
      />
      灯 一 つ が 一 園
    </div>
  );
}

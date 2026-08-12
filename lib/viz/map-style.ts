/**
 * 産地の地図のスタイルと画角。MapLibre を読み込まない純ロジック。
 *
 * ## この地図が「地図ウィジェット」ではない理由
 *
 * 用途は「産地を指す」ことだけで、経路案内でも風景の生成表現でもない。だから
 * 既定の地図スタイルから経路・施設・地名・地形をすべて落とし、残すのは
 * **陸のかたち・県の区切り・産地の点** の 3 つに限る。海は青く塗らず、ページの
 * 紙 (cream) のままにして陸だけを sand に沈める。こうすると地図はウィジェットではなく
 * 紙に引かれた一枚の図になる。
 *
 * 正本は Figma:
 * - 地図スタイル仕様 https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8221-24
 * - ピン意匠 (採用案 A 点と輪) https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8221-25
 * - 品目ページ PC https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-3
 * - 品目ページ SP https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-26
 *
 * データ選定の根拠 (Natural Earth / MapLibre / タイルサーバー不要):
 * https://www.notion.so/3ba70c9d064c817e8d29fc622f5c4dbd
 *
 * ## なぜ色を CSS 変数で渡さないか
 *
 * MapLibre の paint プロパティは CSS ではなく独自の色パーサで解釈されるので
 * `var(--color-brand-sand)` も `oklch(...)` も渡せない。よって
 * `lib/viz/theme-palette.ts` と同じやり方を採る — トークンの OKLCH 実値をここに
 * 写し、`oklchToHex` で hex に落として渡す。写しがトークンからずれたら
 * `__tests__/roji-map-style.test.ts` が `dist/tokens.css` を読んで落とす。
 */

import type { StyleSpecification } from "maplibre-gl";

import { oklchToHex, type Oklch } from "./color";

/**
 * 地図が使う色。`dist/tokens.css` の `--color-brand-*` の写し。
 * キーはトークン名と 1:1 で、ここで別名を作らない (対応を目で追えるようにするため)。
 */
export const MAP_TOKEN_COLORS = {
  /** 海・地。紙そのもの。青は一切使わない。 */
  cream: { l: 0.933, c: 0.012, h: 96.4 },
  /** 陸。標高・植生・用途で色を変えない単一色。 */
  sand: { l: 0.863, c: 0.026, h: 102.0 },
  /** 海岸線 (100%) と県境 (40%)。 */
  stone: { l: 0.742, c: 0.017, h: 102.9 },
  /** ピン (通常)。 */
  graphite: { l: 0.397, c: 0.002, h: 247.9 },
  /** ピン (選択)。品目ページでは使わないが、意匠の正本として持つ。 */
  "tea-red": { l: 0.572, c: 0.133, h: 16.4 },
} as const satisfies Record<string, Oklch>;

export type MapTokenName = keyof typeof MAP_TOKEN_COLORS;

/** トークン名から `#rrggbb` を引く。 */
export function mapColor(name: MapTokenName): string {
  return oklchToHex(MAP_TOKEN_COLORS[name]);
}

/**
 * maplibre-gl の Worker スクリプトの置き場。
 *
 * MapLibre は GeoJSON の解析を Worker で行うが、Worker の URL を
 * `import.meta.url` から組み立てる。Turbopack はこれを自前の内部値に書き換えるので
 * `^https?:` の判定に落ち、**Worker URL が空文字になって GeoJSON が 1 バイトも
 * 解析されない** (枠と DOM のピンだけが出て陸が出ない)。よって MapLibre 公式の
 * Turbopack 手順どおり `public/` から配って `setWorkerUrl` で明示する。
 *
 * 実体は `scripts/copy-maplibre-worker.mjs` が node_modules から複製する。
 * この写しがずれたら `__tests__/roji-map-style.test.ts` が落ちる。
 */
export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/** 地形データの置き場。ビルド済みの静的ファイルで、タイルサーバーは介在しない。 */
export const GEO_DATA = {
  land: "/geo/jp-land.geojson",
  prefBorders: "/geo/jp-pref-borders.geojson",
} as const;

/**
 * 線の太さ。Figma のレイヤー可視表 (node 8221:24) の実測値。
 * 海岸線が県境より太いのは、地図で最も強い線が海岸線だと決めているため。
 */
export const LINE_WIDTH = {
  coastline: 0.75,
  prefBorder: 0.5,
} as const;

/** 県境の不透明度。海岸線は 1.00。 */
export const PREF_BORDER_OPACITY = 0.4;

/**
 * 品目ページの小地図の zoom。
 *
 * Figma のフレーム名 `map/静岡・駿河湾 z7.35` が正本。同フレームの仕様テキストには
 * 「zoom 8.2」とあるが、モックの実描画を計測すると z ≒ 7.4 (経度基準・緯度基準の
 * どちらでも 7.47〜7.54) で、8.2 では 1.8 倍に寄って別の画角になる。
 * **見た目 (モック) を正本と解し 7.35 を採る**。この食い違いは PR で申告済み。
 */
export const ITEM_MAP_ZOOM = 7.35;

/**
 * ピンを画面上端から何 px の位置に置くか。
 *
 * 仕様は「点が画面の上寄り (高さの 1/4 付近) に来るよう center を南へずらす」。
 * Figma の PC (210 高) と SP (180 高) はどちらもピンが上端から 57px にあり、
 * 比率 (27.1% / 31.7%) ではなく **px が一致する**。同じ 1 枚の描画を高さだけ
 * 詰めて使う設計なので、px 固定をそのまま規則にする。
 */
export const PIN_TOP_PX = 57;

/** 品目ページの地図の寸法 (Figma 実測)。 */
export const ITEM_MAP_SIZE = {
  /** PC 1280 の品目ページ。 */
  pc: { width: 400, height: 210 },
  /** SP 375 の品目ページ。幅は 375 - 余白 20x2。 */
  sp: { width: 335, height: 180 },
} as const;

/** MapLibre のタイル 1 枚の px。world の幅は `TILE_SIZE * 2^zoom`。 */
const TILE_SIZE = 512;

export interface LngLat {
  lng: number;
  lat: number;
}

/** 緯度 -> Web Mercator の正規化 y (0 = 北端, 1 = 南端)。 */
function mercatorY(lat: number): number {
  const clamped = Math.min(85.051129, Math.max(-85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

/** Web Mercator の正規化 y -> 緯度。`mercatorY` の逆関数。 */
function latFromMercatorY(y: number): number {
  return (
    ((2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * 180) /
    Math.PI
  );
}

/**
 * 産地の座標を画面上端から `pinTopPx` の位置に置くための center を求める。
 *
 * MapLibre の `easeTo({ offset })` でも同じことができるが、それはカメラ操作
 * (= アニメーション) の API なので、静止画として扱うこの地図では使わない。
 * center を先に確定して `jumpTo` する方が、`prefers-reduced-motion` の分岐も
 * リサイズ時の再計算も 1 本の純関数で説明できる。
 */
export function centerForPin(
  point: LngLat,
  { zoom, height, pinTopPx = PIN_TOP_PX }: { zoom: number; height: number; pinTopPx?: number },
): LngLat {
  const worldPx = TILE_SIZE * Math.pow(2, zoom);
  // 画面中心はピンより (height/2 - pinTopPx) px だけ下 = 南にある。
  const centerY = mercatorY(point.lat) + (height / 2 - pinTopPx) / worldPx;
  return { lng: point.lng, lat: latFromMercatorY(centerY) };
}

/**
 * 産地の地図のスタイル。ソース 2 つ・レイヤー 4 つで足りる。
 *
 * 描画順は背景 -> 陸 -> 県境 -> 海岸線。県境を先に敷いて海岸線を上に重ねるのは、
 * 河口など両者が接する場所で「地図で最も強い線」が勝つようにするため。
 *
 * @param reducedMotion true なら paint プロパティのトランジションを 0 にする。
 */
export function originMapStyle({ reducedMotion = false } = {}): StyleSpecification {
  return {
    version: 8,
    // 地名ラベルを 1 つも描かないのでフォントの取得先 (glyphs) は要らない。
    //
    // ここで `glyphs: undefined` と **書いてはいけない**。MapLibre のスタイル検査は
    // 値ではなくキーの存在を見るので、キーが生えているだけで
    // `glyphs: string expected, undefined found` に落ち、スタイルの読み込みが
    // そこで中止される。ソースは 1 本も取りに行かれず、地図は真っ白のままになる。
    // 要らないキーは値を undefined にするのではなく、書かない。
    sources: {
      "jp-land": { type: "geojson", data: GEO_DATA.land },
      "jp-pref": { type: "geojson", data: GEO_DATA.prefBorders },
    },
    transition: reducedMotion ? { duration: 0, delay: 0 } : { duration: 300, delay: 0 },
    layers: [
      {
        // 海は塗らない。ページの紙色をそのまま地にする。
        id: "paper",
        type: "background",
        paint: { "background-color": mapColor("cream") },
      },
      {
        id: "land",
        type: "fill",
        source: "jp-land",
        paint: { "fill-color": mapColor("sand") },
      },
      {
        id: "pref-border",
        type: "line",
        source: "jp-pref",
        paint: {
          "line-color": mapColor("stone"),
          "line-opacity": PREF_BORDER_OPACITY,
          "line-width": LINE_WIDTH.prefBorder,
        },
      },
      {
        id: "coastline",
        type: "line",
        source: "jp-land",
        paint: {
          "line-color": mapColor("stone"),
          "line-width": LINE_WIDTH.coastline,
        },
      },
    ],
  };
}

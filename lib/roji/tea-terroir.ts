/**
 * 「土地を読む」(テロワール) のデータ層。
 *
 * ## 何が実測で、何が仮なのか
 *
 * - **標高だけが実測**。Mapterhorn の DEM タイル (terrarium 形式・キー不要) を
 *   そのまま読んで数値を出す。roji は数値を画面に出さないのが原則で、標高が
 *   唯一の例外 (`lib/viz/roji-viz-palette.ts` 冒頭)。
 * - **気候・土・茶園の位置は仮**。標高から導いているので地形とは矛盾しないが、
 *   実測値ではない。画面右下にその旨を必ず出す (`TERROIR_DISCLAIMER`)。
 *
 * ## いまはダミー、あとで実データに差し替える
 *
 * 茶園の位置・土地の言葉は Notion の Tea Menu List / 仕入先の情報がいずれ正本に
 * なる。`tea-flavor.ts` / `tea-aroma.ts` と同じく **この層だけがダミーを持つ**。
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド 候補 30 (30-terroir-interactive) +
 * 21-terroir-styles/05-labeled-contour (標高ラベル表現を 5 つ目のレンズに統合)。
 */

import { seededRandom } from "@/lib/viz/roji-viz-palette";

/** レンズ。`contour` が 21-5 の標高ラベル表現を持ち込んだ 5 つ目。 */
export type TerroirLens = "elev" | "contour" | "clim" | "soil" | "tea";

export const TERROIR_LENSES: readonly TerroirLens[] = [
  "elev",
  "contour",
  "clim",
  "soil",
  "tea",
];

export const TERROIR_LENS_LABEL: Record<TerroirLens, string> = {
  elev: "標 高",
  contour: "地 形 図",
  clim: "気 候",
  soil: "土",
  tea: "茶 園",
};

/**
 * レンズごとの基層 (段彩・陰影) の出し方。
 *
 * `contour` は SVG 側で紙と段彩を全面に敷くので、地図の基層は落としきる
 * (0 にすると MapLibre 側が「レイヤーが消えた」ように見えるので、
 * 陰影だけごく薄く残して地形と紙がずれていないことを確認できるようにする)。
 */
export const TERROIR_BASE: Record<
  TerroirLens,
  { relief: number; hillshade: number }
> = {
  elev: { relief: 1.0, hillshade: 0.26 },
  contour: { relief: 0.0, hillshade: 0.0 },
  clim: { relief: 0.2, hillshade: 0.13 },
  soil: { relief: 0.3, hillshade: 0.16 },
  tea: { relief: 0.22, hillshade: 0.15 },
};

/** 標高 → 色 (段彩)。地図の `color-relief` と凡例カラーバーが共有する。 */
export const ELEVATION_RAMP: readonly (readonly [number, string])[] = [
  [100, "#F1ECDD"],
  [300, "#E0DAC1"],
  [500, "#C6CCA6"],
  [700, "#A6B489"],
  [900, "#87996F"],
  [1200, "#65785A"],
  [1620, "#47573F"],
];

/**
 * 地形図レンズの段彩。標高レンズより 1 段淡い。
 *
 * 地形図は **線が主役**なので、面は線を邪魔しない濃さまで落とす
 * (21-5 の実装値をそのまま持ち込んだ)。
 */
export const CONTOUR_RAMP: readonly (readonly [number, string])[] = [
  [100, "#F3EEE1"],
  [300, "#E7E1CC"],
  [500, "#D5D3B6"],
  [700, "#BCC49F"],
  [900, "#A0AE88"],
  [1200, "#7E9070"],
  [1600, "#5D7059"],
];

/**
 * あたたかさの色域。
 *
 * 実測レンジ (この画角でおよそ 6〜15 度) に張る。4 度から張ると涼しい側の色が
 * 余り、尾根が「ただの灰色」になる (verdicts.md 候補 30 詰まった点 4)。
 */
export const WARMTH_RAMP: readonly (readonly [number, string])[] = [
  [6.0, "#93A1A4"],
  [8.3, "#AEB4AE"],
  [10.3, "#C8C7B7"],
  [12.2, "#DCD3BA"],
  [13.9, "#E4CFA6"],
  [15.3, "#E9CD99"],
];

/** 土の仮分類 4 種。地色の明度差をはっきり取らないと「どこが何か」が読めない。 */
export interface SoilClass {
  name: string;
  /** 面の地色。 */
  tint: string;
  /** 筆致の色。 */
  ink: string;
  /** 筆致の種類。 */
  mark: "dot" | "slash" | "bar" | "cross";
  /** 撒く密度 (0..1)。 */
  density: number;
  /** この分類に入る標高の下限 (ゆらぎを足した値で判定する)。 */
  cut: number;
}

export const SOIL_CLASSES: readonly SoilClass[] = [
  { name: "河 岸 の 砂 礫", tint: "#EFE9D6", ink: "#6E6A57", mark: "dot", density: 0.34, cut: 0 },
  { name: "粘 土 質", tint: "#DBD0AE", ink: "#5E6250", mark: "slash", density: 0.5, cut: 330 },
  { name: "腐 植 質", tint: "#BEC69F", ink: "#48513E", mark: "bar", density: 0.7, cut: 700 },
  { name: "岩 盤 ・ 礫", tint: "#A7AE8E", ink: "#39412F", mark: "cross", density: 0.52, cut: 1030 },
];

/** 茶園 (仮)。標高だけは DEM の実測値をカードに出す。 */
export interface TerroirGarden {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** 土地の言葉。数値の代わりに置く。 */
  word: string;
  /** その土地の銘柄 (仮)。 */
  tea: string;
}

/** 中心からの相対配置 (度)。どこを中心にしても画角に収まる散り方にしてある。 */
const GARDEN_SEEDS: readonly {
  id: string;
  name: string;
  dLng: number;
  dLat: number;
  word: string;
  tea: string;
}[] = [
  { id: "tanima", name: "谷 あ い の 園", dLng: 0.007, dLat: 0.034, word: "霧 の 多 い 谷 あ い", tea: "川 霧" },
  { id: "oneshita", name: "尾 根 下 の 園", dLng: 0.029, dLat: 0.055, word: "風 の 抜 け る 尾 根 下", tea: "峰 越" },
  { id: "iwa", name: "岩 地 の 園", dLng: 0.066, dLat: 0.007, word: "岩 の 多 い 急 斜 面", tea: "岩 清 水" },
  { id: "minamidan", name: "南 段 の 園", dLng: -0.01, dLat: -0.027, word: "日 の 長 い 南 の 段", tea: "日 向 段" },
  { id: "higashi", name: "東 斜 の 園", dLng: -0.052, dLat: -0.049, word: "朝 日 の 遅 い 東 斜 面", tea: "片 陰" },
];

/** roji の主産地。産地が引けない銘柄はここに落とす。 */
export const TERROIR_FALLBACK = {
  center: { lng: 138.1, lat: 35.05 },
  placeLabel: "川 根 本 町 ・ 大 井 川 流 域",
} as const;

/** 地図の画角。DEM の切り出し窓もこの span から決まる。 */
export const TERROIR_ZOOM = 11.84;
/** DEM を切り出す経度幅 (度)。TERROIR_ZOOM の画角より一回り広く取る。 */
export const TERROIR_SPAN_LNG = 0.3068;

export interface TerroirData {
  center: { lng: number; lat: number };
  /** 画面に出す土地の名 (産地名 or 既定の主産地)。 */
  placeLabel: string;
  gardens: readonly TerroirGarden[];
}

/** 画面右下に必ず出す但し書き。 */
export const TERROIR_DISCLAIMER =
  "DEM (C) Mapterhorn ・ 気 候 と 土 と 茶 園 の 位 置 は 仮";

/**
 * 産地の座標からテロワールのデータを組む。
 *
 * 茶園は中心からの相対配置で置く。中心が動いても画角から外れないので、
 * 産地が変わっても「点が 1 つも見えない地図」にならない。
 */
export function terroirDataFor(
  origin: { lat: number | null; lng: number | null },
  placeLabel: string | null
): TerroirData {
  const center =
    origin.lat === null || origin.lng === null
      ? TERROIR_FALLBACK.center
      : { lng: origin.lng, lat: origin.lat };
  const label =
    origin.lat === null || origin.lng === null || !placeLabel
      ? TERROIR_FALLBACK.placeLabel
      : placeLabel;

  // 位置の微差は種を固定した乱数で足す。中心が同じなら毎回同じ場所に立つ。
  const rnd = seededRandom(Math.round((center.lng + center.lat) * 10000));
  const gardens = GARDEN_SEEDS.map((g) => ({
    id: g.id,
    name: g.name,
    word: g.word,
    tea: g.tea,
    lng: center.lng + g.dLng + (rnd() - 0.5) * 0.012,
    lat: center.lat + g.dLat + (rnd() - 0.5) * 0.008,
  }));

  return { center, placeLabel: label, gardens };
}

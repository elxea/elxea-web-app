/**
 * 「画面の中心をどこに置き、どれだけの範囲を 1 画面に収めるか」を決める純関数。
 *
 * 画面 (DOM / Canvas) を知らないので Vitest で検査できる。カメラ
 * (`components/viz/profile/camera.ts`) はここが返した値を px に写すだけで、
 * 「どこが中心か」の判断は持たない。
 *
 * ## なぜこのファイルが要るのか (実測した不具合)
 *
 * 段1の実装は **world 座標の原点 (0,0) を「自分」と見なして画面中心に固定**し、
 * 倍率も画面の大きさとデータの広がりに関係のない定数 (40px / world-unit) だった。
 * どちらも成り立っていない。
 *
 *   - お茶の面の写像B は `y = 香り + 味わい ∈ [2,10]` なので、**原点は
 *     嗜好空間の中に無い**。生成データ 240 人の重心は緑茶 (0.64, 5.84) /
 *     紅茶 (0.57, 7.24) / 青茶 (1.67, 4.65) にあり、画面中心から
 *     198〜291px も右下にずれて描かれていた (1024×640 の板・実測 2026-09-06)。
 *     画面が読み上げる「自分は中心にいて」と絵が食い違う。
 *   - 読み物・イベントの面の座標は -1..1 の正規化空間なので、40px/unit では
 *     **言葉の野が 70×67px** にしかならず、1024×640 の板の真ん中で 18 個の札が
 *     団子になっていた (重なり実測 74/153 対)。
 *
 * どちらも「中心」と「倍率」をデータから決めていないことが原因なので、両方を
 * ここで 1 度だけ決める。
 *
 * ## 中心は自分。自分が居ないときは「みんな」の重心
 *
 * ズームの中心は常に自分 (Decision Log
 * https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac — 「自分中心に
 * ズームするのは特別扱いではない。個と全体のつながりを自覚するプロセス」)。
 * 未ログインでは `self` が 401 で落ちて自分の粒がそもそも描かれないので、
 * そのときは**みんなの分布の重心**を中心に据える。どちらの場合も「画面の
 * まんなかが、この面の主体」という読み方が崩れない。
 */

import { teaAxisBbox } from "@/lib/profile/axes";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import type {
  ProfileFacet,
  ProfileFieldResponse,
  ProfileSelfResponse,
  ProfileWordsResponse,
} from "@/lib/profile/contract";

/** 言葉の面 (読み物 / イベント) の座標は語彙表の正規化空間 (-1..1)。 */
const WORD_FACET_BBOX: [number, number, number, number] = [-1, -1, 1, 1];

/**
 * 面ごとの既定 bbox。API・描画・story の 3 か所に同じ数値を書かないための正本
 * (段1は 3 か所に `[-9,-9,9,9]` がべた書きされていた)。
 */
export function profileFieldBbox(facet: ProfileFacet): [number, number, number, number] {
  return facet === "tea" ? teaAxisBbox() : [...WORD_FACET_BBOX];
}

export interface FramingPoint {
  x: number;
  y: number;
}

export interface FramingRadius {
  /** 中心から左右に、1 画面へ収めたい world 距離。 */
  rx: number;
  /** 中心から上下に、1 画面へ収めたい world 距離。 */
  ry: number;
}

/** `sceneFraming` の入力。`ProfileScene` (描画側の型) と同じ形を構造で受ける。 */
export interface FramingScene {
  self: ProfileSelfResponse | null;
  field: ProfileFieldResponse | null;
  words: ProfileWordsResponse | null;
}

export interface SceneFraming {
  /** 画面中心に据える world 座標。 */
  anchor: FramingPoint;
  /** `anchor` が何に由来するか (報告・テストで「なぜそこか」を言えるように持つ)。 */
  anchorOf: "self" | "field" | "words" | "bbox";
  radius: FramingRadius;
}

/**
 * 「みんなの居る所」と見なす格子セルの下限 (0..255)。
 *
 * 箱ぼかし (`buildDensityGrid`) の裾は本体から離れた所まで薄く伸びるので、
 * 0 より大きいセルを全部数えると **ぼかしの裾に合わせて縮尺が決まり**、肝心の
 * 山が小さく写る。ピークの約 1 割を下限にして「人が居ると言える濃さ」だけを
 * 収める対象にする。
 */
const DENSITY_FLOOR = 26;

/** 収めたい範囲の外周に置くわずかな余裕 (縁にぴったり付けない)。 */
const RADIUS_MARGIN = 1.06;

/** 0 除算と、点が 1 個しか無いときの発散を止める下限。 */
const MIN_RADIUS = 0.05;

/** 倍率の下限 (px / world-unit)。データが空でも板が真っ白にならないように。 */
const MIN_SCALE = 1;

interface DensityCell extends FramingPoint {
  v: number;
}

/** 密度格子を world 座標のセル中心 + 値へほどく。`grid` が無ければ空。 */
function densityCells(field: ProfileFieldResponse | null): DensityCell[] {
  const grid = field?.grid;
  if (!field || !grid) return [];
  const u8 = decodeU8FromBase64(grid.data);
  const [x0, y0, x1, y1] = field.bbox;
  const cellW = (x1 - x0) / grid.w;
  const cellH = (y1 - y0) / grid.h;
  const out: DensityCell[] = [];
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const v = u8[j * grid.w + i] ?? 0;
      if (v <= 0) continue;
      out.push({ x: x0 + (i + 0.5) * cellW, y: y0 + (j + 0.5) * cellH, v });
    }
  }
  return out;
}

/** 言葉の札の位置 (三層すべて)。 */
function wordPoints(words: ProfileWordsResponse | null): FramingPoint[] {
  if (!words) return [];
  return [...words.general, ...words.shared, ...words.personal].map((w) => ({ x: w.x, y: w.y }));
}

/** 濃度で重み付けした重心。空なら null。 */
function weightedCentroid(cells: readonly DensityCell[]): FramingPoint | null {
  let x = 0;
  let y = 0;
  let t = 0;
  for (const c of cells) {
    x += c.x * c.v;
    y += c.y * c.v;
    t += c.v;
  }
  if (t <= 0) return null;
  return { x: x / t, y: y / t };
}

function meanPoint(points: readonly FramingPoint[]): FramingPoint | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * この面で「1 画面に収めたい中身」と「その中心」を決める。
 *
 * 中心の優先順位は 自分 → みんなの重心 → 言葉の重心 → bbox の中央。
 * 半径は中心から見た中身の広がりで、**自分を中心に置いてもみんなが板から
 * はみ出さない**ように、自分・みんな・言葉のすべてを覆う。
 */
export function sceneFraming(scene: FramingScene, facet: ProfileFacet): SceneFraming {
  const bbox = scene.field?.grid ? scene.field.bbox : profileFieldBbox(facet);
  const cells = densityCells(scene.field);
  const words = wordPoints(scene.words);
  const self = scene.self?.centroid ?? null;

  const anchorFromField = weightedCentroid(cells);
  const anchorFromWords = meanPoint(words);
  const bboxCenter: FramingPoint = { x: (bbox[0] + bbox[2]) / 2, y: (bbox[1] + bbox[3]) / 2 };

  let anchor: FramingPoint;
  let anchorOf: SceneFraming["anchorOf"];
  if (self) {
    anchor = { x: self.x, y: self.y };
    anchorOf = "self";
  } else if (anchorFromField) {
    anchor = anchorFromField;
    anchorOf = "field";
  } else if (anchorFromWords) {
    anchor = anchorFromWords;
    anchorOf = "words";
  } else {
    anchor = bboxCenter;
    anchorOf = "bbox";
  }

  /* 収める対象。格子は「人が居ると言える濃さ」だけを見るが、そこまで濃い
     セルが 1 つも無い面 (sparse) では 0 より大きいセルへ落とす。 */
  const dense = cells.filter((c) => c.v >= DENSITY_FLOOR);
  const contents: FramingPoint[] = [...(dense.length > 0 ? dense : cells), ...words];
  if (self) {
    const spread = Math.max(0, scene.self?.spread ?? 0);
    contents.push({ x: self.x - spread, y: self.y - spread }, { x: self.x + spread, y: self.y + spread });
  }

  let rx = 0;
  let ry = 0;
  for (const p of contents) {
    rx = Math.max(rx, Math.abs(p.x - anchor.x));
    ry = Math.max(ry, Math.abs(p.y - anchor.y));
  }
  if (contents.length === 0) {
    /* 何も無い面 (quiet) は bbox の半分を収める — 空の板でも縮尺が決まる。 */
    rx = (bbox[2] - bbox[0]) / 2;
    ry = (bbox[3] - bbox[1]) / 2;
  }

  return {
    anchor,
    anchorOf,
    radius: {
      rx: Math.max(MIN_RADIUS, rx * RADIUS_MARGIN),
      ry: Math.max(MIN_RADIUS, ry * RADIUS_MARGIN),
    },
  };
}

/**
 * ×1 (z=0) のときの px / world-unit。
 *
 * 「中身が板の short 側に収まる」ように決めるので、板の縦横比が変わっても
 * 中身は必ず全部見え、余白は中心の周りに対称に付く (絵が下に寄って上が
 * 空く、が起きない)。`padding` は板の縁と中身のあいだに残す px。
 */
export function fitBaseScale(
  radius: FramingRadius,
  viewW: number,
  viewH: number,
  padding: number,
): number {
  const halfW = Math.max(1, viewW / 2 - padding);
  const halfH = Math.max(1, viewH / 2 - padding);
  const sx = halfW / Math.max(MIN_RADIUS, radius.rx);
  const sy = halfH / Math.max(MIN_RADIUS, radius.ry);
  return Math.max(MIN_SCALE, Math.min(sx, sy));
}

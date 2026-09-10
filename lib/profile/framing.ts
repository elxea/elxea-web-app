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
 * ## 中心は自分。自分が居ないときは「中身の真ん中」
 *
 * ズームの中心は常に自分 (Decision Log
 * https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac — 「自分中心に
 * ズームするのは特別扱いではない。個と全体のつながりを自覚するプロセス」)。
 * 未ログインでは `self` が 401 で落ちて自分の粒がそもそも描かれないので、
 * そのときは**描くもの全体の外接矩形の中心**に据える (2026-09-06 訂正 —
 * 旧実装の「みんなの重心」が余白の偏りと『輪の穴を中心に据える』を生んでいた。
 * 理由は `sceneFraming` の doc comment)。
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
  anchorOf: "self" | "content" | "bbox";
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

/**
 * 板の左右の縁と中身のあいだに残す px。
 *
 * 右端の縦置きスライダーは、当たり判定こそ 44px あるが**目に見える部分は
 * つまみ 12px + 右余白 6px + 中央寄せの逃げ 16px = 板の縁から 34px** までしか
 * 来ない (`app/globals.css` の `.roji-zoom-slider::-webkit-slider-thumb`)。
 * その 34px を越える最小の丸い値を取る。旧実装の 56px は当たり判定ぶんまで
 * 見込んだ値で、短辺 358px の板では左右で 31% を余白に使っていた。
 */
export const PROFILE_VIEW_PADDING_X = 36;

/**
 * 板の上下の縁と中身のあいだに残す px。
 *
 * 上下にはスライダーが無いので、左右と同じだけ取る理由が無い。
 */
export const PROFILE_VIEW_PADDING_Y = 28;

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

/** 点群の外接矩形。空なら null。 */
function boundsOf(
  points: readonly FramingPoint[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * この面で「1 画面に収めたい中身」と「その中心」を決める。
 *
 * ## 中心
 *
 * 自分が居れば自分 (確定要件)。居なければ**中身の外接矩形の中心**。
 *
 * 旧実装は自分が居ないとき「みんなの重心 (濃度で重み付けした平均)」を中心に
 * 据えていた。重心は中身の真ん中とは限らないので、
 *
 *   - 半径 (`radius`) は中心から見た最遠点で決まる → 中身が中心の片側に偏って
 *     いると、**反対側にだけ大きな余白が残る**。独立 QA の実測では下の余白が
 *     上の 1.8 倍あった。
 *   - 読み物・イベントの面は語彙表が象限の名を輪のように配るので、重心は
 *     **輪の内側の穴**に落ちる。そこは誰も居ない場所である。
 *
 * どちらも「中心をデータの平均で決めた」ことが原因なので、自分が居ないときは
 * 平均ではなく**外接矩形の中心**にする。中心の両側の距離が定義から等しくなり、
 * 余白は上下・左右とも必ず等しくなる (`__tests__/profile-framing.test.ts` で
 * 固定)。
 */
export function sceneFraming(scene: FramingScene, facet: ProfileFacet): SceneFraming {
  const bbox = scene.field?.grid ? scene.field.bbox : profileFieldBbox(facet);
  const cells = densityCells(scene.field);
  const words = wordPoints(scene.words);
  const self = scene.self?.centroid ?? null;

  /* 収める対象。格子は「人が居ると言える濃さ」だけを見るが、そこまで濃い
     セルが 1 つも無い面 (sparse) では 0 より大きいセルへ落とす。 */
  const dense = cells.filter((c) => c.v >= DENSITY_FLOOR);
  const contents: FramingPoint[] = [...(dense.length > 0 ? dense : cells), ...words];
  if (self) {
    const spread = Math.max(0, scene.self?.spread ?? 0);
    contents.push({ x: self.x - spread, y: self.y - spread }, { x: self.x + spread, y: self.y + spread });
  }

  const bboxCenter: FramingPoint = { x: (bbox[0] + bbox[2]) / 2, y: (bbox[1] + bbox[3]) / 2 };
  const extent = boundsOf(contents);

  let anchor: FramingPoint;
  let anchorOf: SceneFraming["anchorOf"];
  if (self) {
    anchor = { x: self.x, y: self.y };
    anchorOf = "self";
  } else if (extent) {
    anchor = { x: (extent.x0 + extent.x1) / 2, y: (extent.y0 + extent.y1) / 2 };
    anchorOf = "content";
  } else {
    anchor = bboxCenter;
    anchorOf = "bbox";
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
 * ×1 (z=0) のときの px / world-unit。全段で同じ値を使う
 * (`components/viz/profile/camera.ts` の「倍率段 `z` は『拡大率』ではなく
 * 『細かさ』である」参照 — 段が変わっても枠は動かない)。
 *
 * 「中身が板に収まる」ように決めるので、板の縦横比が変わっても中身は必ず全部
 * 見え、余白は中心の周りに対称に付く。
 *
 * `paddingX` / `paddingY` を分けるのは、**逃げが要るのは左右だけ**だから
 * (右端に縦置きの倍率スライダーが乗る)。四方を同じ 56px にしていた旧実装は、
 * 短辺 480px の板で 23% を余白に使っていた (独立 QA 指摘「板が空きすぎている」)。
 */
export function fitBaseScale(
  radius: FramingRadius,
  viewW: number,
  viewH: number,
  paddingX: number = PROFILE_VIEW_PADDING_X,
  paddingY: number = PROFILE_VIEW_PADDING_Y,
): number {
  const halfW = Math.max(1, viewW / 2 - paddingX);
  const halfH = Math.max(1, viewH / 2 - paddingY);
  const sx = halfW / Math.max(MIN_RADIUS, radius.rx);
  const sy = halfH / Math.max(MIN_RADIUS, radius.ry);
  return Math.max(MIN_SCALE, Math.min(sx, sy));
}

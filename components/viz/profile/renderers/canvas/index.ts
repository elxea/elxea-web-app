/**
 * 暫定の描き手 (Canvas 2D)。`ProfileRenderer` の唯一の実装として段1に含める。
 *
 * 見た目は暫定・差し替え前提 (Figma 確定後に別実装を1つ足すだけで済む — これが
 * `ProfileRenderer` インターフェースを切る理由)。既存5コンポーネント
 * (`footprints-scene` 等) と同じく Canvas 2D + `devicePixelRatio` を2で頭打ち
 * にする作法。等高線は `d3-contour` (既存依存) + `lib/viz/contour-path.ts`
 * (既存の道具) をそのまま使う。
 *
 * Spec §「Canvas 2Dを続ける (WebGLは保留)」参照。
 */

import { contours } from "d3-contour";
import type { ContourMultiPolygon } from "d3-contour";

import { asContourValues, traceContour } from "@/lib/viz/contour-path";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, rampFn } from "@/lib/viz/roji-viz-palette";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import { placeLabels, type LabelCandidate } from "@/lib/profile/labels";
import { PROFILE_WASH_MIN_VALUE, PROFILE_WORDS_FRAME_BUDGET } from "@/lib/profile/thresholds";
import { worldToScreen } from "@/components/viz/profile/camera";
import type {
  CameraState,
  DrawStats,
  ProfileRenderer,
  ProfileScene,
} from "@/components/viz/profile/renderer";
import type { ProfileFieldResponse, ProfileWordsResponse } from "@/lib/profile/contract";

const WASH_RAMP = rampFn([
  [0, ROJI_VIZ_COLOR.kinari],
  [0.5, ROJI_VIZ_COLOR.usukoke],
  [1, ROJI_VIZ_COLOR.koke],
]);

/**
 * 言葉の三層。数が小さいほど先に場所を取る (粗い語から立つ)。
 *
 * ## 読める濃さを持たせる (独立 QA 実測 2026-09-06 の是正)
 *
 * 旧実装の一般語は淡い苔 (`usukoke`) を 65% で置いており、紙 (`kinari`) に対する
 * コントラストは **1.48〜2.23:1** しかなかった (可読の基準は 4.5:1)。ここを
 * 深緑 (`fukamidori`) の全不透明にして **5.32:1** にする。共通語・個人語は墨
 * (`sumi`) の全不透明で **12.6:1**。
 *
 * ## 「自分」と「他者」は明度とウェイトで分ける
 *
 * 色数は増やさない (roji の単色系を崩さない)。分けるのは 3 つだけ —
 * 一般語 = 深緑・少し大きい (地に近い層) / 共通語 = 墨・標準ウェイト /
 * 個人語 (= 常に**自分の言葉**) = 墨・太い。淡さで区別すると読めなくなるので、
 * 濃さの下限を割らない範囲でだけ差をつける。
 *
 * ## 黒・近黒の扱い
 *
 * 墨 (`sumi` #2B2B2B) は**文字・記号のインクとしては可**。禁じているのは
 * 背景・大面積に敷くこと (Setaka の元の言葉は「黒背景が怖い」)。この判定は色の
 * 値ではなく**面積**で行い、「輝度 40 未満の画素が描画領域の 0.5% 以下」を
 * `profile-stage.stories.tsx` の機械検査が実画素で固定している。
 */
export const WORD_LAYERS = [
  { key: "general", size: 15, weight: 400, color: ROJI_VIZ_COLOR.fukamidori, priority: 0 },
  { key: "shared", size: 13, weight: 400, color: ROJI_VIZ_COLOR.sumi, priority: 1 },
  { key: "personal", size: 13, weight: 600, color: ROJI_VIZ_COLOR.sumi, priority: 2 },
] as const;

/** 字の下に敷く紙の色の板 (ノックアウト) の余白 px。 */
const WORD_PLATE_PAD_X = 5;
const WORD_PLATE_PAD_Y = 3;

export class CanvasProfileRenderer implements ProfileRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private reducedMotion = false;
  /**
   * 等高線の生成結果の使い回し。`d3-contour` は毎フレーム回すには重く、格子
   * (`grid.data`) と水準が変わらない限り結果も変わらない。カメラだけが動く
   * ズーム中に同じ計算を 60 回/秒やり直さない。
   */
  private contourCache: { key: string; polys: ContourMultiPolygon[] } | null = null;
  /**
   * 密度格子を 1 枚の画像にしたもの。格子が変わらない限り作り直さない。
   *
   * セルを 1 つずつ `fillRect` で塗ると、寄ったときに**セルがそのまま巨大な
   * 平らな四角**になって場が読めない (×10 で 1 セル 116px、×100 で 1,160px)。
   * 画像として引き伸ばせばブラウザの補間が効き、どの倍率でも濃度の勾配として
   * 読める。ついでに 1 フレームの描画命令が最大 6,144 回から 1 回になる。
   */
  private washCache: { key: string; image: HTMLCanvasElement } | null = null;

  mount(host: HTMLElement, opts: { reducedMotion: boolean }): void {
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.reducedMotion = opts.reducedMotion;
  }

  resize(w: number, h: number, dpr: number): void {
    if (!this.canvas) return;
    // SP実機30fps予算の守り方: dpr = min(devicePixelRatio, 2) (Spec §予算表)。
    const cappedDpr = Math.min(dpr, 2);
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * cappedDpr);
    this.canvas.height = Math.round(h * cappedDpr);
    this.ctx?.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
  }

  draw(scene: ProfileScene, camera: CameraState): DrawStats {
    const stats: DrawStats = { drawn: 0, culled: 0, offscreen: 0 };
    const ctx = this.ctx;
    if (!ctx) return stats;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.fillStyle = ROJI_VIZ_COLOR.kinari;
    ctx.fillRect(0, 0, w, h);

    if (scene.field?.grid) {
      this.drawFieldWash(ctx, scene.field, camera, w, h, stats);
      this.drawContours(ctx, scene.field, camera, w, h);
    }
    if (scene.words) {
      this.drawWords(ctx, scene.words, camera, w, h, stats);
    }
    if (scene.self?.centroid) {
      this.drawSelf(ctx, scene.self.centroid, scene.self.spread ?? 0.3, camera, w, h, stats);
    }

    ctx.restore();
    return stats;
  }

  destroy(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.contourCache = null;
    this.washCache = null;
  }

  /** 密度格子 → 1 枚の画像 (セル 1 つ = 画素 1 つ)。格子が変わるまで使い回す。 */
  private washImageFor(field: ProfileFieldResponse): HTMLCanvasElement | null {
    const grid = field.grid;
    if (!grid) return null;
    const key = `${grid.w}x${grid.h}:${grid.data}`;
    if (this.washCache?.key === key) return this.washCache.image;

    const u8 = decodeU8FromBase64(grid.data);
    const image = document.createElement("canvas");
    image.width = grid.w;
    image.height = grid.h;
    const ictx = image.getContext("2d");
    if (!ictx) return null;
    const buffer = ictx.createImageData(grid.w, grid.h);
    for (let i = 0; i < grid.w * grid.h; i++) {
      const v = u8[i] ?? 0;
      const o = i * 4;
      if (v <= PROFILE_WASH_MIN_VALUE) {
        buffer.data[o + 3] = 0;
        continue;
      }
      const [r, g, b] = WASH_RAMP(v / 255);
      buffer.data[o] = Math.round(r);
      buffer.data[o + 1] = Math.round(g);
      buffer.data[o + 2] = Math.round(b);
      buffer.data[o + 3] = Math.round(0.55 * v);
    }
    ictx.putImageData(buffer, 0, 0);
    this.washCache = { key, image };
    return image;
  }

  private drawFieldWash(
    ctx: CanvasRenderingContext2D,
    field: ProfileFieldResponse,
    camera: CameraState,
    w: number,
    h: number,
    stats: DrawStats,
  ): void {
    const grid = field.grid;
    if (!grid) return;
    const image = this.washImageFor(field);
    if (!image) return;

    const [x0, y0, x1, y1] = field.bbox;
    const topLeft = worldToScreen(camera, x0, y0, w, h);
    const bottomRight = worldToScreen(camera, x1, y1, w, h);
    const destW = bottomRight.x - topLeft.x;
    const destH = bottomRight.y - topLeft.y;
    if (!(destW > 0) || !(destH > 0)) return;

    /* 画面に入っている部分だけを切り出して描く。寄ると引き伸ばし先が数万 px に
       なるので、はみ出したぶんまで一度に描かせない (端末によっては極端な拡大で
       目に見えて遅くなる)。 */
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const u0 = clamp01((0 - topLeft.x) / destW);
    const u1 = clamp01((w - topLeft.x) / destW);
    const v0 = clamp01((0 - topLeft.y) / destH);
    const v1 = clamp01((h - topLeft.y) / destH);
    if (u1 <= u0 || v1 <= v0) {
      stats.offscreen++;
      return;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      u0 * grid.w,
      v0 * grid.h,
      (u1 - u0) * grid.w,
      (v1 - v0) * grid.h,
      topLeft.x + u0 * destW,
      topLeft.y + v0 * destH,
      (u1 - u0) * destW,
      (v1 - v0) * destH,
    );
    ctx.restore();
    stats.drawn++;
  }

  private contoursFor(field: ProfileFieldResponse): ContourMultiPolygon[] {
    const grid = field.grid;
    if (!grid) return [];
    const key = `${grid.w}x${grid.h}:${field.levels.join(",")}:${grid.data}`;
    if (this.contourCache?.key === key) return this.contourCache.polys;
    const u8 = decodeU8FromBase64(grid.data);
    const values = new Float64Array(u8.length);
    for (let i = 0; i < u8.length; i++) values[i] = u8[i];
    const gen = contours()
      .size([grid.w, grid.h])
      .thresholds(field.levels.map((l) => l * 255));
    const polys = gen(asContourValues(values));
    this.contourCache = { key, polys };
    return polys;
  }

  /**
   * 等高線。**地の面 (`drawFieldWash`) と同じカメラで写す。**
   *
   * 旧実装は `w / grid.w` で板いっぱいに引き伸ばしていた (カメラを一切見て
   * いなかった) ため、線と地の濃淡が別の場所に描かれ、寄っても線だけが動かな
   * かった。等高線の座標は格子の添字空間 (値がセル中心にある) なので、半セル
   * ずらしてから world → screen に写す。
   *
   * 線の太さは変換の外で決める: パスを変換下で積んでから CTM を戻して stroke
   * すると、セルの縦横比が 1 でなくても線幅が一定になる (Canvas はパス構築時の
   * CTM で座標を、stroke 時の CTM でペンを解決する)。
   */
  private drawContours(
    ctx: CanvasRenderingContext2D,
    field: ProfileFieldResponse,
    camera: CameraState,
    w: number,
    h: number,
  ): void {
    const grid = field.grid;
    if (!grid || field.levels.length === 0) return;
    const polys = this.contoursFor(field);
    if (polys.length === 0) return;

    const [x0, y0, x1, y1] = field.bbox;
    const cellW = (x1 - x0) / grid.w;
    const cellH = (y1 - y0) / grid.h;
    const sx = cellW * camera.scale;
    const sy = cellH * camera.scale;
    if (!(sx > 0) || !(sy > 0)) return;
    const origin = worldToScreen(camera, x0 + cellW / 2, y0 + cellH / 2, w, h);

    ctx.beginPath();
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(sx, sy);
    for (const c of polys) traceContour(ctx, c, 1);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = ROJI_VIZ_COLOR.fukamidori;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 言葉の三層。**重なったら消すのではなく、この段では置かない**
   * (`lib/profile/labels.ts`)。段が上がると層が増える (一般語 → 共通語 →
   * 個人語) ので、置けなかった語も段を上げれば現れる — Setaka 確定要件
   * 「寄って消えるものはない。すべては分解されるだけ」。
   *
   * 予算は地の面と別に持つ。ひとつの予算を共有すると、格子のセル数が多い段
   * (LOD micro) で地が予算を使い切り、**言葉が 1 つも描かれない**という、まさに
   * 上の要件に反する落ち方をする。
   *
   * ## 字は紙の色の板の上に置く (ノックアウト)
   *
   * 濃度の面と等高線の上に字が乗るので、地のままだと **線が字を貫通して読めない**
   * (独立 QA 実測: 「香」「台」を等値線が貫通)。旧実装は半透明の縁取り
   * (`strokeText`) だけで守ろうとしていたが、縁取りは字の輪郭に沿うだけなので
   * 字の内側の空きは地のまま残る。ここでは**不透明な紙の色の板**を先に敷いてから
   * 字を置く (地図の注記と同じ作法)。板は `placeLabels` が確保した矩形と同じ
   * 大きさなので、隣の札の字を覆うことはない。
   *
   * 板を先に全部敷いてから字を全部書くのは、描き順で後の板が前の字を欠けさせる
   * 事故を構造的に無くすため。
   */
  private drawWords(
    ctx: CanvasRenderingContext2D,
    words: ProfileWordsResponse,
    camera: CameraState,
    w: number,
    h: number,
    stats: DrawStats,
  ): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lists: Record<string, readonly { text: string; x: number; y: number }[]> = {
      general: words.general,
      shared: words.shared,
      personal: words.personal,
    };

    /* 画面に入る札だけを候補にし、その場で大きさを測る (measureText は font を
       立ててから呼ぶ必要があるので、層ごとにまとめて測る)。 */
    const candidates: LabelCandidate[] = [];
    const draws = new Map<
      string,
      { text: string; size: number; weight: number; color: string; w: number; h: number }
    >();
    for (const layer of WORD_LAYERS) {
      const list = lists[layer.key] ?? [];
      if (list.length === 0) continue;
      ctx.font = `${layer.weight} ${layer.size}px ${ROJI_VIZ_SERIF}`;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const p = worldToScreen(camera, item.x, item.y, w, h);
        const width = ctx.measureText(item.text).width;
        const height = layer.size;
        if (p.x + width / 2 < 0 || p.x - width / 2 > w || p.y + height < 0 || p.y - height > h) {
          stats.offscreen++;
          continue;
        }
        const key = `${layer.key}:${i}`;
        candidates.push({ key, x: p.x, y: p.y, w: width, h: height, priority: layer.priority });
        draws.set(key, {
          text: item.text,
          size: layer.size,
          weight: layer.weight,
          color: layer.color,
          w: width,
          h: height,
        });
      }
    }
    if (candidates.length === 0) return;

    const budgeted = candidates.slice(0, PROFILE_WORDS_FRAME_BUDGET);
    stats.culled += candidates.length - budgeted.length;

    /* 場所取りの隙間は**板の大きさ**で決める。字の大きさだけで場所を取ると、
       字は重ならないのに板が隣の字を欠けさせる (板は字より左右 5px・上下 3px
       大きい)。 */
    const { placed, deferred } = placeLabels(budgeted, { gap: WORD_PLATE_PAD_X * 2 });
    stats.culled += deferred.length;

    /* 1周目: 紙の色の板を敷く。 */
    ctx.save();
    ctx.fillStyle = ROJI_VIZ_COLOR.kinari;
    ctx.globalAlpha = 1;
    for (const spot of placed) {
      const d = draws.get(spot.key);
      if (!d) continue;
      const plateW = d.w + WORD_PLATE_PAD_X * 2;
      const plateH = d.h + WORD_PLATE_PAD_Y * 2;
      tracePlate(ctx, spot.x - plateW / 2, spot.y - plateH / 2, plateW, plateH, plateH / 2);
      ctx.fill();
    }
    ctx.restore();

    /* 2周目: 字を置く。 */
    for (const spot of placed) {
      const d = draws.get(spot.key);
      if (!d) continue;
      ctx.save();
      ctx.font = `${d.weight} ${d.size}px ${ROJI_VIZ_SERIF}`;
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, spot.x, spot.y);
      ctx.restore();
      stats.drawn++;
    }
  }

  /**
   * 自分の粒。
   *
   * 墨 (`sumi`) の点は**インク**なので使ってよい (背景・大面積に黒・近黒を敷か
   * ない、が実際のルール。`WORD_LAYERS` の doc comment 参照)。粒は半径 3px、
   * 広がりの輪は線だけなので、面としての黒は生じない。
   */
  private drawSelf(
    ctx: CanvasRenderingContext2D,
    centroid: { x: number; y: number },
    spread: number,
    camera: CameraState,
    w: number,
    h: number,
    stats: DrawStats,
  ): void {
    const p = worldToScreen(camera, centroid.x, centroid.y, w, h);
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
      stats.offscreen++;
      return;
    }
    const r = Math.max(4, spread * camera.scale);
    ctx.save();
    ctx.strokeStyle = ROJI_VIZ_COLOR.fukamidori;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ROJI_VIZ_COLOR.sumi;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    stats.drawn += 2;
  }
}

/**
 * 角の丸い矩形のパスを積む。
 *
 * `CanvasRenderingContext2D.roundRect` を使わないのは、Storybook の
 * headless Chromium など一部の実行環境で欠けることがあるため (機械検査が
 * そこで落ちると、検査の意味が「実装が壊れた」から「環境が古い」へすり替わる)。
 */
function tracePlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

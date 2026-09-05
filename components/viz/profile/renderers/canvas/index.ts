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

import { asContourValues, traceContour } from "@/lib/viz/contour-path";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, rampFn } from "@/lib/viz/roji-viz-palette";
import { PROFILE_FRAME_ELEMENT_BUDGET } from "@/lib/profile/thresholds";
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

/** base64 → Uint8Array。ブラウザ (`atob`) / Node (Storybook のブラウザ実行以外) の両対応。 */
function decodeGrid(data: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(data, "base64"));
}

export class CanvasProfileRenderer implements ProfileRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private reducedMotion = false;

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
      this.drawContours(ctx, scene.field, w, h);
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
    const u8 = decodeGrid(grid.data);
    const [x0, y0, x1, y1] = field.bbox;
    const cellW = (x1 - x0) / grid.w;
    const cellH = (y1 - y0) / grid.h;
    for (let j = 0; j < grid.h; j++) {
      for (let i = 0; i < grid.w; i++) {
        const v = u8[j * grid.w + i];
        if (v <= 2) continue;
        const wx0 = x0 + i * cellW;
        const wy0 = y0 + j * cellH;
        const p0 = worldToScreen(camera, wx0, wy0, w, h);
        const p1 = worldToScreen(camera, wx0 + cellW, wy0 + cellH, w, h);
        if (p1.x < 0 || p0.x > w || p1.y < 0 || p0.y > h) {
          stats.offscreen++;
          continue;
        }
        const [r, g, b] = WASH_RAMP(v / 255);
        ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(0.55 * v) / 255})`;
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        stats.drawn++;
      }
    }
  }

  private drawContours(
    ctx: CanvasRenderingContext2D,
    field: ProfileFieldResponse,
    w: number,
    h: number,
  ): void {
    const grid = field.grid;
    if (!grid || field.levels.length === 0) return;
    const u8 = decodeGrid(grid.data);
    const values = new Float64Array(u8.length);
    for (let i = 0; i < u8.length; i++) values[i] = u8[i];
    const gen = contours()
      .size([grid.w, grid.h])
      .thresholds(field.levels.map((l) => l * 255));
    const polys = gen(asContourValues(values as unknown as Float64Array));
    // 暫定実装: viewport が bbox のアスペクト比と一致する前提の等方スケール。
    const sx = w / grid.w;
    const sy = h / grid.h;
    ctx.save();
    ctx.strokeStyle = ROJI_VIZ_COLOR.fukamidori;
    ctx.lineWidth = 1.2 / Math.max(0.1, Math.min(sx, sy));
    ctx.scale(sx, sy);
    for (const c of polys) {
      ctx.beginPath();
      traceContour(ctx, c, 1);
      ctx.stroke();
    }
    ctx.restore();
  }

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
    const within = (x: number, y: number) => x >= -40 && x <= w + 40 && y >= -20 && y <= h + 20;

    const drawList = (
      list: readonly { text: string; x: number; y: number }[],
      size: number,
      color: string,
      alpha: number,
    ) => {
      ctx.font = `400 ${size}px ${ROJI_VIZ_SERIF}`;
      for (const item of list) {
        if (stats.drawn >= PROFILE_FRAME_ELEMENT_BUDGET) {
          stats.culled++;
          continue;
        }
        const p = worldToScreen(camera, item.x, item.y, w, h);
        if (!within(p.x, p.y)) {
          stats.offscreen++;
          continue;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillText(item.text, p.x, p.y);
        ctx.restore();
        stats.drawn++;
      }
    };

    drawList(words.general, 15, ROJI_VIZ_COLOR.usukoke, 0.65);
    drawList(words.shared, 12, ROJI_VIZ_COLOR.sumi, 0.85);
    drawList(words.personal, 11, ROJI_VIZ_COLOR.sumi, 1);
  }

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

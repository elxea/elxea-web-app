/**
 * `d3-contour` が返す MultiPolygon を SVG / Canvas に落とす小さな道具。
 *
 * ## なぜ d3-geo を入れないのか
 *
 * 原版 (`verdicts.md` 候補 12 / 30) は `d3.geoPath()` で書き出していた。ただし
 * 等高線はすでにグリッド座標なので、投影は「そのまま出す」だけでよい。そのために
 * `d3-geo` (と依存の `d3-array` 系) をバンドルに足すのは割に合わないので、
 * MultiPolygon → path の 10 行だけ自前で持つ。
 *
 * 座標系はグリッド単位のまま返す。拡大は SVG の `viewBox` / Canvas の
 * `setTransform` 側で行う (ここで px に変換すると、板の大きさが変わるたびに
 * 等高線を作り直すことになる)。
 */

import type { ContourMultiPolygon } from "d3-contour";

/**
 * `d3-contour` に濃度場を渡すための型合わせ。
 *
 * `@types/d3-contour` の呼び出し型は `number[]` しか受けないが、実装が使うのは
 * `length` と添字アクセスだけで、**TypedArray がそのまま動く** (公式の例自体が
 * `Float64Array` を渡している)。`Array.from` で写すと 10 万要素の複製が描画の
 * たびに走るので、複製ではなく型だけを合わせる。
 */
export function asContourValues(grid: Float64Array): number[] {
  return grid as unknown as number[];
}

/** MultiPolygon → SVG の `d` 属性。 */
export function contourToSvgPath(contour: ContourMultiPolygon): string {
  const out: string[] = [];
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (ring.length === 0) continue;
      out.push(`M${ring[0][0]},${ring[0][1]}`);
      for (let i = 1; i < ring.length; i++) out.push(`L${ring[i][0]},${ring[i][1]}`);
      out.push("Z");
    }
  }
  return out.join("");
}

/** MultiPolygon を現在の Canvas パスに積む (`fill` / `stroke` は呼び出し側)。 */
export function traceContour(
  ctx: CanvasRenderingContext2D,
  contour: ContourMultiPolygon,
  scale = 1
): void {
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (ring.length === 0) continue;
      ctx.moveTo(ring[0][0] * scale, ring[0][1] * scale);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(ring[i][0] * scale, ring[i][1] * scale);
      }
      ctx.closePath();
    }
  }
}

export interface ContourLabelSpot {
  x: number;
  y: number;
  /** 線に沿わせる角度 (度)。文字が逆さまにならないよう ±90 に収めてある。 */
  angle: number;
}

/**
 * 計曲線に沿って標高ラベルを置く場所を選ぶ。
 *
 * この縮尺だと 500m の輪は長く入り組み、素直に置くと数字で画面が埋まる
 * (620 グリッドで実測 108 個 = 読めない)。よって
 * **短い輪は飛ばし、間隔も広く取る** — 数値は 2 つとも呼び出し側が
 * グリッド単位で渡す (板の大きさが変わっても見た目の間隔が変わらないように)。
 */
export function contourLabelSpots(
  contour: ContourMultiPolygon,
  { minRingLength, spacing }: { minRingLength: number; spacing: number }
): ContourLabelSpot[] {
  const spots: ContourLabelSpot[] = [];
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      const cumulative: number[] = [];
      let total = 0;
      for (let i = 1; i < ring.length; i++) {
        total += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
        cumulative.push(total);
      }
      if (total < minRingLength) continue;

      const count = Math.max(1, Math.floor(total / spacing));
      for (let k = 0; k < count; k++) {
        const target = ((k + 0.5) / count) * total;
        let idx = cumulative.findIndex((s) => s >= target);
        if (idx < 1) idx = 1;
        const prev = ring[Math.max(0, idx - 1)];
        const next = ring[Math.min(ring.length - 1, idx + 1)];
        let angle = (Math.atan2(next[1] - prev[1], next[0] - prev[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        spots.push({ x: ring[idx][0], y: ring[idx][1], angle });
      }
    }
  }
  return spots;
}

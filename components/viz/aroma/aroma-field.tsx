"use client";

/**
 * 香りの場 — 気配の場 (等高線ウォッシュ) 版。
 *
 * 香りの一つ一つをガウス分布として足し合わせ、系統ごとの濃度場を `d3.contours` で
 * 3 段の等高線に落として塗る。**点ではなく「領域」の地図**になり、近い香りどうしが
 * 地峡でつながる。系統が重なる場所がそのまま「香りの通じ合い」として出る。
 *
 * ## 載るのは同じカテゴリーの香りだけ / 場は 1 色
 *
 * 何を載せるかは **データ層が決める** (`lib/roji/tea-aroma.ts`)。色は
 * `data.category` から 1 色だけ引き、系統では色を変えない — 図の色はお茶の
 * カテゴリーを表すという恒久ルールに従う (`docs/roji-dataviz-rules.md`)。
 * 系統は色ではなく **場を別々に起こすこと** で分かれる。単色でも島は分かれ、
 * 重なった場所は塗りが重なって濃くなるので「通じ合い」はそのまま読める。
 *
 * ## roji の見え方にするための 2 点
 *
 * 1. **塗りは 3 段だけ** (不透明度 0.09 / 0.12 / 0.15)。ヒートマップ的な連続
 *    グラデにしない。連続にした瞬間に「分析画面」に見える
 * 2. **ガウスの広がり (σ) は島が分かれる大きさに抑える**。大きいと画面全体が
 *    塗りつぶされ、4 象限の構造が消える (verdicts.md 第3ラウンド 落とし穴 4)
 *
 * 味の四象限 (`components/viz/flavor/flavor-matrix.tsx`) と軸の作法・作図面は
 * 共有する (`lib/viz/quadrant.ts`)。違うのは軸の意味と、点ではなく場を描くこと。
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド `20-flavor-matrix/06-field.html`
 * (軸を香り用に差し替えた新規の 1 枚)。
 */

import { contours as d3contours } from "d3-contour";
import { useEffect, useRef } from "react";

import {
  AROMA_AXIS,
  AROMA_FAMILY_ORDER,
  type AromaFieldData,
} from "@/lib/roji/tea-aroma";
import {
  TEA_CATEGORY_COLOR,
  TEA_CATEGORY_LABEL,
} from "@/lib/roji/tea-category";
import { asContourValues, traceContour } from "@/lib/viz/contour-path";
import { drawQuadrantAxesCanvas, isNarrowLayout, quadrantLayout } from "@/lib/viz/quadrant";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/** 濃度場のセル (px)。細かくしても絵は変わらず計算量だけ増える。 */
const CELL = 6;
/** 塗る段。max に対する割合。 */
const THRESHOLDS = [0.2, 0.42, 0.68];
/** 段ごとの不透明度。 */
const ALPHAS = [0.09, 0.12, 0.15];
/** 原版 (フルスクリーン) の作図面幅。σ をここから相似で縮める。 */
const REFERENCE_PLANE_WIDTH = 945;

export interface AromaFieldProps {
  data: AromaFieldData;
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function AromaField({ data, label, className }: AromaFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const render = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 2 || height < 2) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const layout = quadrantLayout(width, height);
      const scale = Math.min(
        1.1,
        Math.max(0.32, layout.planeWidth / REFERENCE_PLANE_WIDTH)
      );
      // 狭い枠では「この香り」だけを名指しする (flavor-matrix.tsx と同じ理由)。
      const narrow = isNarrowLayout(layout);

      const nx = Math.ceil(width / CELL);
      const ny = Math.ceil(height / CELL);
      // 場に載るのは 1 カテゴリーだけなので、色は 1 回引けば足りる。
      const fieldColor = TEA_CATEGORY_COLOR[data.category];

      ctx.save();
      // 重なりが「紙に染みが溜まる」見え方になる。source-over だと後の系統が
      // 前の系統を隠し、重なりが読めない。
      ctx.globalCompositeOperation = "multiply";

      for (const family of AROMA_FAMILY_ORDER) {
        const members = data.notes.filter((note) => note.family === family);
        if (members.length === 0) continue;

        const points = members.map((note) => ({
          x: layout.sx(note.x),
          y: layout.sy(note.y),
          sigma: (40 + note.weight * 22) * scale,
          weight: note.weight,
        }));

        const values = new Float64Array(nx * ny);
        let max = 0;
        for (let j = 0; j < ny; j++) {
          const py = j * CELL;
          for (let i = 0; i < nx; i++) {
            const px = i * CELL;
            let acc = 0;
            for (const p of points) {
              const dx = px - p.x;
              const dy = py - p.y;
              acc += p.weight * Math.exp(-(dx * dx + dy * dy) / (2 * p.sigma * p.sigma));
            }
            values[j * nx + i] = acc;
            if (acc > max) max = acc;
          }
        }
        if (max <= 0) continue;

        const bands = d3contours()
          .size([nx, ny])
          .thresholds(THRESHOLDS.map((t) => t * max))(asContourValues(values));

        bands.forEach((band, index) => {
          ctx.beginPath();
          traceContour(ctx, band, CELL);
          ctx.fillStyle = fieldColor;
          ctx.globalAlpha = ALPHAS[index] ?? 0.16;
          ctx.fill();
          ctx.globalAlpha = 1;
        });

        // 一番外の等高線だけ、細い線で輪郭を残す。
        if (bands[0]) {
          ctx.beginPath();
          traceContour(ctx, bands[0], CELL);
          ctx.globalAlpha = 0.3;
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = fieldColor;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      drawQuadrantAxesCanvas(ctx, layout, AROMA_AXIS);

      const labelSize = layout.planeWidth < 420 ? 10 : 12.5;
      for (const note of data.notes) {
        const x = layout.sx(note.x);
        const y = layout.sy(note.y);
        const focused = data.highlightId === null || data.highlightId === note.id;

        ctx.beginPath();
        ctx.arc(x, y, focused && data.highlightId === note.id ? 4.4 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = focused ? "rgba(43,43,43,0.82)" : "rgba(43,43,43,0.34)";
        ctx.fill();

        if (narrow && data.highlightId !== null && data.highlightId !== note.id) {
          continue;
        }

        ctx.font = `300 ${labelSize}px ${ROJI_VIZ_SERIF}`;
        ctx.fillStyle = focused ? "rgba(43,43,43,0.92)" : "rgba(43,43,43,0.42)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(note.label, x, y + 11);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    render();

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 200);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [data]);

  return (
    <div data-slot="aroma-field" className={cn("flex flex-col gap-4", className)}>
      <div
        ref={hostRef}
        className="relative h-96 w-full lg:h-140"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
        />
      </div>
      {/* 凡例は 1 行。色 = カテゴリーで、この場には 1 カテゴリーしか載らない。 */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2" data-slot="aroma-legend">
        <li
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-category={data.category}
        >
          <span
            aria-hidden="true"
            className="inline-block h-2 w-3.5 rounded-full opacity-50"
            style={{ backgroundColor: TEA_CATEGORY_COLOR[data.category] }}
          />
          {TEA_CATEGORY_LABEL[data.category]}
        </li>
      </ul>
    </div>
  );
}

"use client";

/**
 * 味の四象限 — 有機的不定形 (メタボール) 版。
 *
 * 甘み⇄渋み × 軽やか⇄濃厚 の 4 象限に銘柄を置く。マークは円ではなく、
 * 6 つの粒が gooey フィルタで融け合った **絶えず輪郭の変わる塊**。
 * 「比較する図」ではなく「生き物の領域」に見せることでダッシュボードから離す。
 *
 * ## 載るのは同じカテゴリーの銘柄だけ / 色は 1 色
 *
 * 何を載せるかは **データ層が決める** (`lib/roji/tea-flavor.ts`)。ここは
 * `data.points` をそのまま描くだけで、絞り込みも色の出し分けもしない。
 * 色は `data.category` から 1 色だけ引く — 図の色はお茶のカテゴリーを表すので、
 * 同一カテゴリーしか載らないこの図では**全ての塊が同色**になるのが正しい。
 * 恒久ルールの全文は `docs/roji-dataviz-rules.md`。
 *
 * ## gooey フィルタの作法 (踏むと痛い 2 点)
 *
 * 1. **フィルタは茶ごとの小さな `<g>` に掛ける**。画面全体の `<g>` に掛けると
 *    フィルタ処理領域が全画面 × dpr になり、実測 2fps まで落ちる (小さな g なら
 *    20fps)。フィルタのコストは「掛ける対象の bbox」で決まる。
 * 2. **塗りが不透明でないと融合しない** (アルファのコントラストで判定するため)。
 *    薄くしたいときは粒ではなくグループ全体に `opacity` を掛ける。
 *
 * ## なぜ React で宣言的に書かないのか
 *
 * 粒は 1 銘柄あたり 6 個で、毎フレーム全部の `cx` / `cy` が動く。React の
 * 再レンダリングに載せると 60 要素の差分計算が毎フレーム走る。既存の
 * `components/viz/map/origin-map.tsx` と同じく、**描画は effect の中で DOM を
 * 直接触る**。React が持つのは枠と凡例だけ。
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド `20-flavor-matrix/03-gooey.html`。
 */

import { useEffect, useId, useRef } from "react";

import {
  TEA_CATEGORY_COLOR,
  TEA_CATEGORY_LABEL,
} from "@/lib/roji/tea-category";
import { FLAVOR_AXIS, type FlavorMatrixData } from "@/lib/roji/tea-flavor";
import { drawQuadrantAxesSvg, isNarrowLayout, quadrantLayout } from "@/lib/viz/quadrant";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, seededRandom } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 原版 (フルスクリーン) の作図面幅。ここを基準にマークの大きさを相似で縮める。 */
const REFERENCE_PLANE_WIDTH = 945;

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  return node;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface FlavorMatrixProps {
  data: FlavorMatrixData;
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function FlavorMatrix({ data, label, className }: FlavorMatrixProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const filterId = `roji-goo-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) return;

    const reduced = prefersReducedMotion();
    let frame = 0;

    const render = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 2 || height < 2) return;

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const defs = el("defs", {});
      const filter = el("filter", {
        id: filterId,
        x: "-45%",
        y: "-45%",
        width: "190%",
        height: "190%",
        "color-interpolation-filters": "sRGB",
      });
      // ぼかし → アルファのコントラストを立てて塊を融合させる。
      // 22 / -9 が輪郭の締まり。ここを緩めると輪郭がぼやけて粒が見えてしまう。
      filter.appendChild(el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 11, result: "blur" }));
      filter.appendChild(
        el("feColorMatrix", {
          in: "blur",
          mode: "matrix",
          values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9",
          result: "goo",
        })
      );
      filter.appendChild(el("feGaussianBlur", { in: "goo", stdDeviation: 0.7 }));
      defs.appendChild(filter);
      svg.appendChild(defs);

      const layout = quadrantLayout(width, height);
      drawQuadrantAxesSvg(svg, layout, FLAVOR_AXIS);

      const field = el("g", {});
      svg.appendChild(field);
      const labels = el("g", {});
      svg.appendChild(labels);

      // 枠が小さいほど粒も小さくする。原版の値をそのまま使うと塊同士が重なり、
      // 4 象限の構造が塊で埋まる。
      const scale = Math.min(
        1.1,
        Math.max(0.32, layout.planeWidth / REFERENCE_PLANE_WIDTH)
      );
      const labelSize = layout.planeWidth < 420 ? 10 : 12.5;
      /**
       * 狭い枠では **「この茶」の名前だけ**を出す。
       *
       * 10 銘柄ぶんの名前を並べると SP 幅では隣同士が重なって、どれも読めなく
       * なる (実測: 390px 幅で「さえみどり」と「つゆひかり」が重なった)。
       * 位置と塊は残るので図の意味は失われない。
       */
      const narrow = isNarrowLayout(layout);
      // 図に載るのは 1 カテゴリーだけなので、色は 1 回引けば足りる。
      const markColor = TEA_CATEGORY_COLOR[data.category];

      const bodies: {
        x: number;
        y: number;
        parts: {
          node: SVGElement;
          orbit: number;
          phase: number;
          speed: number;
          squash: number;
        }[];
      }[] = [];

      data.points.forEach((tea, index) => {
        const rnd = seededRandom(index * 7919 + 13);
        const x = layout.sx(tea.x);
        const y = layout.sy(tea.y);
        const radius = (26 + tea.weight * 15) * scale;
        const focused = data.highlightId === null || data.highlightId === tea.id;

        const group = el("g", {
          filter: `url(#${filterId})`,
          // 「この茶」だけ濃く出す。他は気配として残す。
          opacity: focused ? 0.62 : 0.26,
        });
        field.appendChild(group);

        const parts: (typeof bodies)[number]["parts"] = [];
        for (let k = 0; k < 6; k++) {
          const circle = el("circle", {
            cx: x,
            cy: y,
            r: radius * (0.38 + rnd() * 0.26),
            fill: markColor,
          });
          group.appendChild(circle);
          parts.push({
            node: circle,
            orbit: radius * (0.26 + rnd() * 0.52),
            phase: rnd() * Math.PI * 2,
            speed: (0.1 + rnd() * 0.34) * (rnd() < 0.5 ? -1 : 1),
            squash: 0.6 + rnd() * 0.75,
          });
        }
        bodies.push({ x, y, parts });

        // 「この茶」には墨の芯を打つ。塊がどれだけ揺れても位置が失われない。
        if (data.highlightId === tea.id) {
          labels.appendChild(
            el("circle", { cx: x, cy: y, r: 2.6, fill: ROJI_VIZ_COLOR.sumi, opacity: 0.82 })
          );
        }

        // ラベルは塊の下。ちょうど軸線に重なる茶だけ、さらに下へ逃がす
        // (上に逃がすと真上の茶のラベルと紛らわしくなる)。
        if (narrow && data.highlightId !== null && data.highlightId !== tea.id) {
          return;
        }

        const below = y + radius * 1.8 + 9;
        const labelY = Math.abs(below - layout.cy) < 16 ? below + 22 : below;
        const name = el("text", {
          x,
          y: labelY,
          "text-anchor": "middle",
          "font-family": ROJI_VIZ_SERIF,
          "font-size": labelSize,
          "letter-spacing": "0.12em",
          fill: ROJI_VIZ_COLOR.sumi,
          "font-weight": 300,
          opacity: focused ? 0.92 : 0.4,
        });
        name.textContent = tea.label;
        labels.appendChild(name);
      });

      if (reduced) {
        // 動かさない。粒は位相だけ進めた「ある瞬間」で固定する。
        for (const body of bodies) {
          for (const part of body.parts) {
            part.node.setAttribute("cx", String(body.x + Math.cos(part.phase) * part.orbit));
            part.node.setAttribute(
              "cy",
              String(body.y + Math.sin(part.phase) * part.orbit * part.squash)
            );
          }
        }
        return;
      }

      const start = performance.now();
      const tick = (now: number) => {
        const seconds = (now - start) / 1000;
        for (const body of bodies) {
          for (const part of body.parts) {
            const angle = part.phase + seconds * part.speed;
            part.node.setAttribute("cx", String(body.x + Math.cos(angle) * part.orbit));
            part.node.setAttribute(
              "cy",
              String(body.y + Math.sin(angle) * part.orbit * part.squash)
            );
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    render();

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        cancelAnimationFrame(frame);
        render();
      }, 200);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      cancelAnimationFrame(frame);
    };
  }, [data, filterId]);

  return (
    <div data-slot="flavor-matrix" className={cn("flex flex-col gap-4", className)}>
      <div
        ref={hostRef}
        className="relative h-96 w-full lg:h-140"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        <svg
          ref={svgRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
        />
      </div>
      {/* 凡例は 1 行しかない。色 = カテゴリーで、この図には 1 カテゴリーしか
          載らないため (色の出し分けが無いことを凡例でも明示する)。 */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2" data-slot="flavor-legend">
        <li
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-category={data.category}
        >
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-[44%_56%_60%_40%] opacity-70"
            style={{ backgroundColor: TEA_CATEGORY_COLOR[data.category] }}
          />
          {TEA_CATEGORY_LABEL[data.category]}
        </li>
      </ul>
    </div>
  );
}

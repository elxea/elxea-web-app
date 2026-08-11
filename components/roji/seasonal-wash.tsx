"use client";

import { useEffect, useRef } from "react";

import { hexToOklch } from "@/lib/roji/color";
import {
  prefersReducedMotion,
  resolveMotion,
} from "@/lib/roji/seasonal-wash-motion";

/**
 * SeasonalWash — 季節のにじみ (roji 情動レイヤー v0)
 *
 * 色の塊がごく遅く漂って混ざるだけの面。数値・ラベル・凡例は一切出さない
 * (コンセプト第3節「5則」)。何を意味するか分からなくても成立することが要件。
 *
 * ## 実装上の選択と、その理由
 * - **canvas 2D。WebGL でもライブラリでもない。** v0 で要るのは「淡い塊が滲んで
 *   混ざる」だけで、これは radial gradient を数枚重ねれば出る。シェーダを入れると
 *   フォールバック (WebGL 非対応・低電力) の二重設計が即座に発生する。
 * - **低解像度で描いて CSS で拡大 + ぼかす。** 塗る画素を実寸の 1/16 程度に落とす。
 *   拡大時の補間そのものが「にじみ」になるので、負荷を下げる操作と絵の狙いが同じ
 *   方向を向く。工業的な硬いエッジが出ないのはこのため。
 * - **30fps 目安。** 揺らぎは遅いほど roji らしく、性能要求と思想が一致する
 *   (コンセプト第5節)。60fps は要らない。
 * - **乱数を使わない。** 位置と速さは index から決まる決定的な値。ハイドレーション
 *   のズレも、スクリーンショットの揺れも、構造的に起きない。
 * - **grain は別レイヤーに 1 回だけ描く。** 本体はぼかすので、同じ面に粒を置くと
 *   ぼけて消える。粒は等倍の静止レイヤーとして重ね、毎フレームの負荷を増やさない。
 *
 * 動きの正本はコード、色の正本は季節パレット (`lib/roji/seasonal-palette.ts`)。
 * 参照: https://www.notion.so/3b970c9d064c816da7b3c0bf2c15557f
 */

export interface SeasonalWashProps {
  /** にじみの色。4〜6 色を想定 (`seasonalPalette()` は 4 色を返す)。 */
  palette: string[];
  /** 動きの速さ。0.5 (とても遅い) 〜 2。既定 1。 */
  tempo?: number;
  /** 微細なノイズを重ねるか。既定 false。 */
  grain?: boolean;
  className?: string;
}

/** 実寸に対する内部解像度の比。小さいほど軽く、にじみが強くなる。 */
const RENDER_SCALE = 0.25;
/** 内部解像度の下限 (これ以下だと塊の形が破綻する)。 */
const MIN_RENDER_PX = 48;
/**
 * CSS 側のぼかし量 (px)。低解像度の補間だけでは足りない分を足す。
 *
 * 44px から下げてある。強くぼかすほど「にじみ」になると考えて上げすぎると、
 * 塊どうしが完全に混ざり合って **一様な白い面** になり、色が消える (実測: 初回の
 * 8月朝は淡すぎて水色も薄緑も判別できなかった)。輪郭を消すのは主に低解像度側の
 * 役目で、ぼかしは仕上げに留める。
 */
const BLUR_PX = 26;
/** ぼかしで縁が透けるので、その分だけ拡大して逃がす。 */
const OVERSCAN = 1.18;
/** にじみの数。色数に関わらず 4〜6 に収める。 */
const MIN_BLOBS = 4;
const MAX_BLOBS = 6;
/** 1 周に要する時間の基準 (秒)。tempo = 1 で約 2 分。 */
const BASE_PERIOD_SEC = 120;
/** grain タイルの一辺 (px) と最大の濃さ (0-255)。 */
const GRAIN_TILE = 160;
const GRAIN_MAX_ALPHA = 26;

interface Blob {
  color: string;
  /** 中心の基準位置 (0-1)。 */
  originX: number;
  originY: number;
  /** 漂う幅 (0-1)。 */
  amplitudeX: number;
  amplitudeY: number;
  /** 位相と角速度。互いに素に近い比にしてループを見えなくする。 */
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
  /** 半径 (対角比) と、その呼吸。 */
  radius: number;
  radiusSwing: number;
  radiusSpeed: number;
  alpha: number;
}

/**
 * index から決定的に blob を作る。
 *
 * 黄金角 (137.5 度) で位相をばらすと、少ない個数でも位置が偏らずに散る。
 * 速度は 1 に対して無理数に近い比を掛け、周期が揃って「ループが見える」のを避ける。
 */
function buildBlobs(colors: string[], count: number): Blob[] {
  const golden = 137.50776405003785;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i * golden * Math.PI) / 180;
    const spread = 0.26 + 0.06 * ((i % 3) / 2);
    return {
      color: colors[i % colors.length],
      originX: 0.5 + Math.cos(angle) * spread,
      originY: 0.5 + Math.sin(angle) * spread,
      amplitudeX: 0.2 + 0.09 * ((i % 4) / 3),
      amplitudeY: 0.17 + 0.1 * (((i + 2) % 4) / 3),
      speedX: 0.61 + 0.17 * i,
      speedY: 0.43 + 0.23 * ((i + 1) % 5),
      phaseX: angle,
      phaseY: angle * 1.7 + 1.1,
      // 対角の半分に対する比。塊が画面より大きいと全部が重なって色が消えるので、
      // 地 (いちばん淡い色) が見える余地を必ず残す大きさにしてある。
      radius: 0.36 + 0.1 * ((i % 3) / 2),
      radiusSwing: 0.06,
      radiusSpeed: 0.31 + 0.11 * ((i + 3) % 4),
      alpha: 0.78 + 0.1 * ((i % 2) === 0 ? 1 : 0),
    };
  });
}

function toRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const r = parseInt(expanded.slice(0, 2), 16) || 0;
  const g = parseInt(expanded.slice(2, 4), 16) || 0;
  const b = parseInt(expanded.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 「明るい配色」と見なす平均明度の境目。 */
const LIGHT_PALETTE_PIVOT = 0.7;

/**
 * 地の色を配色の明るさで決める。
 *
 * - 明るい配色 (朝・昼) → いちばん明るい色を地にする。生成りの紙の上に
 *   水色や薄緑が滲む、という roji の見え方になる。
 * - 暗い配色 (夜) → いちばん暗い色を地にする。明るい色が「奥から出てくる光」
 *   として残り、障子越しの光・水面の語彙に一致する。
 *
 * 固定ルールを両方とも試して捨てた経緯がある。常に明るい色を地にすると夜が
 * 灰緑一色の濁った霞になり (実測: 8月夜)、常に暗い色を地にすると朝から生成りの
 * 温かみが消えて青灰色に寄る (実測: 8月朝)。どちらの失敗も原因は同じで、
 * **地を少数派の明度側に置くと面全体が中明度へ潰れる**。地は多数派の側に置く。
 */
function groundColor(colors: string[]): string {
  const measured: { color: string; l: number }[] = [];
  for (const color of colors) {
    try {
      measured.push({ color, l: hexToOklch(color).l });
    } catch {
      // 解釈できない色は地の候補にしない (塊としては canvas がそのまま解釈する)。
    }
  }
  if (measured.length === 0) return colors[0];

  const mean = measured.reduce((sum, m) => sum + m.l, 0) / measured.length;
  const wantLightest = mean >= LIGHT_PALETTE_PIVOT;
  return measured.reduce((best, m) =>
    (wantLightest ? m.l > best.l : m.l < best.l) ? m : best,
  ).color;
}

function paintGrain(canvas: HTMLCanvasElement, width: number, height: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const tile = document.createElement("canvas");
  tile.width = GRAIN_TILE;
  tile.height = GRAIN_TILE;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return;

  const image = tileCtx.createImageData(GRAIN_TILE, GRAIN_TILE);
  // 線形合同法。粒の並びを固定して、開くたびに粒が跳ねないようにする。
  let seed = 20260812;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const value = seed / 4294967296;
    image.data[i] = 0;
    image.data[i + 1] = 0;
    image.data[i + 2] = 0;
    image.data[i + 3] = Math.round(value * GRAIN_MAX_ALPHA);
  }
  tileCtx.putImageData(image, 0, 0);

  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function SeasonalWash({
  palette,
  tempo = 1,
  grain = false,
  className,
}: SeasonalWashProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const washRef = useRef<HTMLCanvasElement | null>(null);
  const grainRef = useRef<HTMLCanvasElement | null>(null);

  // 配列 prop をそのまま依存に置くと毎レンダーで再初期化されるため、値で比較する。
  const paletteKey = palette.join(",");

  useEffect(() => {
    const host = hostRef.current;
    const canvas = washRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const colors = paletteKey.split(",").filter(Boolean);
    if (colors.length === 0) return;

    const blobs = buildBlobs(
      colors,
      Math.min(MAX_BLOBS, Math.max(MIN_BLOBS, colors.length + 2)),
    );
    const ground = groundColor(colors);

    const plan = resolveMotion({
      tempo,
      reducedMotion: prefersReducedMotion(
        typeof window === "undefined" ? null : window,
      ),
    });

    let width = 1;
    let height = 1;
    let rafId = 0;
    let lastFrameAt = 0;
    let elapsedSec = 0;
    let lastTickAt = 0;
    let running = false;
    let visible = true;
    let onScreen = true;

    const draw = () => {
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, width, height);

      const diagonal = Math.hypot(width, height);
      // 位相の基準。tempo は「時間の進み方」であって描画頻度ではない。
      const phase = (elapsedSec / BASE_PERIOD_SEC) * Math.PI * 2;

      for (const blob of blobs) {
        const cx =
          (blob.originX + Math.sin(phase * blob.speedX + blob.phaseX) * blob.amplitudeX) *
          width;
        const cy =
          (blob.originY + Math.cos(phase * blob.speedY + blob.phaseY) * blob.amplitudeY) *
          height;
        const radius =
          (blob.radius +
            Math.sin(phase * blob.radiusSpeed + blob.phaseX) * blob.radiusSwing) *
          diagonal *
          0.5;

        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, radius));
        // 中心を濃く、外へ一気に薄く。中間を厚くすると塊どうしが混ざりきって
        // 面が均一になる (= 色が消える) ため、落ち方は速めにしてある。
        gradient.addColorStop(0, toRgba(blob.color, blob.alpha));
        gradient.addColorStop(0.42, toRgba(blob.color, blob.alpha * 0.5));
        gradient.addColorStop(1, toRgba(blob.color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    };

    const tick = (now: number) => {
      rafId = window.requestAnimationFrame(tick);
      if (now - lastFrameAt < plan.frameIntervalMs) return;
      const deltaSec = lastTickAt === 0 ? 0 : (now - lastTickAt) / 1000;
      lastTickAt = now;
      lastFrameAt = now;
      // 復帰直後の大きな跳びを抑える (タブを 1 時間放置しても景色は飛ばない)。
      elapsedSec += Math.min(deltaSec, 1) * plan.timeScale;
      draw();
    };

    const stop = () => {
      if (!running) return;
      running = false;
      window.cancelAnimationFrame(rafId);
      rafId = 0;
      lastTickAt = 0;
    };

    const start = () => {
      if (running || !plan.animate) return;
      running = true;
      lastFrameAt = 0;
      lastTickAt = 0;
      rafId = window.requestAnimationFrame(tick);
    };

    const syncRunning = () => {
      if (plan.animate && visible && onScreen) start();
      else stop();
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      width = Math.max(MIN_RENDER_PX, Math.round(cssWidth * RENDER_SCALE));
      height = Math.max(MIN_RENDER_PX, Math.round(cssHeight * RENDER_SCALE));
      canvas.width = width;
      canvas.height = height;
      draw();
      if (grain && grainRef.current) {
        paintGrain(grainRef.current, cssWidth, cssHeight);
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const onVisibility = () => {
      visible = !document.hidden;
      syncRunning();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      syncRunning();
    });
    intersectionObserver.observe(host);

    const motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const onMotionChange = (event: MediaQueryListEvent) => {
      plan.animate = !event.matches;
      if (!plan.animate) {
        stop();
        elapsedSec = 0;
        draw();
      } else {
        syncRunning();
      }
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    syncRunning();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener?.("change", onMotionChange);
    };
  }, [paletteKey, tempo, grain]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={className}
      style={{ position: "relative", overflow: "hidden", isolation: "isolate" }}
    >
      <canvas
        ref={washRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          filter: `blur(${BLUR_PX}px)`,
          transform: `scale(${OVERSCAN})`,
          transformOrigin: "center",
        }}
      />
      {grain ? (
        <canvas
          ref={grainRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}

export default SeasonalWash;

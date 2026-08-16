"use client";

/**
 * 「味わいの足あと」— 触れて時を遡る一枚。
 *
 * 飲んできた一杯を味の四象限に落とし、**古いものほど淡く沈む**堆積として描く。
 * 見るだけの一枚絵 (`22-footprints`) に、時間レンズ・時間スクラバー・記憶カードの
 * 3 つの手がかりを足したもの。数値も目盛りも日付も出さない。時は
 * **季節の言葉**と**漢数字の杯数** (`lib/roji/me/tea-log.ts`) だけで語る。
 *
 * ## 色は 1 枚に 1 色 (roji 確定ルール)
 *
 * **色はカテゴリー (緑茶 / 紅茶 / 青茶) を表す**。比較のために 1 枚に並べてよい
 * のは同じカテゴリーの茶だけなので、**この図に出る色は 1 色**になるのが正しい。
 * 図の中で色が割れていたら、それはカテゴリーを跨いだ比較をしている印。点・にじみ
 * の色は `agedLook` (= `cup.color` = カテゴリーの色) だけから取り、系統 (蒸し /
 * 釜炒り / 焙煎) は色に使わない。砂色へ沈むのは**経年**の表現で、カテゴリーの
 * 表現ではないので同居してよい。
 *
 * ## なぜ SVG ではなく Canvas なのか
 *
 * レンズとスクラバーで 40 点の見え方が**毎フレーム**変わる。SVG で描くと切替の
 * たびに 40 個の `radialGradient` を defs ごと組み替えることになる。原版は
 * Canvas で 40 点 / 実 GPU 114fps の実績があり、そちらに寄せてある。
 * React が持つのは枠と操作系 (レンズの押下状態・つまみ・カード) だけで、
 * **絵は effect の中で命令的に描く** (`components/viz/flavor/flavor-matrix.tsx`
 * と同じ作り)。
 *
 * ## 踏むと痛い 6 点 (原版の査定で潰した罠。値を動かすと再発する)
 *
 * 1. **「古さ」は表示区間の中で測り直す**。全期間の物差しのまま一ヶ月を見ると
 *    6 杯が全部「いま」の濃さで並び、区間の中の前後が消える。ただし正規化し
 *    きると三週間前の一杯が一年前のように砂色まで沈むので、杯数が 14 を下回っ
 *    たら古さの下限を上げる (`recencyFloor`)。
 * 2. **杯数が少ないと重心の線は「道」にならない**。6 杯で描くと渦のような鉤形
 *    が出る。8 杯を下回ったら線を消し、13 杯で完全に出す。**凡例の該当行も
 *    一緒に引っ込める** — 無い物の説明を残さない。
 * 3. **波紋は画面に常に一つ**。速くドラッグすると `pointermove` ごとに新しい杯
 *    が現れるため、杯ごとに輪を出すと実測 12 本が同時に開いて花火になる。開い
 *    ている輪が若い (240ms 未満) 間は新しく出さない。
 * 4. **消えるときは落下の逆再生にしない**。落下と同じ 44px を巻き戻すと点が飛
 *    び上がって画面が騒がしくなる。上へ 14px だけ引き上げながら淡くする。
 * 5. **選択の輪は一本だけ (r=24)**。最新の一杯には元から輪 (r=17) があり、二重
 *    丸を足すと同心円が 4 本並んで的になる。重なるときは元の輪を描かない。
 * 6. **札は点の 34px 上**。18px だと r=24 の輪を紙が踏む。
 *
 * ## 移植で原版と変えたところ
 *
 * - **旅路の曲線は d3-shape (Catmull-Rom) ではなく中点二次曲線**。点は既に
 *   1-2-1 の重みで 2 回ならしてあり、両者の見た目の差は無い。曲線 1 本のため
 *   に依存を増やさない。
 * - **一言の折り返しは budoux を使わず CSS の `word-break: auto-phrase`**。
 *   ブラウザ任せの折り返しは「飲みた／くなる」のような切れ方をするが、
 *   文節折りのために依存を増やすほどではない。非対応ブラウザでは素の折り返し
 *   に落ちるだけで、意味は失われない。
 * - 原版は全画面前提だった。ページの中の箱に収まるよう、作図面は上下の文字帯
 *   (レンズ / 凡例 / スクラバー) を避けた矩形に閉じ込めてある。
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド `33-footprints-interactive/`
 * (第4ラウンド `22-footprints/` の堆積・落下・波紋が土台)。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  LOG_CATEGORY_LABEL,
  LOG_COLOR,
  TEA_CUPS,
  TIME_LENSES,
  agedLook,
  type TeaCup,
} from "@/lib/roji/me/tea-log";
import { FLAVOR_AXIS } from "@/lib/roji/tea-flavor";
import { NARROW_PLANE, drawQuadrantAxesCanvas, quadrantLayout, type QuadrantLayout } from "@/lib/viz/quadrant";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, hexToRgb } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/* ── 色は必ずパレット由来にする (`.tsx` に生の色を書かない) ───────────────── */
const SUMI_RGB = hexToRgb(ROJI_VIZ_COLOR.sumi);
/** 墨に不透明度を載せた `rgba(...)`。パレットの実値から毎回組み立てる。 */
function sumiAlpha(alpha: number): string {
  return `rgba(${SUMI_RGB[0]}, ${SUMI_RGB[1]}, ${SUMI_RGB[2]}, ${alpha})`;
}

const CUP_COUNT = TEA_CUPS.length;

/** 和紙のざらつき。色を持たない (輝度ノイズだけの) フィルタなので地の色を汚さない。 */
const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' seed='9'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const PAPER_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' seed='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E\")";

/**
 * 文節で折る指定。`word-break: auto-phrase` は CSS の型定義にまだ無い。
 * budoux を足さずに日本語の折り返しを整える唯一の手で、非対応ブラウザでは
 * 素の折り返しに落ちるだけなので、型の穴だけをここで塞ぐ。
 */
const PHRASE_BREAK = { wordBreak: "auto-phrase" } as unknown as CSSProperties;

/** 出現の速さ。落下 (スクラバー由来) とフェード (レンズ由来) で由来を分ける。 */
const DURATION_IN = { fall: 620, fade: 700 } as const;
const DURATION_OUT = { fall: 380, fade: 520 } as const;
/** 波紋の寿命。この間は新しい輪を開かない (罠 3)。 */
const RIPPLE_LIFE = 620;
const RIPPLE_YOUNG = 240;

/** 作図面が避ける上下の帯。レンズ / 凡例 / スクラバーが載る。 */
const RESERVE = {
  wide: { top: 104, bottom: 130 },
  narrow: { top: 52, bottom: 116 },
} as const;

/** マークの大きさの基準。原版の全画面の作図面幅。 */
const REFERENCE_PLANE_WIDTH = 1100;

type Point = [number, number];
type AppearMode = "fall" | "fade";

interface CupAnim {
  /** 0 = 居ない / 1 = 居る。 */
  p: number;
  target: number;
  mode: AppearMode;
  /** 経過 ms。-1 = 波紋なし。 */
  ripple: number;
}

/** DOM 側が要る値だけを React に持たせる。毎フレームは動かさない。 */
interface Chrome {
  lens: number;
  /** いちばん新しい一杯まで見ているか (見出しの言葉が入れ替わる)。 */
  live: boolean;
  nowLabel: string;
  nowSeason: string;
  shown: number;
  total: number;
  valueText: string;
  /** 旅路の濃さ。凡例の該当行がこれで薄くなる。 */
  trail: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function easeOut(u: number): number {
  return 1 - Math.pow(1 - u, 3);
}

/** Canvas には letter-spacing が無いので、原版と同じく字の間に空白を差す。 */
function spaced(value: string): string {
  return value.split("").join(" ");
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 旅路が描ける濃さ。8 杯を下回ったら 0、13 杯で 1 (罠 2)。 */
function trailStrength(count: number): number {
  return clamp((count - 8) / 5, 0, 1);
}

/** 表示杯数が少ないときの「古さ」の下限 (罠 1)。 */
function recencyFloor(count: number): number {
  return count >= 14 ? 0 : 0.34 * (1 - count / 14);
}

function initialChrome(): Chrome {
  const cup = TEA_CUPS[CUP_COUNT - 1];
  const total = TIME_LENSES[0].count;
  return {
    lens: 0,
    live: true,
    nowLabel: cup.label,
    nowSeason: cup.season,
    shown: total,
    total,
    valueText: `${cup.season} ${cup.label}`,
    trail: trailStrength(total),
  };
}

export interface FootprintsSceneProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function FootprintsScene({ label, className }: FootprintsSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [chrome, setChrome] = useState<Chrome>(initialChrome);
  /** 開いている記憶カードの杯 (index)。null = 閉じている。 */
  const [selected, setSelected] = useState<number | null>(null);
  /** 枠の大きさが変わった回数。カードの置き直しだけがこれを見る。 */
  const [geomVersion, setGeomVersion] = useState(0);

  const chromeRef = useRef<Chrome>(chrome);
  const draggingRef = useRef(false);
  /** 描画側が決めた枠と作図面。カードの置き場の計算が読む。 */
  const geomRef = useRef<{ width: number; height: number; layout: QuadrantLayout | null }>({
    width: 0,
    height: 0,
    layout: null,
  });
  /** 操作の入口。JSX のハンドラから呼ぶ (実体は描画 effect の中にある)。 */
  const apiRef = useRef<{ setLens: (k: number) => void; setT: (v: number) => void } | null>(null);

  useEffect(() => {
    const hostNode = hostRef.current;
    const canvasNode = canvasRef.current;
    if (!hostNode || !canvasNode) return;
    const context = canvasNode.getContext("2d");
    if (!context) return;
    // 下の関数群は closure なので、TS は `ref.current` の宣言型 (… | null) に
    // 戻して見る。非 null が確定した実体をここで束ね直し、以降はこちらだけを
    // 触る (各関数の頭で null 判定を繰り返さないため)。
    const host: HTMLDivElement = hostNode;
    const canvas: HTMLCanvasElement = canvasNode;
    const ctx: CanvasRenderingContext2D = context;

    const reduced = prefersReducedMotion();

    /* ── 状態 (毎フレーム動くので React には載せない) ── */
    const state = {
      lens: 0,
      /** スクラバー位置。0 = はじめ / 1 = いま。 */
      t: 1,
      selected: -1,
      from: 0,
      lastIdx: CUP_COUNT - 1,
      shown: CUP_COUNT,
      trailA: 1,
    };
    const anims: CupAnim[] = TEA_CUPS.map(() => ({ p: 1, target: 1, mode: "fall", ripple: -1 }));

    let width = 0;
    let height = 0;
    let dpr = 1;
    let narrow = false;
    /** マークの縮尺。枠が小さいほど点も小さくする (下限は堆積が読める大きさ)。 */
    let markScale = 1;
    let layout: QuadrantLayout | null = null;
    let plate: HTMLCanvasElement | null = null;
    let running = false;
    let frame = 0;
    let last = 0;

    /* ── 枠と、軸だけを焼いた下地 ──────────────────────────────────────── */
    function build() {
      const nextW = host.clientWidth;
      const nextH = host.clientHeight;
      if (nextW < 2 || nextH < 2) return;
      width = nextW;
      height = nextH;
      narrow = width < NARROW_PLANE;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const reserve = narrow ? RESERVE.narrow : RESERVE.wide;
      const inner = Math.max(96, height - reserve.top - reserve.bottom);
      const base = quadrantLayout(width, inner, narrow ? { x: 16, y: 20 } : { x: 56, y: 24 });
      // 作図面を上の帯のぶんだけ下げる。`quadrantLayout` は上下対称の余白しか
      // 持たないので、縦は「使ってよい高さ」を渡してから平行移動する。
      layout = {
        ...base,
        height,
        top: base.top + reserve.top,
        cy: base.cy + reserve.top,
        sy: (y: number) => base.sy(y) + reserve.top,
      };
      markScale = Math.min(1.1, Math.max(0.5, layout.planeWidth / REFERENCE_PLANE_WIDTH));
      geomRef.current = { width, height, layout };

      plate = document.createElement("canvas");
      plate.width = canvas.width;
      plate.height = canvas.height;
      const plateCtx = plate.getContext("2d");
      if (!plateCtx) return;
      plateCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      plateCtx.fillStyle = ROJI_VIZ_COLOR.kinari;
      plateCtx.fillRect(0, 0, width, height);
      drawQuadrantAxesCanvas(plateCtx, layout, FLAVOR_AXIS);
    }

    /* ── 表示範囲 ───────────────────────────────────────────────────────
       レンズが「どこから」を、スクラバーが「どこまで」を決める。
       区間は必ず連続 [from .. lastIdx]。 */
    function resolve() {
      const lens = TIME_LENSES[state.lens];
      // 0 杯を許すと「何も無い画面」が出るので下限は 1 杯。
      const shown = clamp(Math.round(state.t * lens.count), 1, lens.count);
      state.from = lens.from;
      state.shown = shown;
      state.lastIdx = lens.from + shown - 1;
    }

    function syncChrome() {
      const cup = TEA_CUPS[state.lastIdx];
      const total = TIME_LENSES[state.lens].count;
      const live = state.t >= 0.999;
      const prev = chromeRef.current;
      if (
        prev.lens === state.lens &&
        prev.live === live &&
        prev.shown === state.shown &&
        prev.total === total
      ) {
        return;
      }
      const next: Chrome = {
        lens: state.lens,
        live,
        nowLabel: cup.label,
        nowSeason: cup.season,
        shown: state.shown,
        total,
        valueText: `${cup.season} ${cup.label}`,
        trail: trailStrength(state.lastIdx - state.from + 1),
      };
      chromeRef.current = next;
      setChrome(next);
    }

    function syncKnob() {
      const knob = knobRef.current;
      if (knob) knob.style.left = `${(state.t * 100).toFixed(3)}%`;
    }

    function closeCard() {
      if (state.selected < 0) return;
      state.selected = -1;
      setSelected(null);
    }

    /* ── 目標値の更新 ───────────────────────────────────────────────────
       mode: 'fall' = スクラバー由来 (落ちる) / 'fade' = レンズ由来 (淡く増減)。
       由来が違えば動きも違う、という約束を守るための分岐。 */
    function retarget(mode: AppearMode) {
      resolve();
      let newest = -1;
      for (let i = 0; i < CUP_COUNT; i++) {
        const want = i >= state.from && i <= state.lastIdx ? 1 : 0;
        const anim = anims[i];
        if (anim.target === want) continue;
        anim.target = want;
        anim.mode = mode;
        // 隠れていた杯が現れる瞬間だけ覚える (波紋はこの中の最新 1 杯にしか出さない)。
        if (want === 1 && anim.p < 0.05 && i > newest) newest = i;
      }
      if (mode === "fall" && newest >= 0 && !reduced) {
        const young = anims.some((a) => a.ripple >= 0 && a.ripple < RIPPLE_YOUNG);
        if (!young) {
          for (const a of anims) a.ripple = -1;
          anims[newest].ripple = 0;
        }
      }
      // レンズやスクラバーで対象が範囲外になったら、開いている紙は自動で畳む。
      if (state.selected >= 0 && (state.selected < state.from || state.selected > state.lastIdx)) {
        closeCard();
      }
      syncChrome();
      kick();
    }

    /* ── 1 フレーム分だけ時間を進める ── */
    function step(dt: number) {
      for (const anim of anims) {
        const duration = anim.target === 1 ? DURATION_IN[anim.mode] : DURATION_OUT[anim.mode];
        const d = dt / duration;
        anim.p = anim.target === 1 ? Math.min(1, anim.p + d) : Math.max(0, anim.p - d);
        if (anim.ripple >= 0) {
          anim.ripple += dt;
          if (anim.ripple > RIPPLE_LIFE) anim.ripple = -1;
        }
      }
      const want = trailStrength(state.lastIdx - state.from + 1);
      state.trailA += clamp(want - state.trailA, -dt / 500, dt / 500);
    }

    function isSettled(): boolean {
      for (const anim of anims) {
        if (anim.ripple >= 0) return false;
        if (anim.p !== anim.target) return false;
      }
      return state.trailA === trailStrength(state.lastIdx - state.from + 1);
    }

    /* ── 旅路 (重心の移動) ──────────────────────────────────────────────
       飲んだ順に点を直接つなぐと蜘蛛の巣になるので、窓をずらした重心を描く。
       レンズで杯数が減ると窓 9 は使えないため、杯数に応じて窓を縮める。 */
    function driftPath(cups: readonly { x: number; y: number }[]): Point[] | null {
      if (!layout) return null;
      const plane = layout;
      const n = cups.length;
      if (n < 5) return null;
      const win = clamp(Math.round(n * 0.24), 2, 9);
      const centroid = (seg: readonly { x: number; y: number }[]): Point => [
        plane.sx(seg.reduce((s, c) => s + c.x, 0) / seg.length),
        plane.sy(seg.reduce((s, c) => s + c.y, 0) / seg.length),
      ];
      let pts: Point[] = [];
      for (let i = win - 1; i < n; i++) pts.push(centroid(cups.slice(i - win + 1, i + 1)));
      // 終端は窓を段階的に絞って寄せる。一本で飛ばすとその区間だけ膨らむ。
      // ただし杯数が少ないときに 5→1 を全部足すと、終端の 4 点だけで道の形が
      // 決まって鉤状になるので、半分より大きい窓は使わない。
      for (const w of [5, 3, 2, 1]) {
        if (w < n / 2) pts.push(centroid(cups.slice(n - w)));
      }
      const smooth = (ps: Point[]): Point[] =>
        ps.map((p, i) => {
          if (i === 0 || i === ps.length - 1) return p;
          const a = ps[i - 1];
          const b = ps[i + 1];
          return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as Point;
        });
      for (let k = 0; k < 2; k++) pts = smooth(pts);
      return pts;
    }

    /**
     * 中点二次曲線。d3-shape の Catmull-Rom の代わり。
     * 点は既に 2 回ならしてあるので、見た目の差は出ない。
     */
    function tracePath(pts: Point[]) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 2) {
        ctx.lineTo(pts[1][0], pts[1][1]);
        return;
      }
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const tail = pts.length - 1;
      ctx.quadraticCurveTo(pts[tail - 1][0], pts[tail - 1][1], pts[tail][0], pts[tail][1]);
    }

    function drawLabel(text: string, x: number, y: number, opacity: number, size: number) {
      ctx.save();
      ctx.font = `300 ${size}px ${ROJI_VIZ_SERIF}`;
      ctx.fillStyle = ROJI_VIZ_COLOR.sumi;
      ctx.globalAlpha = clamp(opacity, 0, 1);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(spaced(text), x, y);
      ctx.restore();
    }

    /* ── 描画 ── */
    function draw() {
      if (!layout || !plate) return;
      const plane = layout;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(plate, 0, 0, width, height);

      const span = Math.max(1, state.lastIdx - state.from);
      const floor = recencyFloor(state.lastIdx - state.from + 1);
      const alphaHex = (v: number) =>
        Math.round(clamp(v, 0, 1) * 255)
          .toString(16)
          .padStart(2, "0");

      /* 1. 堆積 */
      ctx.globalCompositeOperation = "multiply";
      for (let i = 0; i < CUP_COUNT; i++) {
        const anim = anims[i];
        if (anim.p <= 0.001) continue;
        const cup = TEA_CUPS[i];
        const e = easeOut(anim.p);
        // 「新しさ」は表示区間の中で測り直す。下限を持たせないと、短い区間で
        // 三週間前の一杯が一年前のように砂色まで沈む (罠 1)。
        const rec = floor + (1 - floor) * clamp((i - state.from) / span, 0, 1);
        const isNewest = i === state.lastIdx;
        const look = agedLook(cup, rec, (isNewest ? 17 : 15) * markScale);

        const x = plane.sx(cup.x);
        // 落下は下向き。消えるときは巻き戻さず、上へ 14px だけ引き上げる (罠 4)。
        const lift =
          anim.mode === "fall" ? (1 - e) * (isNewest ? 90 : 44) : (1 - e) * 14;
        const y = plane.sy(cup.y) - lift;
        const grow = 0.55 + 0.45 * e;

        const spread = look.radius * (2.9 - 1.2 * rec) * grow;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, spread);
        const a0 = (0.24 + 0.34 * rec) * e;
        gradient.addColorStop(0, look.color + alphaHex(a0));
        gradient.addColorStop(0.55, look.color + alphaHex(a0 * 0.42));
        gradient.addColorStop(1, look.color + alphaHex(0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, spread, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = look.opacity * e;
        ctx.fillStyle = look.color;
        ctx.beginPath();
        ctx.arc(x, y, look.radius * 0.55 * grow, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // 直近の杯にだけ墨の芯。にじみの中で位置を見失わせない。
        if (rec > 0.82 && anim.p > 0.9) {
          ctx.fillStyle = ROJI_VIZ_COLOR.sumi;
          ctx.globalAlpha = (rec - 0.82) * 3 * anim.p;
          ctx.beginPath();
          ctx.arc(x, y, 1.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // 波紋 — 落ちた瞬間の一度きり。画面に常に一つしか無い (罠 3)。
        if (anim.ripple >= 0) {
          const u = easeOut(anim.ripple / RIPPLE_LIFE);
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = ROJI_VIZ_COLOR.sumi;
          ctx.globalAlpha = (1 - u) * 0.3;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(
            plane.sx(cup.x),
            plane.sy(cup.y),
            (6 + u * (isNewest ? 62 : 34)) * markScale,
            0,
            Math.PI * 2
          );
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "multiply";
        }
      }
      ctx.globalCompositeOperation = "source-over";

      /* 2. 旅路 */
      const visible: TeaCup[] = [];
      for (let i = state.from; i <= state.lastIdx; i++) {
        if (anims[i].p > 0.35) visible.push(TEA_CUPS[i]);
      }
      const pts = state.trailA > 0.02 ? driftPath(visible) : null;
      if (pts && pts.length > 1) {
        const gradient = ctx.createLinearGradient(
          pts[0][0],
          pts[0][1],
          pts[pts.length - 1][0],
          pts[pts.length - 1][1]
        );
        gradient.addColorStop(0, sumiAlpha(0.04));
        gradient.addColorStop(0.45, sumiAlpha(0.13));
        gradient.addColorStop(1, sumiAlpha(0.34));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = state.trailA;
        tracePath(pts);
        ctx.stroke();

        // 起点 — この幅での「はじめ」。目盛りの代わりに言葉を置く。
        const [fx, fy] = pts[0];
        ctx.globalAlpha = 0.36 * state.trailA;
        ctx.fillStyle = ROJI_VIZ_COLOR.kinari;
        ctx.strokeStyle = ROJI_VIZ_COLOR.sumi;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawLabel(TIME_LENSES[state.lens].origin, fx, fy - 17, 0.4 * state.trailA, narrow ? 10 : 11.5);
      }

      /* 3. 言葉 — 4 杯以上戻った茶と、いちばん新しい一杯だけ */
      const newest = TEA_CUPS[state.lastIdx];
      // 狭い枠では銘柄名を並べない。隣同士が重なってどれも読めなくなる
      // (味の四象限と同じ作法)。名前は触れたときの紙で出るので情報は残る。
      if (!narrow) {
        const counts = new Map<string, number>();
        for (const cup of visible) counts.set(cup.teaId, (counts.get(cup.teaId) ?? 0) + 1);
        for (const [teaId, count] of counts) {
          if (count < 4 || teaId === newest.teaId) continue;
          const same = visible.filter((c) => c.teaId === teaId);
          const mx = same.reduce((s, c) => s + c.x, 0) / same.length;
          const my = same.reduce((s, c) => s + c.y, 0) / same.length;
          // 塊の下 54px。42px だと同じ茶が縦に積もった場所で文字が塊に噛む。
          drawLabel(same[0].label, plane.sx(mx), plane.sy(my) + 34 + 20 * markScale, 0.5, 11.5);
        }
      }

      const newestAlpha = anims[state.lastIdx].p;
      if (newestAlpha > 0.05) {
        const lx = plane.sx(newest.x);
        const ly = plane.sy(newest.y);
        // 選ばれた杯が最新の杯と同じときは輪を重ねない (的のような二重丸になる)。
        if (state.selected !== state.lastIdx) {
          ctx.globalAlpha = 0.42 * newestAlpha;
          ctx.strokeStyle = ROJI_VIZ_COLOR.sumi;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(lx, ly, 17, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // 狭い枠では最新の一杯の名前も打たない。実測 (390px 幅) で軸の
        // 「甘 み」に噛んだ。銘柄は右下の「いまの一杯」が言葉で出しており、
        // 輪だけ残せばどれが最新かは分かる。
        if (!narrow) {
          drawLabel(newest.label, lx, ly + 22 + 14 * markScale, 0.75 * newestAlpha, 12.5);
        }
      }

      /* 4. 選ばれた一杯 — 輪は一本だけ (罠 5)。芯の外側に置いて塊に噛ませない。 */
      if (state.selected >= 0) {
        const cup = TEA_CUPS[state.selected];
        ctx.strokeStyle = ROJI_VIZ_COLOR.sumi;
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(plane.sx(cup.x), plane.sy(cup.y), 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /* ── 動かす / 動かさない ────────────────────────────────────────────
       `prefers-reduced-motion: reduce` では rAF を回さず、落ち着いた 1 枚を
       描くだけにする (味の四象限と同じ扱い)。 */
    function settle() {
      for (const anim of anims) {
        anim.p = anim.target;
        anim.ripple = -1;
      }
      state.trailA = trailStrength(state.lastIdx - state.from + 1);
      draw();
    }

    function tick(now: number) {
      const dt = Math.min(64, now - last); // タブ復帰で一気に飛ばさない
      last = now;
      step(dt);
      draw();
      if (isSettled()) {
        running = false;
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    function kick() {
      if (reduced) {
        settle();
        return;
      }
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }

    /* ── 操作 ── */
    function setLens(k: number) {
      if (k === state.lens || k < 0 || k >= TIME_LENSES.length) return;
      state.lens = k;
      state.t = 1; // レンズを変えたら、その期間の「いま」に戻す
      syncKnob();
      retarget("fade"); // レンズ由来はフェードで増減する (落下させない)
    }

    function setT(value: number) {
      const next = clamp(value, 0, 1);
      if (Math.abs(next - state.t) < 1e-6) return;
      state.t = next;
      syncKnob();
      retarget("fall");
    }

    apiRef.current = { setLens, setT };

    /* ── 当たり判定 ─────────────────────────────────────────────────────
       手前 (新しい) の杯を優先する。堆積しているので、古い杯を拾うと
       触った感じと合わない。 */
    function hit(px: number, py: number): number {
      if (!layout) return -1;
      const plane = layout;
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = state.lastIdx; i >= state.from; i--) {
        if (anims[i].p < 0.5) continue;
        const cup = TEA_CUPS[i];
        const d = Math.hypot(px - plane.sx(cup.x), py - plane.sy(cup.y));
        const rec = clamp((i - state.from) / Math.max(1, state.lastIdx - state.from), 0, 1);
        // 指で触れる大きさを下限にする。点の見た目より当たりは広く取る。
        const r = Math.max(18, 15 * markScale * (0.42 + 0.58 * rec) * 0.55 + 13);
        if (d < r && d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      return best;
    }

    function handleCanvasPointerDown(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      const index = hit(event.clientX - rect.left, event.clientY - rect.top);
      if (index >= 0) {
        state.selected = index;
        setSelected(index);
      } else {
        closeCard();
      }
      draw();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeCard();
      draw();
    }

    canvas.addEventListener("pointerdown", handleCanvasPointerDown);
    window.addEventListener("keydown", handleKeyDown);

    build();
    resolve();
    syncKnob();
    draw();

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        build();
        draw();
        // 投影が変われば紙の置き場も意味を失うので、置き直しだけ React に頼む。
        setGeomVersion((v) => v + 1);
      }, 200);
    });
    observer.observe(host);

    return () => {
      apiRef.current = null;
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  /* ── 記憶カードの置き場 ───────────────────────────────────────────────
     点の右上に置く。枠からはみ出す側では反対に回す。18px だと選択の輪
     (r=24) を紙が踏むので 34px まで逃がす (罠 6)。 */
  useLayoutEffect(() => {
    const card = cardRef.current;
    const { width, height, layout } = geomRef.current;
    if (selected === null || !card || !layout) return;
    const cup = TEA_CUPS[selected];
    const x = layout.sx(cup.x);
    const y = layout.sy(cup.y);
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = x + 34;
    let top = y - h - 34;
    if (left + w > width - 12) left = x - w - 34;
    if (top < 12) top = y + 34;
    card.style.left = `${clamp(left, 12, Math.max(12, width - w - 12))}px`;
    card.style.top = `${clamp(top, 12, Math.max(12, height - h - 12))}px`;
    if (!prefersReducedMotion() && typeof card.animate === "function") {
      card.animate(
        [
          { opacity: 0, transform: "translateY(7px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 260, easing: "ease" }
      );
    }
  }, [selected, geomVersion]);

  /* ── スクラバー ── */
  const tFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x0 = rect.left + 1;
    const x1 = rect.right - 1;
    return (clientX - x0) / Math.max(1, x1 - x0);
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    apiRef.current?.setT(tFromClientX(event.clientX));
    event.preventDefault();
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    apiRef.current?.setT(tFromClientX(event.clientX));
  };

  const handleTrackPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleTrackKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    if (!api) return;
    // 1 押しでちょうど一杯ぶん動く。杯数はレンズごとに違う。
    const step = 1 / chrome.total;
    const current = chrome.shown / chrome.total;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") api.setT(current - step);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") api.setT(current + step);
    else if (event.key === "Home") api.setT(0);
    else if (event.key === "End") api.setT(1);
    else return;
    event.preventDefault();
  };

  const openCup = selected === null ? null : TEA_CUPS[selected];
  const captionColor = ROJI_VIZ_COLOR.sumi;

  return (
    <div data-slot="footprints-scene" className={cn("flex flex-col", className)}>
      <div
        ref={hostRef}
        className="relative h-120 w-full overflow-hidden select-none sm:h-140 lg:h-160"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari, color: captionColor }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
          style={{ touchAction: "manipulation" }}
        />

        {/* 和紙のざらつき。地の色を殺さないよう乗算で薄く敷く。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: GRAIN_URL, opacity: 0.05, mixBlendMode: "multiply" }}
        />

        {/* 時間レンズ。狭い枠では横一列にして、見出しを落とす。 */}
        <nav
          aria-label="時 の 幅"
          className="absolute top-3 right-3 flex flex-row items-center gap-4 sm:top-6 sm:right-6 sm:flex-col sm:items-end sm:gap-0"
        >
          <span
            className="roji-viz-caption-wide hidden sm:mb-3 sm:block"
            style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 9.5, opacity: 0.32 }}
            aria-hidden="true"
          >
            時 の 幅
          </span>
          {TIME_LENSES.map((lens, index) => (
            <button
              key={lens.key}
              type="button"
              aria-pressed={chrome.lens === index}
              onClick={() => apiRef.current?.setLens(index)}
              className="roji-viz-caption relative block cursor-pointer transition-opacity duration-500 sm:py-1.5"
              style={{
                fontFamily: ROJI_VIZ_SERIF,
                fontWeight: 300,
                fontSize: 11,
                color: captionColor,
                opacity: chrome.lens === index ? 0.85 : 0.34,
              }}
            >
              {lens.label}
              <span
                aria-hidden="true"
                className="absolute right-0 bottom-0 left-0 block h-px transition-opacity duration-500"
                style={{
                  backgroundColor: captionColor,
                  opacity: chrome.lens === index ? 0.32 : 0,
                }}
              />
            </button>
          ))}
        </nav>

        {/* 凡例。旅路の行は、道が描けない杯数のとき一緒に引っ込む (罠 2)。 */}
        <div
          aria-hidden="true"
          className="roji-viz-caption pointer-events-none absolute bottom-16 left-3 sm:bottom-24 sm:left-6"
          style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 10, lineHeight: 2.1, opacity: 0.72 }}
        >
          {/* 色はカテゴリーを表す。1 枚の図に載るのは同じカテゴリーの茶だけ
              なので、色の行は 1 行しか要らない。系統 (蒸し / 釜炒り / 焙煎) で
              色を割ると「カテゴリーを跨いだ比較」の絵になる。 */}
          <div className="flex items-center">
            <span
              className="mr-2.5 inline-block shrink-0 rounded-full"
              style={{ width: 12, height: 12, backgroundColor: LOG_COLOR, opacity: 0.6 }}
            />
            {LOG_CATEGORY_LABEL} の 足 あ と
          </div>
          <div className="flex items-center">
            <span
              className="mr-2.5 inline-block shrink-0 rounded-full"
              style={{ width: 7, height: 7, backgroundColor: ROJI_VIZ_COLOR.suna, opacity: 0.75 }}
            />
            昔 の 一 杯 ／ 淡 く 沈 む
          </div>
          <div
            className="flex items-center transition-opacity duration-500"
            style={{ opacity: 0.26 + 0.74 * chrome.trail }}
          >
            <span
              className="mr-2.5 inline-block h-px shrink-0"
              style={{ width: 16, backgroundColor: captionColor, opacity: 0.5 }}
            />
            好 み が 移 っ て き た 道
          </div>
        </div>

        {/* 見出し。遡っていることを言葉で保証する。 */}
        <div className="pointer-events-none absolute right-3 bottom-16 text-right sm:right-6 sm:bottom-24">
          <div
            className="roji-viz-caption-wide"
            style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 10, opacity: 0.5 }}
          >
            {chrome.live ? "いまの一杯" : "このときの一杯"}
          </div>
          <div
            className="roji-viz-caption mt-2"
            style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 14 }}
          >
            {chrome.nowLabel}
          </div>
          <div
            className="roji-viz-caption mt-1.5"
            style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 10, opacity: 0.55 }}
          >
            {chrome.nowSeason}
          </div>
        </div>

        {/* 時間スクラバー。目盛りは無く、両端に「はじめ」「いま」の 2 語だけ。 */}
        <div className="absolute right-3 bottom-3 left-3 sm:right-6 sm:left-6">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="時をさかのぼる"
            aria-valuemin={1}
            aria-valuenow={chrome.shown}
            aria-valuemax={chrome.total}
            aria-valuetext={chrome.valueText}
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerEnd}
            onPointerCancel={handleTrackPointerEnd}
            onKeyDown={handleTrackKeyDown}
            className="relative h-7 w-full cursor-ew-resize outline-none"
            style={{ touchAction: "none" }}
          >
            <span
              aria-hidden="true"
              className="absolute top-1/2 right-0 left-0 block h-px"
              style={{ backgroundColor: captionColor, opacity: 0.22 }}
            />
            <div
              ref={knobRef}
              aria-hidden="true"
              className="absolute top-0 h-7"
              style={{ left: "100%", transform: "translateX(-50%)" }}
            >
              <span
                className="absolute left-0 block w-px"
                style={{ top: 8, height: 12, backgroundColor: captionColor, opacity: 0.55 }}
              />
              <span
                className="absolute block rounded-full"
                style={{
                  left: -2,
                  top: 12,
                  width: 4,
                  height: 4,
                  backgroundColor: ROJI_VIZ_COLOR.kinari,
                  boxShadow: `0 0 0 0.5px ${sumiAlpha(0.75)}`,
                }}
              />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="roji-viz-caption-wide flex justify-between"
            style={{ fontFamily: ROJI_VIZ_SERIF, fontSize: 9.5, opacity: 0.42 }}
          >
            <span>は じ め</span>
            <span>い ま</span>
          </div>
        </div>

        {/* 一杯の記憶カード。何杯目 / 銘柄 / 季節の言葉 / 自分の一言 の 4 つだけ。
            日付も回数も出さない。 */}
        {openCup ? (
          <div
            ref={cardRef}
            data-slot="footprints-card"
            aria-live="polite"
            className="absolute z-10 box-border"
            style={{
              width: 268,
              maxWidth: "calc(100% - 24px)",
              padding: "26px 28px 28px",
              backgroundColor: ROJI_VIZ_COLOR.kinari,
              boxShadow: `0 0 0 0.5px ${sumiAlpha(0.16)}, 0 10px 30px ${sumiAlpha(0.1)}`,
              fontFamily: ROJI_VIZ_SERIF,
              color: captionColor,
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: PAPER_URL, opacity: 0.055, mixBlendMode: "multiply" }}
            />
            <div className="roji-viz-caption-wide" style={{ fontSize: 9.5, opacity: 0.45 }}>
              {openCup.nth}
            </div>
            <div
              className="roji-viz-caption mt-3"
              style={{ fontSize: 16, lineHeight: 1.5 }}
            >
              {openCup.label}
            </div>
            <div
              aria-hidden="true"
              className="h-px"
              style={{ width: 26, margin: "17px 0 15px", backgroundColor: captionColor, opacity: 0.28 }}
            />
            <div className="roji-viz-caption-wide" style={{ fontSize: 10.5, opacity: 0.6 }}>
              {openCup.season}
            </div>
            <div
              className="mt-4"
              style={{ ...PHRASE_BREAK, fontSize: 11.5, letterSpacing: "0.1em", lineHeight: 2.1, opacity: 0.82 }}
            >
              {openCup.voice}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

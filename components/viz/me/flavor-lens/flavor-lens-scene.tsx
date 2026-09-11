"use client";

/**
 * 好みの位置 — 味の四象限の「手もとのレンズ」。
 *
 * 甘み⇄渋み × 軽やか⇄濃厚 の 1 枚に、3 つのレンズを重ねて手もとで切り替える。
 *
 * | レンズ | 何が起きるか |
 * |---|---|
 * | ① 銘柄の散布 (緑茶 / 紅茶 / 青茶) | そのカテゴリだけを出す。切替は絞り込みそのもの |
 * | ② 自分の足あと | 飲んできた 40 杯を同じ座標系に薄く敷く |
 * | ③ 表現 (円 ⇄ にじみ) | 定型の円と、にじむハローを行き来する |
 *
 * 点に触れると銘柄カードが開き、ホバーすると **味の近い銘柄だけ**が香り立つ。
 *
 * ## なぜ Canvas 1 枚で、React に描かせないのか
 *
 * 3 つのレンズは独立に効くので、状態の組み合わせは 3 × 2 × 2 = 12 通りある。
 * DOM を組み替える作りだと切替のたびに 26 銘柄 + 40 杯の要素を作り直すことに
 * なるが、**すべての要素が 0→1 の実数を 1 つ持ち、毎フレーム目標へ寄る**だけなら
 * 12 通りが 1 本の式で繋がる (`v += (target - v) * (1 - exp(-dt/τ))`, τ=0.20 秒)。
 * 切替が「別の地図に飛んだ」ではなく「同じ紙の上で入れ替わった」と読めるのは、
 * 両方が一度に見えるクロスフェードだからで、瞬間の差し替えでは出ない。
 * React が持つのは枠・レンズの文字・凡例・銘柄カードだけ
 * (`components/viz/flavor/flavor-matrix.tsx` と同じ分担)。
 *
 * ## 踏むと痛い 7 点 (すべて原版で実測済み。触る前に読むこと)
 *
 * 1. **生成りの紙の上で「明るくする」= 不透明度を上げる、ではない**。芯の円を
 *    濃くすると紙の上では暗くなり、狙いと逆の絵になる。紙を白く抜くだけでも
 *    今度は「白いモヤ」に見える。正解は **その茶の色のにじみを咲かせる**こと。
 *    にじみは表現レンズの資産そのままで、`A = 0.82*mode + 0.62*glow` と足すだけ
 * 2. **ホバー中は遠い味を 40% 引く**。近い側を上げるだけでは画面全体が濃くなって
 *    差が出ない
 * 3. **距離は画面のピクセルではなく味の座標で測る** (`exp(-d²/2σ²)`, σ=0.42)。
 *    作図面の縦横比が変わっても「近い味」の範囲が変わらない
 * 4. **札の逃がし量は文字の実測幅で決める**。芯の半径 + 22px だけだと
 *    「白毫烏龍 摘みたて」のような長い名前が札の下に潜り込む。
 *    `measureText(名前).width / 2 + 18` と比べて大きいほうを使う
 * 5. **`measureText` の直前に必ず `ctx.font` を設定し直す**。描画ループの最後には
 *    一言用の小さい font が残っているので、測り値が名前の実寸にならない
 * 6. **足あたを敷いている間は銘柄の円を 22% 引く**。同じ濃さのままだと、どちらが
 *    「いま話題にしている層」か分からない
 * 7. **分類の色は明度でなく分類上の位置で決める** (`lib/roji/me/tea-catalog.ts`)。
 *    半発酵を「淡いだろう」で置くと青茶だけ紙に溶ける
 *
 * ## 数字を出さない
 *
 * 軸に目盛も数値も置かない (`lib/viz/flavor-lens-canvas.ts` の目盛なし軸)。
 * 回数は漢数字 (`kanjiNumber`)、日付は季節の言葉 (`TeaCup.season`) が代わりに立つ。
 *
 * 出典: viz 査定 `verdicts.md` 第7ラウンド `31-flavor-interactive/01-lens.html`。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  AROMA_AXIS,
  CATALOG_BY_ID,
  CATALOG_LEGEND,
  CATALOG_TEAS,
  ME_PROCESS_LABEL,
  TEA_CATEGORIES,
  type CatalogTea,
  type TeaCategory,
} from "@/lib/roji/me/tea-catalog";
import { TEA_CUPS, agedLook, cupsOfTea, kanjiNumber } from "@/lib/roji/me/tea-log";
import { FLAVOR_AXIS } from "@/lib/roji/tea-flavor";
import {
  LENS_CARD_GRAIN_IMAGE,
  LENS_CARD_PAPER_GRADIENT,
  ROJI_LENS_COLOR,
  drawFlavorLensAxes,
  rgba,
  rgbaOf,
} from "@/lib/viz/flavor-lens-canvas";
import { NARROW_PLANE, quadrantLayout, type QuadrantLayout } from "@/lib/viz/quadrant";
import {
  ROJI_VIZ_COLOR,
  ROJI_VIZ_SERIF,
  hexToRgb,
  seededRandom,
} from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/** 原版 (フルスクリーン) の作図面幅。マークの大きさをここから相似で縮める。 */
const REFERENCE_PLANE_WIDTH = 945;
/** クロスフェードの時定数 (秒)。0.20 で「ふわっ」と入れ替わる。 */
const TAU = 0.2;
/** 香りが立つ速さ。切替より速くないとホバーが鈍く感じる。 */
const TAU_GLOW = 0.14;
/** 「近い味」とみなす広さ (味の座標)。これ以上広げると全部光って意味が消える。 */
const SIGMA = 0.42;
/** 銘柄カードの幅 (px)。`w-56` と対で維持する。 */
const CARD_WIDTH = 224;
/** カードを枠の内側にとどめる余白 (px)。 */
const CARD_MARGIN = 12;

type LensMode = "circle" | "halo";

/** 描画ループが読む「いまの指」。state を直接読むとループを張り直すことになる。 */
interface LensState {
  category: TeaCategory;
  footprints: boolean;
  mode: LensMode;
  selectedId: string | null;
}

interface LensPoint {
  tea: CatalogTea;
  /** 画面座標。作図面が変わるたびに置き直す。 */
  x: number;
  y: number;
  rgb: [number, number, number];
  /** 表示の実値 0..1 (カテゴリのクロスフェード)。 */
  a: number;
  /** 香りの立ち 0..1 (ホバーの近さ)。 */
  glow: number;
  /** 呼吸の位相。乱数を使わず id から決めるので毎回同じ絵になる。 */
  phase: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface FlavorLensSceneProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  /** 足あとレンズの初期値。マイページ文脈なので既定 true。 */
  defaultFootprints?: boolean;
  className?: string;
}

export function FlavorLensScene({
  label,
  defaultFootprints = true,
  className,
}: FlavorLensSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [category, setCategory] = useState<TeaCategory>("green");
  const [footprints, setFootprints] = useState(defaultFootprints);
  const [mode, setMode] = useState<LensMode>("circle");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * 描画ループから「いまの指」を読むための写し。
   *
   * レンズが変わるたびにループを張り直すと、クロスフェードの途中が切れて
   * 瞬間の差し替えになる。よってループは state ではなくこの ref を読む
   * (`components/viz/terroir/terroir-lens-map.tsx` の `lensRef` と同じ手)。
   */
  const stateRef = useRef<LensState>({
    category: "green",
    footprints: defaultFootprints,
    mode: "circle",
    selectedId: null,
  });
  /** 札を置き直す関数。描画側 (作図面と `measureText` を持つ) が入れる。 */
  const placeCardRef = useRef<(() => void) | null>(null);
  /** 動きを止める設定のときだけ実体が入る「1 枚だけ描き直す」関数。 */
  const repaintRef = useRef<(() => void) | null>(null);

  /* ── 指の写し。描画側より先に走るよう、描画の effect より上に置く ──
     `useLayoutEffect` なのは札の位置決めのため。通常の effect は **描画のあと**に
     走るので、開いた最初の 1 フレームだけ札が左上 (left/top 未設定) に出て
     ちらつく。この図は `ssr: false` でしか読まれないので SSR 警告は起きない。 */
  useLayoutEffect(() => {
    stateRef.current = { category, footprints, mode, selectedId };
    // 動きを止める設定では rAF が回っていないので、ここで 1 枚だけ描き直す。
    repaintRef.current?.();
    // 札は開いた瞬間・足あとの出し入れで高さが変わるので、そのつど置き直す。
    placeCardRef.current?.();
  }, [category, footprints, mode, selectedId]);

  /* ── 描画。1 度だけ組み、あとは ref 越しに指を読む ── */
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReducedMotion();

    const points: LensPoint[] = CATALOG_TEAS.map((tea, index) => ({
      tea,
      x: 0,
      y: 0,
      rgb: hexToRgb(tea.color),
      // 初期値は目標そのもの。入場でいきなりフェードさせない。
      a: tea.category === stateRef.current.category ? 1 : 0,
      glow: 0,
      phase: (((index * 37) % 100) / 100) * Math.PI * 2,
    }));

    // 履歴の 40 杯にカテゴリを紐付ける。いまのレンズと同じカテゴリの杯だけ濃く残る。
    const cups = TEA_CUPS.map((cup) => ({
      cup,
      category: (CATALOG_BY_ID.get(cup.teaId)?.category ?? "green") as TeaCategory,
    }));

    /** 実値 0..1。目標へ毎フレーム寄る (これが 12 通りを繋ぐ 1 本の式)。 */
    const value = {
      foot: stateRef.current.footprints ? 1 : 0,
      mode: stateRef.current.mode === "halo" ? 1 : 0,
    };
    /** ホバーの居場所。dx / dy は **味の座標系**。 */
    const cursor = { on: false, dx: 0, dy: 0, over: null as LensPoint | null };

    let width = 0;
    let height = 0;
    let layout: QuadrantLayout | null = null;
    let scale = 1;
    let narrow = false;
    let drift: [number, number][] = [];
    let grain: CanvasPattern | null = null;
    let frame = 0;
    let lastTime = 0;

    /** 芯の半径。円 (0) ⇄ にじみ (1) で **わずかに縮む**。 */
    const coreR = (p: LensPoint) => {
      const w = p.tea.weight;
      return ((7 + w * 7) * (1 - value.mode) + (6 + w * 5.5) * value.mode) * scale;
    };
    /** にじみの広がり。 */
    const haloR = (p: LensPoint) => (46 + p.tea.weight * 46) * scale;
    /** 銘柄名の font。`measureText` の直前にも必ずこれを当てる。 */
    const nameFont = () => `300 ${narrow ? 9.5 : 12.5}px ${ROJI_VIZ_SERIF}`;
    const noteFont = () => `300 ${narrow ? 8.5 : 10}px ${ROJI_VIZ_SERIF}`;

    /* ── 和紙の目。一度だけ焼いてタイルで敷く ── */
    const makeGrain = () => {
      const n = 160;
      const tile = document.createElement("canvas");
      tile.width = n;
      tile.height = n;
      const tctx = tile.getContext("2d");
      if (!tctx) return;
      const image = tctx.createImageData(n, n);
      const random = seededRandom(1234567);
      for (let i = 0; i < n * n; i++) {
        // 226..255 の灰。色ではなく「紙の粗さ」なのでトークンは持たない。
        const v = 226 + random() * 29;
        image.data[i * 4] = v;
        image.data[i * 4 + 1] = v;
        image.data[i * 4 + 2] = v;
        image.data[i * 4 + 3] = 255;
      }
      tctx.putImageData(image, 0, 0);
      grain = ctx.createPattern(tile, "repeat");
    };

    /* ── 好みが移ってきた道 (足あとの重心の移動) ── */
    const buildDrift = () => {
      if (!layout) return;
      const view = layout;
      const WINDOW = 9;
      const centroid = (segment: typeof cups): [number, number] => [
        view.sx(segment.reduce((s, c) => s + c.cup.x, 0) / segment.length),
        view.sy(segment.reduce((s, c) => s + c.cup.y, 0) / segment.length),
      ];
      let path: [number, number][] = [];
      for (let i = WINDOW - 1; i < cups.length; i++) {
        path.push(centroid(cups.slice(i - WINDOW + 1, i + 1)));
      }
      // 終端は窓を細めて「いまの場所」まで寄せる (窓のままだと途中で切れて見える)。
      for (const w of [5, 3, 2, 1]) path.push(centroid(cups.slice(cups.length - w)));
      const smooth = (pts: [number, number][]): [number, number][] =>
        pts.map((p, i): [number, number] => {
          if (i === 0 || i === pts.length - 1) return p;
          const a = pts[i - 1];
          const b = pts[i + 1];
          return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
        });
      for (let k = 0; k < 2; k++) path = smooth(path);
      drift = path;
    };

    const relayout = (): boolean => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (width < 2 || height < 2) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      narrow = width < NARROW_PLANE;
      // 狭い枠では軸ラベルの帯を細める。既定の 56px を左右に取ると、390px 幅では
      // 作図面が枠の 3 割まで痩せて散布が団子になる。
      layout = quadrantLayout(width, height, narrow ? { x: 24, y: 32 } : { x: 56, y: 44 });
      scale = Math.min(1.05, Math.max(0.3, layout.planeWidth / REFERENCE_PLANE_WIDTH));
      for (const p of points) {
        p.x = layout.sx(p.tea.x);
        p.y = layout.sy(p.tea.y);
      }
      buildDrift();
      placeCard();
      return true;
    };

    /* ── 当たり判定と札の置き場 ── */
    const hit = (cx: number, cy: number): LensPoint | null => {
      let best: LensPoint | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const p of points) {
        // 消えかけの層は掴まない (クロスフェード中に裏の層を選ばないため)。
        if (p.a < 0.45) continue;
        const d = Math.hypot(cx - p.x, cy - p.y);
        // 指で触る前提なので、芯より一回り広く取る。
        if (d < coreR(p) + 16 && d < bestDistance) {
          bestDistance = d;
          best = p;
        }
      }
      return best;
    };

    /**
     * 札の置き場。**関数宣言ではなく const の関数式**にしてある。
     * 関数宣言は巻き上げの都合で `ctx` の null 除去 (上の early return) を
     * 引き継げず、`ctx` が `null` かもしれない扱いになる。
     */
    const placeCard = (): void => {
      const card = cardRef.current;
      const id = stateRef.current.selectedId;
      if (!card || !id || width < 2) return;
      const p = points.find((q) => q.tea.id === id);
      if (!p) return;
      const w = card.offsetWidth || CARD_WIDTH;
      const h = card.offsetHeight || 200;
      // 逃がし量は「芯の半径 + 22」では足りない。銘柄名は点を中心に左右へ伸びるので、
      // 名前の長い茶だと札の下に自分のラベルが潜り込む。**測る直前に font を戻す**。
      ctx.font = nameFont();
      const gap = Math.max(coreR(p) + 22, ctx.measureText(p.tea.label).width / 2 + 18);
      let x = p.x + gap;
      if (x + w > width - CARD_MARGIN) x = p.x - gap - w;
      x = Math.max(CARD_MARGIN, Math.min(width - w - CARD_MARGIN, x));
      let y = p.y - h / 2;
      y = Math.max(CARD_MARGIN, Math.min(height - h - CARD_MARGIN, y));
      card.style.left = `${Math.round(x)}px`;
      card.style.top = `${Math.round(y)}px`;
    };
    placeCardRef.current = placeCard;

    /* ── 指 ── */
    const onPointerMove = (event: PointerEvent) => {
      // 触る端末にホバーは無い。合成 mousemove で「触った場所が光ったまま」に
      // なるのを避けるため、マウス以外は近さの中心にしない。
      if (event.pointerType !== "mouse" || !layout) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      cursor.on = true;
      cursor.dx = (px - layout.cx) / (layout.planeWidth / 2);
      cursor.dy = (layout.cy - py) / (layout.planeHeight / 2);
      cursor.over = hit(px, py);
      canvas.style.cursor = cursor.over ? "pointer" : "default";
      repaintRef.current?.();
    };
    const onPointerLeave = () => {
      cursor.on = false;
      cursor.over = null;
      repaintRef.current?.();
    };
    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const p = hit(event.clientX - rect.left, event.clientY - rect.top);
      // 余白を触ったら閉じる。触る端末はこれだけが札の開閉になる。
      setSelectedId(p ? p.tea.id : null);
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);

    /* ── 実値を目標へ寄せる。k = 1 で「いますぐ目標」= 落ち着いた 1 枚 ── */
    const advance = (k: number, kg: number) => {
      const s = stateRef.current;
      value.foot += ((s.footprints ? 1 : 0) - value.foot) * k;
      value.mode += ((s.mode === "halo" ? 1 : 0) - value.mode) * k;
      for (const p of points) {
        p.a += ((p.tea.category === s.category ? 1 : 0) - p.a) * k;
        let target = 0;
        if (cursor.on && p.a > 0.05) {
          // 近さは画面のピクセルではなく味の座標で測る。
          const hx = cursor.over ? cursor.over.tea.x : cursor.dx;
          const hy = cursor.over ? cursor.over.tea.y : cursor.dy;
          const d2 = (p.tea.x - hx) ** 2 + (p.tea.y - hy) ** 2;
          target = Math.exp(-d2 / (2 * SIGMA * SIGMA)) * (cursor.over ? 1 : 0.72);
        }
        p.glow += (target - p.glow) * kg;
      }
    };

    /* ── 1 枚描く ── */
    const paint = (seconds: number) => {
      if (!layout) return;
      const view = layout;
      const s = stateRef.current;
      const hovering = cursor.on
        ? Math.min(1, points.reduce((m, p) => Math.max(m, p.glow), 0) / 0.6)
        : 0;

      ctx.fillStyle = ROJI_VIZ_COLOR.kinari;
      ctx.fillRect(0, 0, width, height);
      drawFlavorLensAxes(ctx, view, FLAVOR_AXIS);

      /* 1) 自分の足あと (40 杯を薄く敷く)
         **いま見ているカテゴリーと同じ杯しか敷かない。** 色はカテゴリーを表す
         ので、緑茶の足あとを紅茶の紙の上に薄く残すと 1 枚の図に 2 色が並び、
         「カテゴリーを跨いだ比較」になってしまう。別カテゴリーを見ている間は
         足あとを一切出さず、銘柄カードの「まだ飲んでいない」で言葉で語る。 */
      const footVisible = cups.some((item) => item.category === s.category);
      if (value.foot > 0.004 && drift.length > 1 && footVisible) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.beginPath();
        ctx.moveTo(drift[0][0], drift[0][1]);
        for (let i = 1; i < drift.length - 1; i++) {
          const mx = (drift[i][0] + drift[i + 1][0]) / 2;
          const my = (drift[i][1] + drift[i + 1][1]) / 2;
          ctx.quadraticCurveTo(drift[i][0], drift[i][1], mx, my);
        }
        ctx.lineTo(drift[drift.length - 1][0], drift[drift.length - 1][1]);
        ctx.strokeStyle = rgba(ROJI_VIZ_COLOR.sumi, 0.16 * value.foot);
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        for (const item of cups) {
          if (item.category !== s.category) continue;
          const cup = item.cup;
          const x = view.sx(cup.x);
          const y = view.sy(cup.y);
          // 全期間を出すので、区間内の正規化はそのまま `fresh` でよい。
          const aged = agedLook(cup, cup.fresh, 13 * scale);
          // 残るのは同じカテゴリーの杯だけなので、濃さはレンズの開き具合で決まる。
          const alpha = value.foot;
          const spread = aged.radius * (2.9 - 1.2 * cup.fresh);
          const rgb = hexToRgb(aged.color);
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, spread);
          gradient.addColorStop(0, rgbaOf(rgb, (0.2 + 0.28 * cup.fresh) * alpha));
          gradient.addColorStop(0.55, rgbaOf(rgb, (0.05 + 0.13 * cup.fresh) * alpha));
          gradient.addColorStop(1, rgbaOf(rgb, 0));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(x, y, spread, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, aged.radius * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = rgbaOf(rgb, aged.opacity * 0.72 * alpha);
          ctx.fill();
        }
        ctx.restore();
      }

      /* 2) 近い味のまわりだけ紙が明るくなる。これは下支えで、主役は 3) のにじみ */
      for (const p of points) {
        const gl = p.glow * p.a;
        if (gl < 0.012) continue;
        const r = coreR(p) * 4.6;
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gradient.addColorStop(0, rgba(ROJI_LENS_COLOR.paperGlow, 0.46 * gl));
        gradient.addColorStop(0.55, rgba(ROJI_LENS_COLOR.paperGlow, 0.18 * gl));
        gradient.addColorStop(1, rgba(ROJI_LENS_COLOR.paperGlow, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 3) にじみ。表現レンズで常時 + ホバーで近い味だけ一時的に咲く。
         「円」のときも近い味が色を持つのは、ここが glow で開くから。 */
      if (value.mode > 0.004 || hovering > 0.004) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        for (const p of points) {
          const alpha = p.a * (0.82 * value.mode + 0.62 * p.glow * (1 - 0.3 * value.mode));
          if (alpha < 0.006) continue;
          // ごく浅い呼吸。4% より深いと「息をしている絵」になって主張が出る。
          const breathe = 1 + Math.sin(seconds * 0.5 + p.phase) * 0.04;
          // 円のときのホバー滲みは少し内側に留める (全体が滲むと切替の意味が消える)。
          const r = haloR(p) * breathe * (0.9 + 0.1 * p.a) * (0.76 + 0.24 * value.mode);
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gradient.addColorStop(0, rgbaOf(p.rgb, 0.3 * alpha));
          gradient.addColorStop(0.35, rgbaOf(p.rgb, 0.14 * alpha));
          gradient.addColorStop(0.7, rgbaOf(p.rgb, 0.045 * alpha));
          gradient.addColorStop(1, rgbaOf(p.rgb, 0));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      /* 4) 芯の円と名前 */
      ctx.textAlign = "center";
      for (const p of points) {
        if (p.a < 0.006) continue;
        // ホバー中は遠い味がすっと引く。近い味だけが前に出る。
        const focus = 1 - hovering * 0.4 * (1 - p.glow);
        // 足あとを敷いている間は銘柄の円を 22% 引く。
        const alpha = p.a * focus * (1 - 0.22 * value.foot);
        const r = coreR(p);

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbaOf(p.rgb, alpha * (0.66 + 0.16 * p.glow + 0.2 * value.mode));
        ctx.fill();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = rgba(
          ROJI_VIZ_COLOR.fukamidori,
          alpha * (0.48 + 0.3 * p.glow)
        );
        ctx.stroke();

        const selected = s.selectedId === p.tea.id;
        if (selected) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2);
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = rgba(ROJI_VIZ_COLOR.sumi, 0.42 * p.a);
          ctx.stroke();
        }

        // 狭い枠では名前を並べない。11 銘柄ぶんを 390px 幅に置くと隣同士が
        // 重なってどれも読めなくなる (`flavor-matrix.tsx` と同じ判断)。
        // 名前は触ったときの札で出るので、情報は失われない。
        if (narrow && !selected) continue;

        ctx.font = nameFont();
        ctx.textBaseline = "top";
        ctx.fillStyle = rgba(ROJI_VIZ_COLOR.sumi, alpha * (0.62 + 0.36 * p.glow));
        ctx.fillText(p.tea.label, p.x, p.y + r + 12);
        if (narrow) continue;
        // 一言は近づいたときだけ浮かぶ。
        ctx.font = noteFont();
        ctx.fillStyle = rgba(ROJI_VIZ_COLOR.sumi, alpha * (0.14 + 0.42 * p.glow));
        ctx.fillText(p.tea.note, p.x, p.y + r + 30);
      }

      /* 5) 和紙の目 */
      if (grain) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.055;
        ctx.fillStyle = grain;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    };

    makeGrain();
    relayout();

    if (reduced) {
      /**
       * 動きを止める設定では rAF を回さず、**落ち着いた 1 枚**だけを描く。
       * `advance(1, 1)` は「実値 = 目標」なので、クロスフェードの途中が残らない。
       */
      const settle = () => {
        advance(1, 1);
        paint(0);
      };
      repaintRef.current = settle;
      settle();
    } else {
      const tick = (now: number) => {
        const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
        lastTime = now;
        advance(1 - Math.exp(-dt / TAU), 1 - Math.exp(-dt / TAU_GLOW));
        paint(now / 1000);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    const observer = new ResizeObserver(() => {
      if (relayout()) repaintRef.current?.();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      placeCardRef.current = null;
      repaintRef.current = null;
    };
  }, []);

  /** カテゴリを移ったら札は閉じる (別の層の札が残らない)。 */
  const chooseCategory = (next: TeaCategory) => {
    if (next === category) return;
    setCategory(next);
    setSelectedId(null);
  };

  const selected = selectedId === null ? null : (CATALOG_BY_ID.get(selectedId) ?? null);
  const history = selected === null ? [] : cupsOfTea(selected.id);

  return (
    <div data-slot="flavor-lens" className={cn("flex flex-col gap-4", className)}>
      <div
        ref={hostRef}
        className="relative h-120 w-full overflow-hidden lg:h-160"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
        />

        {/* 銘柄カード。生成りの紙。位置は描画側が `measureText` で決める
            (React からは点の実寸が測れないため)。 */}
        {selected ? (
          <div
            ref={cardRef}
            data-slot="flavor-lens-card"
            className="absolute z-10 w-56 overflow-hidden rounded-sm p-4 shadow-lg"
            style={{
              backgroundColor: ROJI_VIZ_COLOR.kinari,
              backgroundImage: LENS_CARD_PAPER_GRADIENT,
              border: `1px solid ${rgba(ROJI_VIZ_COLOR.sumi, 0.12)}`,
              // 札は生成りの紙の上に置くので、地の明暗によらず墨で書く
              // (テーマの前景色だと暗い設定で紙に文字が消える)。
              color: ROJI_VIZ_COLOR.sumi,
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: LENS_CARD_GRAIN_IMAGE,
                mixBlendMode: "multiply",
                opacity: 0.085,
              }}
            />
            <div className="relative">
              <p className="roji-viz-caption-wide text-sm leading-relaxed">
                {selected.label}
              </p>
              <p className="roji-viz-caption-wide mt-2 text-xs opacity-45">
                {ME_PROCESS_LABEL[selected.process]}　／　{selected.note}
              </p>

              <div
                className="mt-3.5 h-px w-full"
                aria-hidden="true"
                style={{ backgroundColor: rgba(ROJI_VIZ_COLOR.sumi, 0.13) }}
              />

              {/* 香りの方向。目盛りの無い墨線一本と点だけ。数値は出さない。 */}
              <p className="roji-viz-caption-wide mt-3 text-xs opacity-40">香 り の 方 向</p>
              <div className="roji-viz-caption mt-2.5 flex items-center gap-2 text-xs opacity-70">
                <span>{AROMA_AXIS.left}</span>
                <span className="relative h-px flex-1" style={{ backgroundColor: rgba(ROJI_VIZ_COLOR.sumi, 0.24) }}>
                  <span
                    aria-hidden="true"
                    className="absolute top-0 block size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: `${(selected.aroma * 100).toFixed(1)}%`,
                      backgroundColor: rgba(ROJI_VIZ_COLOR.sumi, 0.72),
                    }}
                  />
                </span>
                <span>{AROMA_AXIS.right}</span>
              </div>

              <p className="roji-viz-caption mt-4 text-xs leading-loose opacity-85">
                {selected.poem}
              </p>

              {/* 「これまでに」は足あとレンズが ON のときだけ現れる。
                  自分の履歴を見ている文脈でだけ意味を持つため。 */}
              {footprints ? (
                <div className="mt-4">
                  <p className="roji-viz-caption-wide text-xs opacity-40">こ れ ま で に</p>
                  {history.length > 0 ? (
                    <>
                      <p className="roji-viz-caption mt-2 text-xs opacity-70">
                        {kanjiNumber(history.length)} 度
                      </p>
                      <p className="roji-viz-caption mt-1 text-xs opacity-45">
                        さ い ご の 一 杯 は {history[0].season}
                      </p>
                    </>
                  ) : (
                    // 杯を捏造しない。まだ飲んでいないものは、そう出す。
                    <p className="roji-viz-caption mt-2 text-xs opacity-70">
                      ま だ 飲 ん で い な い
                    </p>
                  )}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="roji-viz-caption-wide mt-4 text-xs opacity-45"
              >
                と じ る
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* レンズの切替。墨の文字だけで、枠もボタン地もアイコンも置かない。
          いま選ばれている値だけが細い墨の下線を持つ。図の中に文字を重ねない
          原則 (産地の地図・土地を読む と同じ) に従って、図の外に出す。
          縦に積むので 390px でも溢れない。 */}
      <div className="flex flex-col gap-2.5">
        <LensRow name="銘 柄">
          {TEA_CATEGORIES.map(({ key, label: text }) => (
            <LensChoice
              key={key}
              active={category === key}
              onClick={() => chooseCategory(key)}
            >
              {text}
            </LensChoice>
          ))}
        </LensRow>
        <LensRow name="足 あ と">
          <LensChoice active={footprints} onClick={() => setFootprints((v) => !v)}>
            重 ね る
          </LensChoice>
        </LensRow>
        <LensRow name="表 現">
          <LensChoice active={mode === "circle"} onClick={() => setMode("circle")}>
            円
          </LensChoice>
          <LensChoice active={mode === "halo"} onClick={() => setMode("halo")}>
            に じ み
          </LensChoice>
        </LensRow>
      </div>

      {/* 凡例は必ず 1 行になる。**色はカテゴリーを表す**ので、1 枚の図に載る点は
          すべて同色 = 説明すべき色は 1 つしかない。以前ここに系統ごとの色を
          並べていたのは「1 枚の図の中でカテゴリーが割れている」と読める誤った
          説明だった。系統は銘柄カードの言葉 (`ME_PROCESS_LABEL`) 側で語る。 */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2" data-slot="flavor-lens-legend">
        {CATALOG_LEGEND[category].map((entry) => (
          <li
            key={entry.process}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full opacity-75"
              style={{ backgroundColor: entry.color }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** レンズ 1 行。左の小さな見出しと、選択肢の並び。 */
function LensRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="roji-viz-caption-wide text-xs text-muted-foreground opacity-60">
        {name}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">{children}</div>
    </div>
  );
}

/** 選択肢 1 つ。現在値だけが細い墨の下線を持つ。 */
function LensChoice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "roji-viz-caption-wide border-b pb-1 text-xs transition-colors duration-500",
        active
          ? "border-brand-graphite text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

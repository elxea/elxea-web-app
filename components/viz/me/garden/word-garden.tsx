"use client";

/**
 * 「ことばの庭」— 触れられる庭 (飛び石 + 文脈レンズ)。
 *
 * 自分が書いた一言を、枠もカードも付けずに **1 件 = 1 行** で版面に置く。
 * 触れると、そのことばだけがふわっと大きくなり、どこで書いたことばかが浮かぶ。
 * 右 (狭い画面では上) の柱を切り替えると、ことばが **散って、積もり直す**。
 *
 * ## なぜ「飛び石」を土台にしたか
 *
 * 1 件 = 1 行なので、**触れて大きくしても版面の意味が壊れない**。段組や Masonry は
 * 1 件が段の中に収まっているため、1 件だけ大きくすると段が崩れて全件が再配置される。
 * 濃淡で時間を表す案は「濃さ」を使い切っていて、触れた / 触れていないの差を出せない。
 *
 * ## 描画を effect の中で直接 DOM に書く理由
 *
 * 位置は **実測してから**でないと決まらない (日本語の字幅は推定すると必ずずれる)。
 * 測って置いて、触れて大きくして、散らして積もらせる —— どれも「測った値を
 * そのまま style に書く」処理で、React の再レンダリングに載せる利点がない。
 * `components/viz/flavor/flavor-matrix.tsx` と同じく **React が持つのは枠と柱だけ**。
 * ことばの `left` / `top` / `width` / `transform` / `opacity` は effect が直に書く。
 * JSX 側の `style` はモジュール定数で識別子が変わらないので、React は再レンダリングで
 * それらを触らない (触ると置いたばかりの位置が消える)。
 *
 * ## 踏むと痛いところ (原版の実測で見つかったもの)
 *
 * 1. **`max-width` を使うと、触れていないのに折り返す**。Chrome は行末の「、」等を
 *    詰められる前提で `max-content` を出すため、`max-content` が実際の 1 行の描画幅より
 *    10px ほど狭くなる。`max-width` を与えると箱がその狭い方に縮む。
 *    → **実測した幅を `width` で明示する** (`ceil(実測) + 2`)。
 * 2. **触れ替えで前のことばを戻し忘れる**。同じ要素の再タップと外タップだけ実装すると
 *    A→B で A に「大きいまま霞む」状態が残る。→ ここでは `paintSelection` が
 *    **毎回全件を塗り直す**ので、構造として起こらない。
 * 3. **柱の幅を決め打ちすると狭い画面で版面を食う**。原版は柱を版面に重ねていたため
 *    実測位置から版面幅を引く必要があった。→ ここでは柱と版面を flex で**分けて**置き、
 *    版面幅 = `host.clientWidth` にした。引き算そのものを無くしてある。
 * 4. **他のことばを一律に霞ませると小さいことばが消えて庭が欠ける**。
 *    → 濃さ ×0.30 に **下限 0.18** を置く。
 * 5. **拡大すると添え字も拡大する**。→ 出典の字は `1 / 拡大率` を掛けて見かけを保つ。
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド `34-garden-interactive` (土台 24-2「庭の飛び石」)。
 */

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import {
  GARDEN_LENSES,
  GARDEN_SIZE_SCALE,
  visibleGardenWords,
  type GardenWord,
} from "@/lib/roji/me/garden-words";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, seededRandom } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

const SVG_NS = "http://www.w3.org/2000/svg";
const WORD_SELECTOR = '[data-slot="word-garden-word"]';
const SOURCE_SELECTOR = '[data-slot="word-garden-source"]';

/** 原版 (全画面) の版面。ここを基準に字と余白を相似で縮める。 */
const REFERENCE_AREA = 1385 * 1000;
/** これより狭い版面は「狭い画面」。柱が横に倒れ、置く件数も減る。 */
const NARROW_WIDTH = 720;
/** 版面に置く件数。枠の中の庭は全画面ほど入らない (data 層の `visibleGardenWords` 参照)。 */
const WIDE_LIMIT = 12;
const NARROW_LIMIT = 8;

/** transform / opacity / filter / width の 4 本ぶん。局面ごとに速さを変える。 */
const IDLE_TRANSITION =
  "transform 560ms cubic-bezier(.22,.61,.36,1), opacity 460ms cubic-bezier(.33,0,.30,1), filter 460ms ease, width 560ms cubic-bezier(.22,.61,.36,1)";
/** 積もる。ゆっくり降りて止まる。 */
const ENTER_TRANSITION =
  "transform 780ms cubic-bezier(.22,.61,.36,1), opacity 640ms cubic-bezier(.33,0,.30,1), filter 460ms ease, width 560ms cubic-bezier(.22,.61,.36,1)";
/** 散る。 */
const LEAVE_TRANSITION =
  "transform 620ms cubic-bezier(.22,.61,.36,1), opacity 520ms cubic-bezier(.33,0,.30,1), filter 460ms ease, width 560ms cubic-bezier(.22,.61,.36,1)";
/**
 * 動きを減らす設定の人には、**位置を動かさず濃さだけ**で見せる。
 * 散る / 積もるは丸ごと飛ばし、触れたときの拡大も即時にする。
 */
const REDUCED_TRANSITION =
  "transform 1ms linear, opacity 240ms linear, filter 240ms linear, width 1ms linear";

/**
 * ことば 1 件の、**effect が二度と書き換えない**プロパティだけ。
 *
 * モジュール定数にして識別子を固定してあるので、React は再レンダリングのたびに
 * この `style` を差分計算せず素通りする = effect が書いた位置が消えない。
 */
const WORD_STYLE: CSSProperties = {
  color: ROJI_VIZ_COLOR.sumi,
  fontFamily: ROJI_VIZ_SERIF,
  fontWeight: 300,
  // 文節の境目 (`<wbr>`) 以外では折らない。budoux の代わりに data 層が境目を持つ。
  wordBreak: "keep-all",
  lineBreak: "strict",
  lineHeight: 1.15,
  transformOrigin: "50% 50%",
  willChange: "transform, opacity",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
  // キーボードで来たときだけ出る細い罫 (枠を出さずに現在地を示す)。
  textDecorationColor: ROJI_VIZ_COLOR.koke,
};

/** 出典の 1 行。ことばと同じ位置に絶対配置するので、出ても版面が動かない。 */
const SOURCE_STYLE: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: "50%",
  transform: "translateX(-50%)",
  marginTop: "0.55em",
  whiteSpace: "nowrap",
  letterSpacing: "0.22em",
  color: ROJI_VIZ_COLOR.fukamidori,
  opacity: 0,
  pointerEvents: "none",
  transition: "opacity 420ms ease",
};

/** 柱の墨文字。 */
const LENS_LABEL_STYLE: CSSProperties = {
  color: ROJI_VIZ_COLOR.sumi,
  fontFamily: ROJI_VIZ_SERIF,
  fontWeight: 300,
};

/** 選んでいる柱に添える細い墨の罫。 */
const LENS_RULE_STYLE: CSSProperties = { backgroundColor: ROJI_VIZ_COLOR.sumi };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 段が上がるほど濃くする。地の状態の濃さ。 */
function baseOpacity(step: number): number {
  return 0.62 + 0.38 * (step / 6);
}

// ---- 飛び石の配置 --------------------------------------------------------
// ここは「表現の純ロジック」なので本来は `lib/viz/` の住人だが、いまの利用者は
// この 1 枚だけ。2 枚目が要るようになった時点で `lib/viz/stepping-stones.ts` に
// 出す (先に出すと、使われ方が 1 通りしか無いまま API が固まる)。

interface StoneBox {
  w: number;
  h: number;
  step: number;
}

interface StonePoint {
  x: number;
  y: number;
}

/**
 * 版面を横切る、ゆるい S 字。
 *
 * 露地の飛び石は一直線でも散乱でもなく「歩ける曲線」に沿って置かれる。
 * この背骨が「乱れすぎ」を防ぐ。1.5 周期の正弦 —— 1 周期だと単調、
 * 2 周期以上だとジグザグして道に見えない。
 */
function spine(t: number, w: number, h: number): StonePoint {
  return {
    x: (0.1 + 0.8 * t) * w,
    y: (0.53 + 0.17 * Math.sin(0.35 + t * Math.PI * 1.5)) * h,
  };
}

interface PlaceOptions {
  w: number;
  h: number;
  margin: number;
  pad: number;
  padByStep: number;
  jitter: number;
  seed: number;
  tries: number;
  /** 中心の高さを必ずこれだけずらす。庭が一覧表に戻るのを防ぐ最重要パラメータ。 */
  staggerY: number;
  /** 大きい字どうしが近所に固まらないようにする最小距離。 */
  bigSpread: number;
}

/**
 * 重なりゼロで置く。
 *
 * 大きいものから先に場所を取り、小さいものが隙間に入る (小さいものを先に置くと、
 * 大きいものの居場所が無くなって端に押し出される)。置けなかった箱は `null`。
 */
function placeAlongSpine(
  boxes: readonly StoneBox[],
  opt: PlaceOptions
): (StonePoint | null)[] {
  const random = seededRandom(opt.seed);
  const order = boxes
    .map((_, index) => index)
    .sort((a, b) => boxes[b].w * boxes[b].h - boxes[a].w * boxes[a].h);
  const out: (StonePoint | null)[] = boxes.map(() => null);
  const placed: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    cx: number;
    cy: number;
    step: number;
  }[] = [];

  // 黄金比の低食い違い列。t を等間隔にすると等間隔に並んで「整いすぎる」。
  const golden = 0.618_033_988_7;

  for (let k = 0; k < order.length; k++) {
    const index = order[k];
    const box = boxes[index];

    for (let n = 0; n < opt.tries; n++) {
      // 詰まってきたら徐々に条件を緩める。**4 で頭を止める**のが要点で、
      // 止めないと狭い版面 (tries が多い) で係数が負に振れ、すき間が
      // マイナス = 重なってよい条件になって庭が潰れる。
      // 4 のとき すき間は 0.12 倍まで残り、高さのずらしと「大きい石どうしの
      // 最小距離」だけがちょうど 0 になって外れる。
      const relax = Math.min(4, Math.floor(n / 90));
      const t = (k * golden + n * 0.0173 + random() * 0.06) % 1;
      const point = spine(t, opt.w, opt.h);
      // 大きい字は背骨の近くに留め、小さい字ほど遠くへ飛ばす。
      const away =
        (1 - box.step / 6) * opt.jitter * (0.25 + random()) * (random() < 0.5 ? -1 : 1);
      const cx = point.x + (random() - 0.5) * 0.05 * opt.w;
      const cy = point.y + away * opt.h;

      const pad = (opt.pad + box.step * opt.padByStep) * (1 - relax * 0.22);
      const rect = {
        x0: cx - box.w / 2 - pad,
        x1: cx + box.w / 2 + pad,
        y0: cy - box.h / 2 - pad,
        y1: cy + box.h / 2 + pad,
        cx,
        cy,
        step: box.step,
      };
      if (
        rect.x0 < opt.margin ||
        rect.x1 > opt.w - opt.margin ||
        rect.y0 < opt.margin ||
        rect.y1 > opt.h - opt.margin
      ) {
        continue;
      }
      if (
        placed.some(
          (q) =>
            !(rect.x1 <= q.x0 || rect.x0 >= q.x1 || rect.y1 <= q.y0 || rect.y0 >= q.y1)
        )
      ) {
        continue;
      }

      const stagger = opt.staggerY * (1 - relax * 0.25);
      if (stagger > 0 && placed.some((q) => Math.abs(cy - q.cy) < stagger)) continue;

      if (opt.bigSpread > 0 && box.step >= 5) {
        const spread = opt.bigSpread * (1 - relax * 0.25);
        if (
          placed.some(
            (q) => q.step >= 5 && Math.hypot(cx - q.cx, cy - q.cy) < spread
          )
        ) {
          continue;
        }
      }

      placed.push(rect);
      out[index] = { x: cx, y: cy };
      break;
    }
  }
  return out;
}

// ---- 本体 ----------------------------------------------------------------

/** 置き終わった 1 件の実測値。触れたときの計算はここだけを見る。 */
interface WordGeometry {
  step: number;
  /** 実際に当てた字の大きさ (px)。 */
  fontSize: number;
  /** 実測した 1 行の幅 (px)。地の状態はこの幅で 1 行に保つ。 */
  natural: number;
  x: number;
  y: number;
}

export interface WordGardenProps {
  /** スクリーンリーダー向けの説明。 */
  label: string;
  className?: string;
}

export function WordGarden({ label, className }: WordGardenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef(new Map<string, HTMLButtonElement>());
  const geometryRef = useRef(new Map<string, WordGeometry>());
  const selectedRef = useRef<string | null>(null);
  const planeRef = useRef({ avail: 0, activeMin: 0 });
  /**
   * 直前に触れた入力の種類。
   *
   * マウスは hover が状態を決めるので、同じことばの click まで拾うと
   * **触れた直後に自分で戻してしまう**。指とペンのときだけ click を効かせる
   * (指には hover が無いので、click が唯一の「触れる」になる)。
   */
  const pointerKindRef = useRef<string>("mouse");
  const busyRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 表示中の庭 (ことば)。 */
  const [lensIndex, setLensIndex] = useState(0);
  /**
   * 柱と見出しが指している庭。**散り始めと同時に**切り替える。
   * 積もり終わってから変えると「何の庭を見ているのか」が 2 秒間わからない。
   */
  const [markedIndex, setMarkedIndex] = useState(0);

  const lens = GARDEN_LENSES[lensIndex];

  /** 触れている 1 件を決めて、**全件を塗り直す** (踏みどころ 2 の構造的な対処)。 */
  const paintSelection = useCallback((next: string | null) => {
    selectedRef.current = next;
    const { avail, activeMin } = planeRef.current;

    nodesRef.current.forEach((node, id) => {
      const geometry = geometryRef.current.get(id);
      if (!geometry) return;
      const source = node.querySelector<HTMLElement>(SOURCE_SELECTOR);
      const base = baseOpacity(geometry.step);

      if (next !== null && id === next) {
        // 「少し大きくなる」。狭い画面では、読める大きさまでは上げる
        // (地の字が 11px まで落ちるので 1.16 倍では読めるようにならない)。
        const scale =
          activeMin > 0
            ? clamp(activeMin / geometry.fontSize, 1.16, 2)
            : 1.16;
        // 大きくして版面からはみ出すぶんは、文節の境目で折る。
        const width = Math.min(geometry.natural, Math.floor(avail / scale));
        node.style.width = `${Math.max(48, width)}px`;
        node.style.transform = `translate(-50%,-50%) scale(${scale})`;
        node.style.opacity = "1";
        node.style.filter = "none";
        node.style.zIndex = "5";
        if (source) {
          // 添え字は一緒に拡大させない (逆数を掛けて見かけの大きさを保つ)。
          source.style.fontSize = `${(10.5 / scale).toFixed(2)}px`;
          source.style.opacity = "0.78";
        }
        return;
      }

      node.style.transform = "translate(-50%,-50%) scale(1)";
      node.style.width = `${geometry.natural}px`;
      node.style.zIndex = "0";
      if (source) source.style.opacity = "0";
      if (next === null) {
        node.style.opacity = base.toFixed(3);
        node.style.filter = "none";
      } else {
        // 消さずに霞ませる。一律に掛けると小さいことばが消えて庭が欠けるので下限を置く。
        node.style.opacity = Math.max(0.18, base * 0.3).toFixed(3);
        node.style.filter = "blur(0.5px)";
      }
    });
  }, []);

  /** 切替の最中は触れない (二重発火の防止)。 */
  const select = useCallback(
    (next: string | null) => {
      if (busyRef.current) return;
      paintSelection(next);
    },
    [paintSelection]
  );

  /** 砂紋。背骨に沿った線を 3 本、ほとんど見えない濃さで。 */
  const paintRipple = useCallback((width: number, height: number, k: number) => {
    const svg = rippleRef.current;
    if (!svg) return;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const offset of [-1, 0, 1]) {
      const points: string[] = [];
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const point = spine(t, width, height);
        points.push(`${point.x.toFixed(1)},${(point.y + offset * 116 * k).toFixed(1)}`);
      }
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", points.join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", ROJI_VIZ_COLOR.sumi);
      line.setAttribute("stroke-width", offset === 0 ? "0.9" : "0.6");
      line.setAttribute("stroke-opacity", offset === 0 ? "0.055" : "0.035");
      svg.appendChild(line);
    }
  }, []);

  /**
   * 版面を組み直す。測る → 置く → (積もる)。
   *
   * `animate` が false のときは動かさずその場に出す (画面幅が変わっただけのとき)。
   */
  const runLayout = useCallback(
    (animate: boolean) => {
      const host = hostRef.current;
      if (!host) return;
      const planeWidth = host.clientWidth;
      const planeHeight = host.clientHeight;
      if (planeWidth < 2 || planeHeight < 2) return;

      const reduced = prefersReducedMotion();
      const narrow = planeWidth < NARROW_WIDTH;
      const shown = visibleGardenWords(lens, narrow ? NARROW_LIMIT : WIDE_LIMIT);

      // 字の縮尺。版面の広さ (面積) に相似で従わせる。幅だけで決めると、
      // 背の低い枠に大きい字が入って置き場所が足りなくなる。
      const k = clamp(Math.sqrt((planeWidth * planeHeight) / REFERENCE_AREA), 0.46, 1);
      // これ以下には落とさない (読めなくなる)。
      const floor = narrow ? 11 : 12;
      const margin = Math.round(40 * Math.max(0.42, k));
      // 狭い画面では触れたときに「読める大きさ」まで上げる。広い画面は既に読める。
      planeRef.current = { avail: planeWidth - 2 * margin, activeMin: narrow ? 18 : 0 };
      selectedRef.current = null;
      geometryRef.current.clear();
      paintRipple(planeWidth, planeHeight, k);

      // 1) 実測。日本語の字幅は推定するとずれるので、DOM に置いてから測る。
      nodesRef.current.forEach((node) => {
        node.hidden = true;
      });
      type Measured = {
        word: GardenWord;
        node: HTMLButtonElement;
        box: StoneBox;
        fontSize: number;
      };
      const measureAll = (scale: number): Measured[] => {
        const out: Measured[] = [];
        for (const word of shown) {
          const node = nodesRef.current.get(word.id);
          if (!node) continue;
          const fontSize = Math.max(
            floor,
            Math.round(GARDEN_SIZE_SCALE[word.step] * scale)
          );
          node.hidden = false;
          node.style.transition = "none";
          node.style.transitionDelay = "0ms";
          node.style.visibility = "hidden";
          node.style.transform = "translate(-50%,-50%)";
          node.style.fontSize = `${fontSize}px`;
          // 大きい字ほど字間を締める (同じ値を全段に当てると大きい字だけばらける)。
          node.style.letterSpacing = `${(0.16 - word.step * 0.014).toFixed(3)}em`;
          node.style.whiteSpace = "nowrap";
          node.style.width = "auto";
          node.style.left = "0px";
          node.style.top = "0px";
          const rect = node.getBoundingClientRect();
          out.push({
            word,
            node,
            box: { w: rect.width, h: rect.height, step: word.step },
            fontSize,
          });
        }
        return out;
      };

      let measured = measureAll(k);
      // 面積から出した縮尺は「置ける総量」しか見ていないので、**細長い版面では
      // いちばん長い一行が版面幅に入らない**ことがある (実機で言うと 320px 幅)。
      // 入らない石は置き場所が見つからず黙って消え、いちばん大きい —— つまり
      // いちばん読ませたい —— ことばから欠ける。測ってから一度だけ縮め直す。
      const widest = Math.max(0, ...measured.map((entry) => entry.box.w));
      const avail = planeRef.current.avail;
      if (widest > avail && widest > 0) {
        measured = measureAll(Math.max(0.28, k * (avail / widest)));
      }

      // 2) 背骨に沿って、重ならない場所を探す。
      //    置けない石が出たらすき間を詰めて置き直す。
      const boxes = measured.map((entry) => entry.box);
      let positions: (StonePoint | null)[] = [];
      let pad = Math.round(28 * k) + 2;
      for (let attempt = 0; attempt < 10; attempt++) {
        positions = placeAlongSpine(boxes, {
          w: planeWidth,
          h: planeHeight,
          margin,
          pad,
          padByStep: 2.6 * k,
          jitter: 0.34,
          seed: lens.seed,
          // 版面が狭いほど候補を多く引く。
          tries: narrow ? 900 : 460,
          staggerY: Math.round(26 * k) + 6,
          // 大きい石どうしは離す。ただし版面の幅に対する比でも頭を押さえる
          // (固定値のままだと狭い版面で「離せる場所が存在しない」条件になる)。
          bigSpread: Math.round(Math.min(400 * k, planeWidth * 0.5)),
        });
        if (positions.every(Boolean)) break;
        pad = Math.max(4, pad - 4);
      }

      // 3) 置く。折り返しは常に有効にしておき、地の状態では **実測した自分の幅** を
      //    明示して 1 行に保つ (踏みどころ 1)。
      const placed: { node: HTMLButtonElement; step: number; y: number }[] = [];
      measured.forEach((entry, index) => {
        const point = positions[index];
        if (!point) {
          // 置けなかった石は出さない。無理に置くと重なって版面が濁る。
          entry.node.hidden = true;
          return;
        }
        const natural = Math.ceil(entry.box.w) + 2;
        entry.node.style.left = `${Math.round(point.x)}px`;
        entry.node.style.top = `${Math.round(point.y)}px`;
        entry.node.style.width = `${natural}px`;
        entry.node.style.whiteSpace = "normal";
        entry.node.style.zIndex = "0";
        entry.node.style.filter = "none";

        const source = entry.node.querySelector<HTMLElement>(SOURCE_SELECTOR);
        if (source) {
          source.style.opacity = "0";
          source.style.fontSize = "10.5px";
          // 端に置かれた石の出典は、外へ伸ばすと枠に切られる。石の側へ寄せる。
          const ratio = point.x / planeWidth;
          if (ratio < 0.3) {
            source.style.left = "0px";
            source.style.right = "auto";
            source.style.transform = "none";
          } else if (ratio > 0.7) {
            source.style.left = "auto";
            source.style.right = "0px";
            source.style.transform = "none";
          } else {
            source.style.left = "50%";
            source.style.right = "auto";
            source.style.transform = "translateX(-50%)";
          }
        }

        geometryRef.current.set(entry.word.id, {
          step: entry.word.step,
          fontSize: entry.fontSize,
          natural,
          x: point.x,
          y: point.y,
        });
        placed.push({ node: entry.node, step: entry.word.step, y: point.y });
      });

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      const idle = reduced ? REDUCED_TRANSITION : IDLE_TRANSITION;

      // 4) 出す。動きを減らす設定のときと、幅が変わっただけのときは動かさない。
      if (!animate || reduced) {
        for (const item of placed) {
          item.node.style.transform = "translate(-50%,-50%) scale(1)";
          item.node.style.opacity = baseOpacity(item.step).toFixed(3);
          item.node.style.visibility = "visible";
        }
        // 開始値を確定させてから遷移を戻す (戻す前に書くと、置いた瞬間が遷移になる)。
        void host.offsetWidth;
        for (const item of placed) item.node.style.transition = idle;
        busyRef.current = false;
        return;
      }

      // 5) 積もる。上のことばから順に、少し上・少し小さいところから降りてくる。
      const random = seededRandom(lens.seed + 977);
      const delays = new Map<HTMLButtonElement, number>();
      [...placed]
        .sort((a, b) => a.y - b.y)
        .forEach((item, n) => delays.set(item.node, Math.round(n * 26 + random() * 40)));

      for (const item of placed) {
        item.node.style.transform = "translate(-50%,-50%) translateY(-22px) scale(.94)";
        item.node.style.opacity = "0";
        item.node.style.visibility = "visible";
      }
      void host.offsetWidth;
      for (const item of placed) {
        item.node.style.transition = ENTER_TRANSITION;
        item.node.style.transitionDelay = `${delays.get(item.node) ?? 0}ms`;
        item.node.style.transform = "translate(-50%,-50%) scale(1)";
        item.node.style.opacity = baseOpacity(item.step).toFixed(3);
      }
      const total = Math.max(0, ...delays.values()) + 820;
      settleTimerRef.current = setTimeout(() => {
        for (const item of placed) {
          item.node.style.transition = idle;
          item.node.style.transitionDelay = "0ms";
        }
        busyRef.current = false;
      }, total);
    },
    [lens, paintRipple]
  );

  useEffect(() => {
    runLayout(true);

    const host = hostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => runLayout(false), 200);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [runLayout]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    };
  }, []);

  /**
   * 散る。庭の中心から外へ、ほんの少しだけ動かして、ごく浅く回す。
   * 大きく飛ばすと「吹き飛ばした」に、回転が無いと「消えた」に見える。
   * 返り値は散り終わるまでの ms。
   */
  const scatter = useCallback((): number => {
    const host = hostRef.current;
    if (!host) return 0;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const k = clamp(Math.sqrt((width * height) / REFERENCE_AREA), 0.46, 1);
    const items: { node: HTMLButtonElement; geometry: WordGeometry }[] = [];
    geometryRef.current.forEach((geometry, id) => {
      const node = nodesRef.current.get(id);
      if (node) items.push({ node, geometry });
    });
    if (items.length === 0) return 0;

    const random = seededRandom(4321);
    const delays = new Map<HTMLButtonElement, number>();
    // 下のことばから順に持ち上がる。
    [...items]
      .sort((a, b) => b.geometry.y - a.geometry.y)
      .forEach((item, n) => delays.set(item.node, Math.round(n * 18 + random() * 30)));

    const cx = width / 2;
    const cy = height / 2;
    for (const { node, geometry } of items) {
      const vx = geometry.x - cx;
      const vy = geometry.y - cy;
      const length = Math.hypot(vx, vy) || 1;
      const distance = (44 + random() * 46) * k;
      const rotation = (random() * 2.4 - 1.2).toFixed(2);
      node.style.transition = LEAVE_TRANSITION;
      node.style.transitionDelay = `${delays.get(node) ?? 0}ms`;
      node.style.transform =
        `translate(-50%,-50%) translate(${((vx / length) * distance).toFixed(1)}px, ${(
          (vy / length) * distance -
          10 * k
        ).toFixed(1)}px) rotate(${rotation}deg) scale(1.02)`;
      node.style.opacity = "0";
    }
    return Math.max(0, ...delays.values()) + 660;
  }, []);

  const switchTo = (index: number) => {
    if (busyRef.current || index === lensIndex) return;
    busyRef.current = true;
    setMarkedIndex(index);
    paintSelection(null);

    if (prefersReducedMotion()) {
      // 散る / 積もるは丸ごと飛ばして、その場に置き直す。
      setLensIndex(index);
      return;
    }
    const wait = scatter();
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => setLensIndex(index), wait);
  };

  return (
    <div data-slot="word-garden" className={cn("flex flex-col gap-3", className)}>
      <p className="roji-viz-caption-wide text-xs text-muted-foreground">
        {GARDEN_LENSES[markedIndex].caption}
      </p>

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-6">
        {/*
          柱。24-4 の縦書きを切替 UI の側で採る。枠・下線・色分けは使わず、
          区別は「墨の濃さ」と、選んでいる柱に添えた細い罫 1 本だけ。
          狭い画面では版面を食うので横に倒す (原版は柱の実測位置から版面幅を
          引いていたが、ここは flex で分けてあるので引き算そのものが要らない)。
        */}
        <nav
          aria-label={label}
          className="flex shrink-0 flex-row flex-wrap items-start gap-x-7 gap-y-2 md:order-2 md:flex-col md:items-start md:justify-center md:gap-y-6"
        >
          {GARDEN_LENSES.map((item, index) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={index === markedIndex}
              onClick={() => switchTo(index)}
              style={LENS_LABEL_STYLE}
              className={cn(
                "roji-viz-caption relative cursor-pointer border-0 bg-transparent p-0 text-xs transition-opacity duration-500",
                "md:[writing-mode:vertical-rl]",
                index === markedIndex ? "opacity-95" : "opacity-30 hover:opacity-60"
              )}
            >
              {item.label}
              {/* 狭い画面: 文字の下に引く細い罫 */}
              <span
                aria-hidden="true"
                style={LENS_RULE_STYLE}
                className={cn(
                  "pointer-events-none absolute inset-x-0 -bottom-1 block h-px transition-opacity duration-500 md:hidden",
                  index === markedIndex ? "opacity-70" : "opacity-0"
                )}
              />
              {/* 広い画面: 柱の脇に立てる細い罫 (掛軸の軸のつもり) */}
              <span
                aria-hidden="true"
                style={LENS_RULE_STYLE}
                className={cn(
                  "pointer-events-none absolute inset-y-0 -left-2 hidden w-px transition-opacity duration-500 md:block",
                  index === markedIndex ? "opacity-70" : "opacity-0"
                )}
              />
            </button>
          ))}
        </nav>

        {/* 版面。ここが「ことばを置ける幅」そのもの。 */}
        <div
          ref={hostRef}
          data-slot="word-garden-plate"
          role="group"
          aria-label={label}
          className="relative h-140 w-full grow overflow-hidden select-none md:h-160 lg:h-180"
          style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
          onPointerDown={(event) => {
            // 版面のどこか (ことば以外) に触れたら戻る。
            if (!(event.target as HTMLElement).closest(WORD_SELECTOR)) select(null);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") select(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") select(null);
          }}
        >
          <svg
            ref={rippleRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 block h-full w-full"
          />

          {lens.words.map((word) => (
            <button
              key={word.id}
              type="button"
              tabIndex={0}
              hidden
              ref={(node) => {
                if (node) nodesRef.current.set(word.id, node);
                else nodesRef.current.delete(word.id);
              }}
              data-slot="word-garden-word"
              aria-label={`${word.text}（${word.source}）`}
              onPointerDown={(event) => {
                pointerKindRef.current = event.pointerType;
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") select(word.id);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") select(null);
              }}
              onFocus={() => select(word.id)}
              onBlur={() => select(null)}
              onClick={() => {
                // マウスは hover が決める。指・ペンだけ、もう一度触れたら戻る。
                if (pointerKindRef.current === "mouse") return;
                select(selectedRef.current === word.id ? null : word.id);
              }}
              style={WORD_STYLE}
              className="absolute m-0 cursor-pointer border-0 bg-transparent p-0 text-center focus-visible:underline focus-visible:decoration-1 focus-visible:underline-offset-4 focus-visible:outline-none"
            >
              {word.phrases.map((phrase, i) => (
                <Fragment key={phrase + String(i)}>
                  {i > 0 ? <wbr /> : null}
                  {phrase}
                </Fragment>
              ))}
              <span data-slot="word-garden-source" style={SOURCE_STYLE}>
                {word.source}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

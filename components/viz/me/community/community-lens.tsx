"use client";

/**
 * 「みんなの気配」— みんな ⇄ 自分 のレンズ。
 *
 * 生成りの紙の上に、匿名集計のあたたかさ (気配) を一枚の面として敷き、その同じ面に
 * 自分の四十杯を置く。レンズ (0 = みんな / 1 = 自分) を動かすと、面が薄まりながら
 * 自分の杯が立ち上がってくる。**二状態の切替ではなく一本の実数**で、途中の位置が
 * いちばん読める — 「同じ物差しの上を倍率が動いている」がこの図の主張だから。
 *
 * データ層 (`lib/roji/me/community-field.ts`) が地図をやめた経緯・匿名集計の
 * 約束・差し替え契約を持つ。ここは描き方だけを持つ。
 *
 * ## 画面に出る色は 1 色だけ (カテゴリーの色)
 *
 * roji の確定ルールで **色はカテゴリー (緑茶 / 紅茶 / 青茶) を表し、1 枚の図に
 * 並べてよいのは同じカテゴリーだけ**。この図は緑茶に閉じているので、面も粒も杯も
 * `COMMUNITY_COLOR` (苔) の濃淡しか使わない。**濃さ = 量、色 = カテゴリー**で、
 * 系統 (蒸し / 釜炒り / 焙煎) で色を割る凡例はここに存在しない。凡例は
 * 「カテゴリー名 + その 1 色」の一行だけ置く。
 *
 * ## 踏むと痛い点 (原型が実測で踏んだものを含む)
 *
 * 1. **密度場を毎フレーム計算してはいけない**。1 画素ごとにガウスの重ね合わせを
 *    解くと枠の大きさに比例して落ちる。面は **枠の寸法が変わったときだけ**
 *    オフスクリーンの `ImageData` へ焼き、毎フレームは `drawImage` の
 *    `globalAlpha` を動かすだけにする。
 * 2. **`getImageData` を表に出ている canvas へ呼ばない**。呼んだ時点でその canvas は
 *    ソフトウェア経路へ落ちる (原型の計測で 120fps → 20fps)。よって画素を組むのは
 *    オフスクリーン側の `createImageData` だけで、表の canvas からは一度も読まない。
 * 3. **灯り → 粒 → 杯 の順に描く**。光を後から載せると粒が洗い流されて気配が濁る
 *    (原型 32 の実測)。
 * 4. **カードを図の上に浮かべない**。原型は下から出るカードが操作列を覆って
 *    「開いたら何も押せない」になった。ここは読みも操作も**図の外**に置き、
 *    重なりの事故そのものを無くしている。
 * 5. **粒を毎フレーム間引く**。レンズが自分側へ動くと粒は減るが、配列を作り直すと
 *    絵が飛ぶ。位置は固定のまま **先頭から何粒描くか**だけを動かす。
 *
 * ## 操作
 *
 * レンズは `role="slider"` を持つ 1 つの操作子で、ドラッグと矢印キー・Home / End の
 * 両方で動く。`aria-valuetext` は**言葉だけ**を返す (`lensVoice`) — 目盛りや百分率を
 * 読み上げた瞬間、この図は「数を隠したダッシュボード」になる。
 *
 * 産地に触れると出る読みは図の下の一行に出し、`aria-live="polite"` で読み上げる。
 * 図の意味はこの読みが無くても成立する (触れられない環境でも欠落にならない)。
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド 32 (32-community-interactive)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  COMMUNITY_CATEGORY_LABEL,
  COMMUNITY_COLOR,
  COMMUNITY_CUPS,
  COMMUNITY_HINT,
  COMMUNITY_PLACES,
  CROWD_SUMMARY,
  LENS_CONTROL_LABEL,
  LENS_ENDS,
  PLACE_FOOTPRINT,
  PLANE_HEIGHT,
  SELF_SUMMARY,
  crowdGrainStyle,
  crowdWarmth,
  cupAppearance,
  fitPlane,
  labelHaloStyle,
  labelInkStyle,
  lensVoice,
  nearestPlace,
  placeReading,
  planeToScreenX,
  planeToScreenY,
  rgbaOf,
  screenToPlaneU,
  screenToPlaneV,
  selfGlowStyle,
  warmthPixel,
  type PlaneFit,
} from "@/lib/roji/me/community-field";
import { NARROW_PLANE } from "@/lib/viz/quadrant";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, clamp01, seededRandom } from "@/lib/viz/roji-viz-palette";
import { cn } from "@/lib/utils";

/** 気配の粒の総数。みんな側で撒く上限で、自分側へ動くと先頭から間引かれる。 */
const GRAIN_COUNT = 820;
/** 面を焼くオフスクリーンの横解像度。細かくすると靄ではなく砂目になる。 */
const FIELD_COLUMNS_MIN = 90;
const FIELD_COLUMNS_MAX = 240;
/** 矢印キー 1 打の移動量。端から端まで十数打で渡れる粗さ。 */
const KEY_STEP = 0.06;
const KEY_STEP_LARGE = 0.25;

const TAU = Math.PI * 2;

interface Grain {
  u: number;
  v: number;
  r: number;
  a: number;
  phase: number;
  speed: number;
}

interface PlacedCup {
  x: number;
  y: number;
  cup: (typeof COMMUNITY_CUPS)[number]["cup"];
}

interface PlacedPlace {
  id: string;
  name: string;
  warmth: number;
  x: number;
  y: number;
  /** 自分の足あとの深さ (0..1)。足あとが無ければ null。 */
  depth: number | null;
  /** 名札の逃がし方 (データ層が持つ。近接する産地の重なりを解く)。 */
  labelSide: "l" | "r";
  labelDy: number;
}

interface Scene {
  width: number;
  height: number;
  dpr: number;
  fit: PlaneFit;
  field: HTMLCanvasElement | null;
  grains: Grain[];
  cups: PlacedCup[];
  places: PlacedPlace[];
  narrow: boolean;
  cupBase: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 気配の面をオフスクリーンへ焼く。
 *
 * 表の canvas からは一度も読まない (`getImageData` を呼ぶとソフトウェア経路へ
 * 落ちるため)。ここで作った 1 枚を毎フレーム `drawImage` するだけにする。
 */
function bakeField(width: number, height: number, fit: PlaneFit): HTMLCanvasElement | null {
  const columns = Math.max(
    FIELD_COLUMNS_MIN,
    Math.min(FIELD_COLUMNS_MAX, Math.round(width / 4))
  );
  const rows = Math.max(2, Math.round((columns * height) / width));
  const off = document.createElement("canvas");
  off.width = columns;
  off.height = rows;
  const octx = off.getContext("2d");
  if (!octx) return null;

  const image = octx.createImageData(columns, rows);
  for (let j = 0; j < rows; j++) {
    const y = ((j + 0.5) * height) / rows;
    const v = screenToPlaneV(fit, y);
    for (let i = 0; i < columns; i++) {
      const x = ((i + 0.5) * width) / columns;
      const [r, g, b, a] = warmthPixel(crowdWarmth(screenToPlaneU(fit, x), v));
      const p = (j * columns + i) * 4;
      image.data[p] = r;
      image.data[p + 1] = g;
      image.data[p + 2] = b;
      image.data[p + 3] = a;
    }
  }
  octx.putImageData(image, 0, 0);
  return off;
}

/** 粒は密度に比例して撒く。粒そのものが「みんなの気配」の実体になる。 */
function sowGrains(): Grain[] {
  const random = seededRandom(20260816);
  const grains: Grain[] = [];
  let guard = 0;
  while (grains.length < GRAIN_COUNT && guard < GRAIN_COUNT * 60) {
    guard++;
    const u = -0.14 + random() * 1.28;
    const v = -0.14 + random() * (PLANE_HEIGHT + 0.28);
    const warmth = crowdWarmth(u, v);
    // 二乗で薄いところを間引く。線形だと面の外まで一様に散って靄が締まらない。
    if (random() > warmth * warmth) continue;
    grains.push({
      u,
      v,
      r: 0.5 + random() * 0.9,
      a: 0.16 + random() * 0.26,
      phase: random() * TAU,
      speed: 0.4 + random() * 0.8,
    });
  }
  return grains;
}

export interface CommunityLensProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  className?: string;
}

export function CommunityLens({ label, className }: CommunityLensProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /** 0 = みんな / 1 = 自分。両端は同じ絵の二つの倍率で、別々の図ではない。 */
  const [lens, setLens] = useState(0);
  const [readingId, setReadingId] = useState<string | null>(null);
  /** 枠が大きく変わったときだけ焼き直す (面は寸法に紐づくため)。 */
  const [rebuildKey, setRebuildKey] = useState(0);

  /**
   * 描画ループから読む写し。
   *
   * ループは焼き直しのたびに 1 本だけ張る。レンズが動くたびに張り直すと
   * 粒の呼吸が途切れるので、ループは state ではなくこの ref を読む。
   */
  const lensRef = useRef(0);
  const readingRef = useRef<string | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const drawRef = useRef<((time: number) => void) | null>(null);

  /* ── 面を焼いて描画ループを張る ── */
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const fit = fitPlane(width, height);
    const sizeScale = Math.max(0.62, Math.min(1.15, width / 1100));

    const places: PlacedPlace[] = COMMUNITY_PLACES.map((place) => ({
      id: place.id,
      name: place.name,
      warmth: place.warmth,
      x: planeToScreenX(fit, place.u),
      y: planeToScreenY(fit, place.v),
      depth: PLACE_FOOTPRINT.get(place.id)?.depth ?? null,
      labelSide: place.labelSide,
      labelDy: place.labelDy,
    }));

    const scene: Scene = {
      width,
      height,
      dpr,
      fit,
      field: bakeField(width, height, fit),
      grains: sowGrains(),
      cups: COMMUNITY_CUPS.map((entry) => ({
        cup: entry.cup,
        x: planeToScreenX(fit, entry.u),
        y: planeToScreenY(fit, entry.v),
      })),
      places,
      narrow: width < NARROW_PLANE,
      /**
       * 杯の大きさは **枠幅ではなく面の倍率**に合わせる。
       *
       * 群れの広がり (`CUP_SPREAD`) は面の単位なので面と一緒に縮むが、杯の直径を
       * 枠幅で決めると狭い枠で杯だけが相対的に太り、いちばん通った産地の
       * 十七杯が一つの塊に潰れる (実測: 390px 幅で群れの半径 10px に対し
       * 杯の半径が 4.7px になった)。
       */
      cupBase: 13 * Math.max(0.42, Math.min(1.15, fit.scale / 1100)),
    };
    sceneRef.current = scene;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const labelSize = scene.narrow ? 10.5 : 12.5;
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };

    const draw = (time: number) => {
      const t = clamp01(lensRef.current);
      const reading = readingRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = ROJI_VIZ_COLOR.kinari;
      ctx.fillRect(0, 0, width, height);

      /* 気配の面。自分側でも 0 にはしない — 完全に消すと「自分の図」へ
         切り替わってしまい、同じ面の上にいることが見えなくなる。 */
      if (scene.field) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.globalAlpha = 0.94 - 0.72 * t;
        ctx.drawImage(scene.field, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }

      /* 灯り → 粒 → 杯 の順。逆にすると光が粒を洗い流して気配が濁る。 */
      if (t > 0.02) {
        for (const place of scene.places) {
          if (place.depth === null) continue;
          const radius = (34 + 46 * place.depth) * sizeScale;
          const peak = 0.2 * t * (0.45 + 0.55 * place.depth);
          const glow = ctx.createRadialGradient(
            place.x,
            place.y,
            0,
            place.x,
            place.y,
            radius
          );
          glow.addColorStop(0, selfGlowStyle(peak));
          glow.addColorStop(0.45, selfGlowStyle(peak * 0.42));
          glow.addColorStop(1, selfGlowStyle(0));
          ctx.fillStyle = glow;
          ctx.fillRect(place.x - radius, place.y - radius, radius * 2, radius * 2);
        }
      }

      // 粒は位置を作り直さず、先頭から何粒描くかだけを動かす。
      const visible = Math.round(scene.grains.length * (1 - 0.86 * t));
      const grainFade = 1 - 0.45 * t;
      for (let i = 0; i < visible; i++) {
        const grain = scene.grains[i];
        const sway = Math.sin(time * grain.speed * 0.7 + grain.phase);
        const drift = Math.cos(time * grain.speed * 0.5 + grain.phase * 1.7);
        const x = planeToScreenX(fit, grain.u) + sway * 1.5;
        const y = planeToScreenY(fit, grain.v) + drift * 1.2;
        ctx.beginPath();
        ctx.arc(x, y, grain.r * sizeScale, 0, TAU);
        ctx.fillStyle = crowdGrainStyle(grain.a * (0.82 + 0.18 * sway) * grainFade);
        ctx.fill();
      }

      // 自分の杯。みんな側では粒と同じ大きさ・色に沈み、自分側で堆積になる。
      for (const placed of scene.cups) {
        const look = cupAppearance(placed.cup, t, scene.cupBase);
        ctx.beginPath();
        ctx.arc(placed.x, placed.y, Math.max(0.6, look.radius), 0, TAU);
        ctx.fillStyle = look.fill;
        ctx.fill();
        if (look.ring) {
          ctx.beginPath();
          ctx.arc(placed.x, placed.y, Math.max(0.6, look.radius) + 2.6, 0, TAU);
          ctx.strokeStyle = look.ring;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }

      /* 産地名。みんな側は気配の濃い土地が、自分側は通った土地が名を持つ。
         同じ名を二度描かず、両側の重みを 1 つの不透明度に畳む。 */
      ctx.textBaseline = "middle";
      ctx.font = `300 ${labelSize}px ${ROJI_VIZ_SERIF}`;
      spaced.letterSpacing = "1.5px";
      ctx.lineJoin = "round";
      for (const place of scene.places) {
        const crowdWeight = Math.pow(place.warmth, 1.6);
        const selfWeight = place.depth === null ? 0.1 : 0.36 + 0.64 * place.depth;
        // 「出すか出さないか」と「出すならどれだけ濃く書くか」を分ける。
        const visibility = (1 - t) * 0.62 * crowdWeight + t * 0.88 * selfWeight;
        // 狭い枠では名を並べると隣同士が重なって、どちらも読めなくなる。
        // 触れている産地だけは必ず残す (読みと絵が食い違わないため)。
        if (scene.narrow && visibility < 0.46 && reading !== place.id) continue;
        if (visibility < 0.06) continue;

        // **濃い気配の面の上では、薄い墨は沈んで読めない。** 出すと決めた名は
        // 必ず読める濃さで書く (産地名は絵の装飾ではなく読み物なので、面の濃淡に
        // 合わせて薄くしてはいけない)。強弱は名の出し入れ側で既に付いている。
        const alpha = reading === place.id ? 0.98 : Math.max(visibility, 0.82);

        /* 逃がす向きはデータ層が持つ (近接する産地を左右へ振り分けるため)。
           枠の右端に寄った産地だけは、はみ出しを避けて必ず左へ返す。 */
        const left = place.labelSide === "l" || place.x > width * 0.8;
        const gap = 11 + (place.depth === null ? 0 : 10 * place.depth * t);
        const lx = place.x + (left ? -gap : gap);
        const ly = place.y + place.labelDy;
        ctx.textAlign = left ? "right" : "left";
        // 生成りの縁取りを厚めに敷いてから墨を置く。面が苔で濃くなっても
        // 文字のまわりに紙が残るので、どの濃度の面の上でも輪郭が立つ。
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = labelHaloStyle(Math.min(1, alpha * 1.05));
        ctx.strokeText(place.name, lx, ly);
        ctx.fillStyle = labelInkStyle(alpha);
        ctx.fillText(place.name, lx, ly);
      }
      spaced.letterSpacing = "0px";

      // 触れている産地の印。線 1 本だけで「ここを読んでいる」を示す。
      if (reading) {
        const place = scene.places.find((p) => p.id === reading);
        if (place) {
          ctx.beginPath();
          ctx.arc(place.x, place.y, 13, 0, TAU);
          ctx.strokeStyle = labelInkStyle(0.5);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    drawRef.current = draw;
    draw(0);

    if (prefersReducedMotion()) {
      // 動かさない。粒は位相 0 の「ある瞬間」で固定する。
      return () => {
        drawRef.current = null;
        sceneRef.current = null;
      };
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      draw((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      drawRef.current = null;
      sceneRef.current = null;
    };
  }, [rebuildKey]);

  /* ── レンズと読みをループへ渡し、静止時は 1 枚だけ描き直す ── */
  useEffect(() => {
    lensRef.current = lens;
    readingRef.current = readingId;
    drawRef.current?.(0);
  }, [lens, readingId]);

  /* ── 枠の大きさが大きく変わったら焼き直す ── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let last = host.clientWidth;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      const next = host.clientWidth;
      // スクロールバーの出入り程度では焼き直さない (面の再計算は安くない)。
      if (Math.abs(next - last) < 24) return;
      last = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRebuildKey((key) => key + 1), 240);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  /* ── 産地に触れる ── */
  const readAt = useCallback((clientX: number, clientY: number) => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const place = nearestPlace(
      scene.fit,
      clientX - rect.left,
      clientY - rect.top,
      Math.max(30, scene.width * 0.05)
    );
    const next = place ? place.id : null;
    // 同じ産地の上を動いている間は state を触らない (毎フレーム再 render を防ぐ)。
    setReadingId((prev) => (prev === next ? prev : next));
  }, []);

  /* ── レンズの操作 ── */
  const moveLensTo = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width < 1) return;
    setLens(clamp01((clientX - rect.left) / rect.width));
  }, []);

  const handleTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      moveLensTo(event.clientX);
    },
    [moveLensTo]
  );

  const handleTrackPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      moveLensTo(event.clientX);
    },
    [moveLensTo]
  );

  const handleTrackPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    []
  );

  const handleTrackKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (delta: number) => {
      event.preventDefault();
      setLens((value) => clamp01(value + delta));
    };
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        step(KEY_STEP);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        step(-KEY_STEP);
        break;
      case "PageUp":
        step(KEY_STEP_LARGE);
        break;
      case "PageDown":
        step(-KEY_STEP_LARGE);
        break;
      case "Home":
        event.preventDefault();
        setLens(0);
        break;
      case "End":
        event.preventDefault();
        setLens(1);
        break;
      default:
        break;
    }
  }, []);

  const reading = readingId === null ? null : placeReading(readingId, lens);

  return (
    <div
      data-slot="community-lens"
      className={cn("flex flex-col gap-4", className)}
    >
      <div
        ref={hostRef}
        className="relative h-96 w-full overflow-hidden lg:h-140"
        style={{ backgroundColor: ROJI_VIZ_COLOR.kinari }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="absolute inset-0 block h-full w-full"
          onPointerMove={(event) => readAt(event.clientX, event.clientY)}
          onPointerDown={(event) => readAt(event.clientX, event.clientY)}
          onPointerLeave={() => setReadingId(null)}
        />
      </div>

      {/* 操作と読みは図の外。図の上にカードを浮かべると操作を覆う (原型の事故)。 */}
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="roji-viz-caption-wide shrink-0 text-xs whitespace-nowrap"
          style={{ color: rgbaOf(ROJI_VIZ_COLOR.sumi, 0.34 + 0.52 * (1 - lens)) }}
        >
          {LENS_ENDS.crowd}
        </span>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={LENS_CONTROL_LABEL}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(lens * 100)}
          aria-valuetext={lensVoice(lens)}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          onKeyDown={handleTrackKeyDown}
          className="relative h-8 flex-1 cursor-ew-resize touch-none"
        >
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 block h-px w-full -translate-y-1/2"
            style={{ backgroundColor: rgbaOf(ROJI_VIZ_COLOR.sumi, 0.24) }}
          />
          <span
            aria-hidden="true"
            className="absolute top-1/2 block size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${lens * 100}%`,
              backgroundColor: rgbaOf(ROJI_VIZ_COLOR.sumi, 0.72),
            }}
          />
        </div>

        <span
          aria-hidden="true"
          className="roji-viz-caption-wide shrink-0 text-xs whitespace-nowrap"
          style={{ color: rgbaOf(ROJI_VIZ_COLOR.sumi, 0.34 + 0.52 * lens) }}
        >
          {LENS_ENDS.self}
        </span>
      </div>

      {/* 両端の一行。数を出さないまま「いま何を見ているか」だけを言う。 */}
      <p aria-hidden="true" className="relative h-4 text-xs text-muted-foreground">
        <span className="roji-viz-caption absolute inset-0" style={{ opacity: 1 - lens }}>
          {CROWD_SUMMARY}
        </span>
        <span className="roji-viz-caption absolute inset-0" style={{ opacity: lens }}>
          {SELF_SUMMARY}
        </span>
      </p>

      {/* 触れた土地の読み。回数も割合も出さない。 */}
      <p
        aria-live="polite"
        data-slot="community-reading"
        className="roji-viz-caption min-h-10 text-xs leading-relaxed text-foreground"
      >
        {reading ? (
          <>
            <span className="roji-viz-caption-wide">{reading.name}</span>
            <span className="text-muted-foreground">　{reading.phrase}</span>
            {reading.footprint ? (
              <span className="text-muted-foreground">　{reading.footprint}</span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">{COMMUNITY_HINT}</span>
        )}
      </p>

      {/* 凡例は 1 行だけ。色はカテゴリーを表すので、出す色も 1 つしかない。 */}
      <p
        data-slot="community-legend"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: COMMUNITY_COLOR }}
        />
        <span className="roji-viz-caption-wide">{COMMUNITY_CATEGORY_LABEL}</span>
      </p>
    </div>
  );
}

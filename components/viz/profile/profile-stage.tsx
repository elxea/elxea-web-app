"use client";

/**
 * roji プロファイル (ミクロ⇔マクロ) の板。操作はビュー内で完結する (要件)。
 *
 * データは3本のGET (`/api/profile/self` / `field` / `words`) から取得し、
 * 描画は `ProfileRenderer` (暫定実装 = `CanvasProfileRenderer`) に委ねる。
 * この層は「取得して渡す」「操作を状態機械 (`camera.ts`) に伝える」だけを持ち、
 * 画面の意味 (色・形) を一切知らない。
 *
 * ## 操作 (Setaka決定 2026-09-05・反論なし で確定)
 *
 * - ホイール / `+` / `-` / 縦置きスライダーで**細かさの段のみ**。中心は常に自分
 *   (Decision Log https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac)
 * - **自由パン (ドラッグして探す「泳ぐ」操作) は無い** — 同じ決定の帰結。
 *   自分は常に画面中心にいるため「じぶんへ戻る」ボタンも画面外の印も無い。
 *   倍率だけを ×1 に戻す道は `0` キーと、スライダーを下端まで下ろすこと。
 *   その下端に置いた記号 (小さな輪) だけが「ここが、じぶん」を指す最小の表現で、
 *   押すものではない (押せる部品を増やさない)
 * - 縦置きスライダー (板の右端) だけを操作として置く。canvas の中にボタンを
 *   描かない (板は `role="img"` + `aria-label` のみ)。上部・下部には何も置かない
 * - `prefers-reduced-motion` のときは EMA を切り、目標値を即時反映する
 *
 * ## 段を動かしても枠は動かない (2026-09-06・本 PR)
 *
 * 段 (`z`) は幾何的な拡大率ではなく**細かさ**である (理由は `camera.ts` の
 * 冒頭)。段が変わったら枠 (中心・縮尺) は一切動かさず、`z` を付けて 3 本の
 * GET を取り直す — 密度格子は 1 段細かい LOD に、等値線は段数が増え、言葉は
 * 一般語から共通語・個人語へ分解される。旧実装は `field` にだけ `z` を渡し、
 * `words` には渡していなかったので、**語は最後まで分解されなかった**。
 *
 * ## 中心と倍率は毎回データから決め直す (2026-09-06)
 *
 * 旧実装は world 原点を中心に固定し、倍率も定数 40px/world-unit だった。
 * どちらもデータと無関係なので、お茶の面は分布が右下 (実測 198〜291px) に
 * ずれ、言葉の面は板の中央 70px 四方に札が団子になっていた。中心
 * (`sceneFraming().anchor` = 自分 / 未ログイン時はみんなの重心) と倍率
 * (`fitBaseScale`) は **データが届いたとき**と**板の大きさが変わったとき**に
 * 決め直す。この 2 つの機会は補間せず現在値ごと置き換える (自分が画面の中を
 * 滑って移動して見えるのを避けるため)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CanvasProfileRenderer } from "@/components/viz/profile/renderers/canvas";
import {
  cameraForFraming,
  easeCamera,
  initialCamera,
  zoomBy,
  zoomTo,
} from "@/components/viz/profile/camera";
import type { CameraState, ProfileScene } from "@/components/viz/profile/renderer";
import { profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

export interface ProfileStageProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  /**
   * 倍率スライダーの `aria-label`。
   *
   * 既定は日本語のべた書きだった。板は `/{locale}/profile` (ja / en) からも
   * 使うので、locale を持つ呼び出し側が渡せる口を開けてある。渡さないとき
   * (`/dev/profile`・Storybook) は従来どおりの文言になる。
   */
  zoomLabel?: string;
  facet: ProfileFacet;
  category?: TeaCategory;
  className?: string;
}

/**
 * `zoomLabel` 省略時の文言。
 *
 * 段は拡大率ではなく細かさなので「倍率 一倍から…」とは言わない (画面が言って
 * いることと、実際に起きることを一致させる)。図に算用数字を出さない作法も継続。
 */
const DEFAULT_ZOOM_LABEL = "細かさ 粗いから細かいまで";

/** スライダーの目盛り。細かさの段 0..2 を 1/100 段で刻む。 */
const ZOOM_SLIDER_STEPS = 100;
const ZOOM_SLIDER_MAX = 200;

/**
 * 縦置きスライダーの帯。`rotate(-90deg)` する前の値なので、長さが縦・厚みが横に
 * なる。厚みを 44 にするのは、回したあとの当たり判定の幅をタップ領域の下限
 * (44px) に保つため。
 */
const ZOOM_TRACK_LENGTH = 176;
const ZOOM_TRACK_THICKNESS = 44;

/** 帯を板の右の縁からこれだけ内側に置く (フォーカスの輪郭ぶんの逃げ)。 */
const ZOOM_EDGE_INSET = 6;

export function ProfileStage({ label, zoomLabel, facet, category, className }: ProfileStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<CameraState>(initialCamera());
  const targetCameraRef = useRef<CameraState>(initialCamera());
  const sceneRef = useRef<ProfileScene>({ self: null, field: null, words: null });
  const viewRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  /**
   * いま要る細かさの帯 (LOD の帯 = 段の整数)。
   *
   * `field` の格子解像度 (`lib/profile/field.ts#resolveGridDims`)・等値線の段数
   * (`contourLevelsFor`)・`words` の層の深さ (`wordLayerDepth`) の 3 つが、
   * すべてこの 1 つの値から決まる。3 本の GET すべてに同じ `z` を渡すのが
   * 「寄ると分解される」の実装本体。
   */
  const [zBand, setZBand] = useState(0);
  /** 中心と縮尺を最後に引き直した面 (`facet:category`)。 */
  const framedKeyRef = useRef<string | null>(null);

  /**
   * 中心と倍率の基準を、いまのデータと板の大きさから決め直す。
   *
   * 見ている倍率段 (`z`) だけは引き継ぐ — 板を回した / データが届いたという
   * だけで倍率が飛ぶと、読んでいた場所を失う。中心と基準倍率は補間せず現在値
   * ごと置き換える (自分が画面の中を滑って移動して見えるのを避ける)。
   */
  const reframe = useCallback(() => {
    const { w, h } = viewRef.current;
    if (w <= 0 || h <= 0) return;
    const framing = sceneFraming(sceneRef.current, facet);
    const next = cameraForFraming({
      anchor: framing.anchor,
      radius: framing.radius,
      viewW: w,
      viewH: h,
      z: targetCameraRef.current.z,
    });
    targetCameraRef.current = next;
    cameraRef.current = next;
  }, [facet]);

  /**
   * 倍率が変わったら、右端のスライダーのつまみと塗りも同じ値へ動かす。
   *
   * ホイールと `+`/`-`/`0` キーからも倍率は変わるので、**画面に出ている倍率と
   * つまみの位置が食い違わない**ようにここで一本化する。塗り分けを疑似要素で
   * 作らず背景のグラデーションにするのは `.audio-seek` と同じ理由 (疑似要素は
   * ブラウザごとに当たる要素名が違い、片方だけ塗れない事故が起きる)。
   */
  const syncZoomUi = useCallback(() => {
    const z = targetCameraRef.current.z;
    const el = sliderRef.current;
    if (el) {
      const raw = Math.round(z * ZOOM_SLIDER_STEPS);
      el.value = String(raw);
      el.style.setProperty("--roji-zoom-progress", `${(raw / ZOOM_SLIDER_MAX) * 100}%`);
    }
    /* 段をまたいだら、その段に見合う細かさで 3 本を取り直す。同じ値のときは
       React が更新を落とすので、動かしている最中に毎フレーム走ることはない。 */
    setZBand(Math.min(2, Math.max(0, Math.round(z))));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new CanvasProfileRenderer();
    renderer.mount(host, { reducedMotion });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      viewRef.current = { w: rect.width, h: rect.height };
      reframe();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    const loop = () => {
      const cam = reducedMotion
        ? targetCameraRef.current
        : easeCamera(cameraRef.current, targetCameraRef.current);
      cameraRef.current = cam;
      renderer.draw(sceneRef.current, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.destroy();
    };
  }, [reducedMotion, reframe]);

  useEffect(() => {
    let cancelled = false;
    const key = `${facet}:${category ?? "-"}`;
    async function load() {
      const bbox = profileFieldBbox(facet);
      const fieldQs = new URLSearchParams({ facet, z: String(zBand) });
      /* `bbox` は面の全域で固定 (寄っても狭めない)。狭めると Spec が禁じている
         「極小 bbox で少人数を孤立抽出する」経路を開く。`z` だけが変わる。 */
      const wordsQs = new URLSearchParams({ facet, bbox: bbox.join(","), z: String(zBand) });
      if (category) {
        fieldQs.set("category", category);
        wordsQs.set("category", category);
      }
      const selfPath = facet === "tea" && category ? `/api/profile/self?facet=tea&category=${category}` : null;

      const fetchJson = (path: string) =>
        fetch(path)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

      const [selfRes, fieldRes, wordsRes] = await Promise.all([
        selfPath ? fetchJson(selfPath) : Promise.resolve(null),
        fetchJson(`/api/profile/field?${fieldQs.toString()}`),
        fetchJson(`/api/profile/words?${wordsQs.toString()}`),
      ]);
      if (cancelled) return;
      sceneRef.current = { self: selfRes, field: fieldRes, words: wordsRes };
      /* 中心と倍率の基準を引き直すのは**面・カテゴリーが変わったとき**だけ。
         段をまたいで格子を取り直しただけのときに引き直すと、細かくなった格子の
         外接矩形のわずかな違いで絵がわずかに跳ねる。段のあいだ、枠は動かさない。 */
      if (framedKeyRef.current !== key) {
        framedKeyRef.current = key;
        reframe();
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [facet, category, zBand, reframe]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.02 : 0.02;
      targetCameraRef.current = zoomBy(targetCameraRef.current, delta);
      syncZoomUi();
    },
    [syncZoomUi],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case "+":
        case "=":
          targetCameraRef.current = zoomBy(targetCameraRef.current, 0.1);
          break;
        case "-":
          targetCameraRef.current = zoomBy(targetCameraRef.current, -0.1);
          break;
        case "0":
          targetCameraRef.current = zoomTo(targetCameraRef.current, 0);
          break;
        default:
          return;
      }
      syncZoomUi();
      e.preventDefault();
    },
    [syncZoomUi],
  );

  const onZoomSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      targetCameraRef.current = zoomTo(targetCameraRef.current, Number(e.target.value) / ZOOM_SLIDER_STEPS);
      syncZoomUi();
    },
    [syncZoomUi],
  );

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        /* 縦置きスライダーは `rotate(-90deg)` なので、**回す前の**横長の
           レイアウト箱が板の右へはみ出す (見た目は板の中に収まる)。その箱が
           ページの横スクロールを生まないようにここで止める。canvas は板と
           同寸なので切り取られるものは無い。 */
        overflow: "hidden",
      }}
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        data-slot="profile-stage-canvas-host"
        style={{
          width: "100%",
          height: "100%",
          /* 高さは板 (`profile-surface.tsx` の縦横比を持つ箱) が決める。ここで
             `minHeight` を持つと、SP で箱より背の高い canvas になり縦横比が
             崩れる (中身は短辺に合わせて縮むので、余白だけが増える)。 */
          minHeight: 240,
          backgroundColor: ROJI_VIZ_COLOR.kinari,
          touchAction: "none",
          outline: "none",
        }}
      />
      {/* 倍率は板の右端・縦置き。上にも下にも操作は置かない (要件)。
          ネイティブの `input[type=range]` を土台にしたまま `rotate(-90deg)` で
          縦にするのは、キーボード操作と支援技術からの見え方を保つため
          (`writing-mode` による縦置きは対応ブラウザが割れる)。上が拡大・下が
          ×1 になり、矢印キーの上下とも一致する。 */}
      <div
        data-slot="profile-stage-zoom"
        style={{
          position: "absolute",
          /* 板の縁にぴったり付けない。`:focus-visible` の輪郭は帯の外側へ
             2px + 3px はみ出すので、0 にすると上の `overflow: hidden` が
             輪郭の右端を切る (キーボードで来た人にだけ欠けて見える)。 */
          right: ZOOM_EDGE_INSET,
          top: 0,
          bottom: 0,
          width: ZOOM_TRACK_THICKNESS,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          /* 帯の余白では板 (ホイール操作) を触れるようにしておく。 */
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            position: "relative",
            display: "block",
            width: ZOOM_TRACK_THICKNESS,
            height: ZOOM_TRACK_LENGTH,
          }}
        >
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={ZOOM_SLIDER_MAX}
            step={1}
            defaultValue={0}
            aria-label={zoomLabel ?? DEFAULT_ZOOM_LABEL}
            aria-orientation="vertical"
            onChange={onZoomSlider}
            data-slot="profile-stage-zoom-slider"
            className="roji-zoom-slider"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: ZOOM_TRACK_LENGTH,
              height: ZOOM_TRACK_THICKNESS,
              pointerEvents: "auto",
              /* 実値の正本は roji のデータ表現パレット
                 (`lib/viz/roji-viz-palette.ts`)。CSS 側に色をもう一組持たない。
                 部品は苔の系統だけで組む。黒・近黒 (`sumi`) を**背景・大面積に
                 使わない**のがルールで (Setaka の元の言葉は「黒背景が怖い」)、
                 文字・記号のインクとしては可 — つまみや溝は面なので使わない。 */
              ["--roji-zoom-track" as string]: ROJI_VIZ_COLOR.suna,
              ["--roji-zoom-fill" as string]: ROJI_VIZ_COLOR.usukoke,
              ["--roji-zoom-thumb" as string]: ROJI_VIZ_COLOR.koke,
              ["--roji-zoom-focus" as string]: ROJI_VIZ_COLOR.fukamidori,
            }}
          />
        </span>
        {/* 帯の下端 = ×1 = じぶん。それを指す最小の記号 (輪と粒) だけを置く。
            押すものではない (押せる部品を増やさない) ので `aria-hidden`。
            倍率を ×1 に戻す操作はスライダーを下端まで下ろすか `0` キー。 */}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden="true"
          focusable="false"
          data-slot="profile-stage-self-mark"
          style={{ display: "block" }}
        >
          <circle cx="5" cy="5" r="4" fill="none" stroke={ROJI_VIZ_COLOR.usukoke} strokeWidth="1" />
          <circle cx="5" cy="5" r="1.4" fill={ROJI_VIZ_COLOR.koke} />
        </svg>
      </div>
    </div>
  );
}

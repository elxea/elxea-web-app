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
 * - ホイール / `+` / `-` / 縦置きスライダーで**ズームのみ**。中心は常に自分
 *   (Decision Log https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac)
 * - **自由パン (ドラッグして探す「泳ぐ」操作) は無い** — 同じ決定の帰結。
 *   自分は常に画面中心にいるため「じぶんへ戻る」ボタンも画面外の印も無い
 * - `0` キーで倍率だけ ×1 (マクロ) へ戻す
 * - 縦置きスライダー (板の右端) だけを操作として置く。canvas の中にボタンを
 *   描かない (板は `role="img"` + `aria-label` のみ)
 * - `prefers-reduced-motion` のときは EMA を切り、目標値を即時反映する
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CanvasProfileRenderer } from "@/components/viz/profile/renderers/canvas";
import { easeCamera, initialCamera, zoomBy, zoomTo } from "@/components/viz/profile/camera";
import type { CameraState, ProfileScene } from "@/components/viz/profile/renderer";
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

/** `zoomLabel` 省略時の文言。数は漢数字で言う (図に算用数字を出さない作法)。 */
const DEFAULT_ZOOM_LABEL = "倍率 一倍からせん倍";

function fieldBboxFor(facet: ProfileFacet): [number, number, number, number] {
  return facet === "tea" ? [-9, -9, 9, 9] : [-1, -1, 1, 1];
}

export function ProfileStage({ label, zoomLabel, facet, category, className }: ProfileStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraState>(initialCamera());
  const targetCameraRef = useRef<CameraState>(initialCamera());
  const sceneRef = useRef<ProfileScene>({ self: null, field: null, words: null });
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

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
  }, [reducedMotion]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const z = Math.round(cameraRef.current.z);
      const bbox = fieldBboxFor(facet);
      const fieldQs = new URLSearchParams({ facet, z: String(z) });
      const wordsQs = new URLSearchParams({ facet, bbox: bbox.join(",") });
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
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [facet, category]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.02 : 0.02;
    targetCameraRef.current = zoomBy(targetCameraRef.current, delta);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
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
    e.preventDefault();
  }, []);

  const onZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const z = Number(e.target.value) / 100;
    targetCameraRef.current = zoomTo(targetCameraRef.current, z);
  }, []);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
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
          minHeight: 480,
          backgroundColor: ROJI_VIZ_COLOR.kinari,
          touchAction: "none",
          outline: "none",
        }}
      />
      <input
        type="range"
        min={0}
        max={200}
        step={1}
        defaultValue={0}
        aria-label={zoomLabel ?? DEFAULT_ZOOM_LABEL}
        onChange={onZoomSlider}
        data-slot="profile-stage-zoom-slider"
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          width: 160,
          minHeight: 44,
          transform: "translateY(-50%) rotate(-90deg)",
        }}
      />
    </div>
  );
}

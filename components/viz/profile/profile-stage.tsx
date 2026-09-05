"use client";

/**
 * roji プロファイル (ミクロ⇔マクロ) の板。操作はビュー内で完結する (要件)。
 *
 * データは3本のGET (`/api/profile/self` / `field` / `words`) から取得し、
 * 描画は `ProfileRenderer` (暫定実装 = `CanvasProfileRenderer`) に委ねる。
 * この層は「取得して渡す」「操作を状態機械 (`camera.ts`) に伝える」だけを持ち、
 * 画面の意味 (色・形) を一切知らない。
 *
 * 操作:
 * - ドラッグ / ホイールでパン・ズーム (試作を踏襲)
 * - `+` / `-` で倍率、`0` で自分へ戻る、矢印キーでパン
 * - 縦置きスライダー (板の右端) と「じぶんへ戻る」ボタン (板の内側の隅) —
 *   canvas の中にボタンを描かない (板は `role="img"` + `aria-label` のみ)
 * - `prefers-reduced-motion` のときは EMA を切り、目標値を即時反映する
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CanvasProfileRenderer } from "@/components/viz/profile/renderers/canvas";
import {
  easeCamera,
  goHome,
  initialCamera,
  isAway,
  panBy,
  zoomAt,
} from "@/components/viz/profile/camera";
import type { CameraState, ProfileScene } from "@/components/viz/profile/renderer";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";
import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

export interface ProfileStageProps {
  /** スクリーンリーダー向けの説明。図の中に説明文を置かないので必須。 */
  label: string;
  facet: ProfileFacet;
  category?: TeaCategory;
  className?: string;
}

function fieldBboxFor(facet: ProfileFacet): [number, number, number, number] {
  return facet === "tea" ? [-9, -9, 9, 9] : [-1, -1, 1, 1];
}

export function ProfileStage({ label, facet, category, className }: ProfileStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraState>(initialCamera());
  const targetCameraRef = useRef<CameraState>(initialCamera());
  const sceneRef = useRef<ProfileScene>({ self: null, field: null, words: null });
  const [away, setAway] = useState(false);
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
      const rect = host.getBoundingClientRect();
      setAway(isAway(cam, rect.width, rect.height));
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
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const delta = e.deltaY > 0 ? -0.02 : 0.02;
    targetCameraRef.current = zoomAt(
      targetCameraRef.current,
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
      delta,
    );
  }, []);

  const dragState = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.x;
    const dy = e.clientY - dragState.current.y;
    dragState.current = { x: e.clientX, y: e.clientY };
    targetCameraRef.current = panBy(targetCameraRef.current, dx, dy);
  }, []);
  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = 40;
    switch (e.key) {
      case "+":
      case "=":
        targetCameraRef.current = zoomAt(targetCameraRef.current, rect.width / 2, rect.height / 2, rect.width, rect.height, 0.1);
        break;
      case "-":
        targetCameraRef.current = zoomAt(targetCameraRef.current, rect.width / 2, rect.height / 2, rect.width, rect.height, -0.1);
        break;
      case "0":
        targetCameraRef.current = goHome(targetCameraRef.current);
        break;
      case "ArrowLeft":
        targetCameraRef.current = panBy(targetCameraRef.current, step, 0);
        break;
      case "ArrowRight":
        targetCameraRef.current = panBy(targetCameraRef.current, -step, 0);
        break;
      case "ArrowUp":
        targetCameraRef.current = panBy(targetCameraRef.current, 0, step);
        break;
      case "ArrowDown":
        targetCameraRef.current = panBy(targetCameraRef.current, 0, -step);
        break;
      default:
        return;
    }
    e.preventDefault();
  }, []);

  const onZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const z = Number(e.target.value) / 100;
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    targetCameraRef.current = zoomAt(
      targetCameraRef.current,
      rect.width / 2,
      rect.height / 2,
      rect.width,
      rect.height,
      z - targetCameraRef.current.z,
    );
  }, []);

  const onHome = useCallback(() => {
    targetCameraRef.current = goHome(targetCameraRef.current);
  }, []);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={hostRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
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
        aria-label="倍率 一倍からせん倍"
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
      <button
        type="button"
        aria-label="じぶんへ戻る"
        onClick={onHome}
        data-away={away}
        data-slot="profile-stage-home"
        style={{
          position: "absolute",
          right: 56,
          bottom: 8,
          width: 44,
          height: 44,
          border: 0,
          background: "none",
          cursor: "pointer",
          opacity: away ? 1 : 0.25,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "block",
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: `1.5px solid ${ROJI_VIZ_COLOR.fukamidori}`,
            margin: "0 auto",
          }}
        />
      </button>
    </div>
  );
}

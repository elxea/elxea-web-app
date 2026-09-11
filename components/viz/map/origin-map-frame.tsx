"use client";

/**
 * 地図の枠と、地図本体の遅延読み込みを担う層。
 *
 * ## なぜ枠を描くのか
 *
 * 海はページの紙 (cream) と同色で塗られるので、罫が無いと地図の領域そのものが
 * 定義されない。外周に stone 35% の 1px 罫を置くのはそのため
 * (Figma node 8229:3「この面の仕様」)。
 *
 * ## なぜ画面に入るまで読まないのか
 *
 * maplibre-gl は JS だけで gzip 271KB あり、品目ページで最も重い依存になる。
 * 産地の地図はページのかなり下にあり、多くの読み手は到達しない。
 * よって `next/dynamic({ ssr: false })` で分割したうえ、さらに
 * IntersectionObserver で **画面に近づくまで render しない**。
 * `next/dynamic` は「render されて初めて chunk を取りに行く」ので、
 * この 2 段で「開いただけでは 1 バイトも落ちない」が成立する。
 *
 * SSR で読めないのは maplibre-gl が import 時に `window` に触れるため。
 * App Router の page.tsx は Server Component なので `ssr: false` を直接書けず、
 * このクライアント側ラッパーを 1 枚挟むのが公式の回避手順。
 * https://nextjs.org/docs/app/guides/lazy-loading
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

const OriginMap = dynamic(
  () => import("./origin-map").then((m) => m.OriginMap),
  { ssr: false },
);

export interface OriginMapFrameProps {
  lat: number;
  lng: number;
  label: string;
  className?: string;
  /**
   * 枠の寸法を CSS 変数で渡すための口。
   *
   * 地図の高さは「ピンを上端から 57px に置く」計算 (`centerForPin`) の入力なので、
   * 寸法の正本は `ITEM_MAP_SIZE` 側にある。className に px を直書きすると正本と
   * 二重管理になり、片方だけ動かしたときにピンの位置が静かにずれる。
   */
  style?: CSSProperties;
}

/** 画面手前どれだけで読み始めるか。スクロール中に間に合わせるための先読み。 */
const PRELOAD_MARGIN = "200px";

export function OriginMapFrame({
  lat,
  lng,
  label,
  className,
  style,
}: OriginMapFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || inView) return;

    // IntersectionObserver が無い環境 (古い WebView) では素直に読み込む。
    // 地図が出ないより 271KB 落ちる方がまし、という順位付け。
    if (typeof IntersectionObserver === "undefined") {
      // IntersectionObserver の有無は render 中に判定できない (SSR と client で
      // 食い違う) ので、effect の中でしか書けない。1 回きりで再入もしない。
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 非対応環境の一度きりのフォールバック
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <div
      ref={frameRef}
      data-slot="origin-map-frame"
      style={style}
      className={cn(
        // 海 = 紙なので、読み込み前も読み込み後も地の色は変わらない。
        "overflow-hidden rounded-sm border border-brand-stone/35 bg-background",
        className,
      )}
    >
      {inView ? <OriginMap lat={lat} lng={lng} label={label} /> : null}
    </div>
  );
}

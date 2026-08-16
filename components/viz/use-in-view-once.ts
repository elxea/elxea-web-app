"use client";

/**
 * 「画面に近づいたら 1 度だけ true になる」フック。
 *
 * roji のデータ表現はどれもページのかなり下にあり、多くの読み手は到達しない。
 * `next/dynamic({ ssr: false })` は **render されて初めて chunk を取りに行く**
 * ので、この 2 段で「開いただけでは 1 バイトも落ちない」が成立する。
 * (`components/viz/map/origin-map-frame.tsx` が先に採った作りをそのまま使う)
 */

import { useEffect, useRef, useState, type RefObject } from "react";

/** 画面手前どれだけで読み始めるか。スクロール中に間に合わせるための先読み。 */
const PRELOAD_MARGIN = "200px";

export function useInViewOnce<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    // IntersectionObserver が無い環境 (古い WebView) では素直に読み込む。
    if (typeof IntersectionObserver === "undefined") {
      // 有無は render 中に判定できない (SSR と client で食い違う) ので
      // effect の中でしか書けない。1 回きりで再入もしない。
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
      { rootMargin: PRELOAD_MARGIN }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  return [ref, inView];
}

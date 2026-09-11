"use client";

import * as React from "react";

/**
 * ReadingProgress — 記事の読み進み具合を示す 2px の追従バー。
 *
 * Figma が正本 — ジャーナル詳細【R2: 確定版】
 * (PC 8074:44851 / SP 8074:45003)。高さ 2px、ヘッダー直下に貼り付き、
 * fill が現在地の割合を示す。
 *
 * 「ヘッダー直下」= ヘッダー高さぶんのオフセット。以前は `top-0` で貼っていた
 * ため、同じく `sticky top-0` かつ不透明なヘッダー
 * (components/layout/header.tsx) の真下に潜り込み、スクロールした瞬間から
 * 完全に隠れていた (実装済み機能が事実上死んでいた)。ヘッダーと同じ高さ
 * トークン (SP 60 / PC 68 = `component.header.height.*`) を `top` に使い、
 * ブレークポイントもヘッダー側 (`md:`) に揃えて重なりを解消する。
 *
 * z は生スケールの `z-40` を維持する。これは**意図的に名前付きレイヤーへ
 * 移さない**唯一の追従要素で、役割が「本文より前・ヘッダーより後ろ」= 常設
 * UI の段 (1020 以上) には載せたくない面だから (ヘッダーは `--z-sticky` =
 * 1020)。40 < 1020 なので従来どおりヘッダーの後ろに収まる。
 */
export function ReadingProgress() {
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      data-slot="reading-progress"
      aria-hidden="true"
      className="sticky top-(--component-header-height-mobile) z-40 h-0.5 w-full md:top-(--component-header-height-desktop)"
    >
      <div
        data-slot="reading-progress-fill"
        className="h-full bg-primary"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

"use client";

import * as React from "react";

/**
 * ReadingProgress — 記事の読み進み具合を示す 2px の追従バー。
 *
 * Figma が正本 — ジャーナル詳細【R2: 確定版】
 * (PC 8074:44851 / SP 8074:45003)。高さ 2px、ヘッダー直下に貼り付き、
 * fill が現在地の割合を示す。
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
      className="sticky top-0 z-40 h-0.5 w-full"
    >
      <div
        data-slot="reading-progress-fill"
        className="h-full bg-primary"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

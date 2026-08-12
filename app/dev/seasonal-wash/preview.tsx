"use client";

import dynamic from "next/dynamic";

import type { TimeOfDay } from "@/lib/roji/seasonal-palette";

/**
 * canvas に触る本体はクライアント専用。`ssr: false` で読み込むのは、SSR で
 * 描かれない要素を一度サーバー側で組み立てる無駄をなくすため
 * (コンポーネント自体は useEffect 内でしか canvas に触らないので SSR 安全)。
 */
const SeasonalWash = dynamic(
  () => import("@/components/roji/seasonal-wash").then((m) => m.SeasonalWash),
  { ssr: false },
);

export interface SeasonalWashPreviewProps {
  palette: string[];
  month: number;
  timeOfDay: TimeOfDay;
  tempo: number;
  grain: boolean;
  seed: number;
}

/**
 * プレビュー専用の表示。
 *
 * 右下のパラメータ表示は **この面にだけ** 置く。景色そのものは数値もラベルも
 * 持たない (コンセプト第3節「5則」) ので、本番でこの読み出しを流用しない。
 */
export function SeasonalWashPreview({
  palette,
  month,
  timeOfDay,
  tempo,
  grain,
  seed,
}: SeasonalWashPreviewProps) {
  return (
    <main className="relative h-dvh w-full">
      <SeasonalWash
        palette={palette}
        tempo={tempo}
        grain={grain}
        seed={seed}
        className="absolute inset-0 h-full w-full"
      />
      {/* 夜の配色では地が暗くなるので、読み出しは背景付きにして常に読めるようにする。 */}
      <p
        className="absolute bottom-4 right-4 z-10 rounded bg-background/80 px-2 py-1 font-mono text-xs text-foreground"
        data-testid="seasonal-wash-params"
      >
        month={month} time={timeOfDay} tempo={tempo.toFixed(2)} grain=
        {grain ? "on" : "off"} seed={seed}
      </p>
    </main>
  );
}

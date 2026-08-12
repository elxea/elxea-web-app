"use client";

import dynamic from "next/dynamic";
import { useMemo, useSyncExternalStore } from "react";

import {
  readingPaletteFor,
  readingThemePaletteFor,
} from "@/lib/viz/reading-palette";
import {
  seasonalTempo,
  timeOfDayFromHour,
  type SeasonalPalette,
} from "@/lib/viz/seasonal-palette";
import {
  getWashTheme,
  getWashThemeServerSnapshot,
  subscribeWashTheme,
} from "@/lib/viz/wash-theme-store";

/**
 * canvas に触る本体はクライアント専用。`ssr: false` は SSR で描かれない要素を
 * サーバーで組み立てる無駄を省くため。
 */
const SeasonalWash = dynamic(
  () => import("@/components/viz/wash/seasonal-wash").then((m) => m.SeasonalWash),
  { ssr: false },
);

/**
 * 「ブラウザで動いているか」を返すためだけのストア。値は変わらないので購読しない。
 *
 * `useState` + `useEffect` で立てるのと結果は同じだが、あちらは
 * **1 回目を描いてから 2 回目を描く** ので面のマウントが 1 フレーム遅れる。
 * `useSyncExternalStore` はハイドレーション時に確定するので、面は最初の
 * クライアント描画から出る。`components/ui/cookie-consent.tsx` と同じ形。
 */
const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * 読みもの系ページの背景。
 *
 * ## 敷き方 — 画面に固定した 1 枚を、紙より上・本文より下に置く
 * `position: fixed; inset: 0; z-index: -10`。
 *
 * `<body>` の `bg-background` は外していない。CSS の背景伝播により、`<html>` に
 * 背景が無いとき `<body>` の背景は **キャンバス (ビューポート全体) の背景** として
 * 扱われ、いちばん下に一度だけ描かれる。`<body>` 自身の箱の背景としては描かれない。
 * したがって負の `z-index` を持つこの面は **紙の上・本文の下** に入る。
 * 他のページ (カート・アカウント等) はこの面を持たないので、紙がそのまま見える。
 *
 * この性質のおかげで、地を透過にするための上書き (`bg-transparent` を body へ、
 * のような全ページに響く変更) は 1 つも要らない。読みもの系だけがルートグループの
 * layout でこの面を足す、という差分だけで閉じている。
 *
 * ## スクロールしても動かないこと
 * Lenis はラッパー要素を `transform` で動かす方式ではなく、ウィンドウ自体を
 * スクロールさせる方式で使われている (`components/providers/lenis-provider.tsx`
 * は `wrapper` を渡していない)。`transform` を持つ祖先が無いので `fixed` の
 * 基準はビューポートのままで、面はスクロールに追従しない。
 *
 * ## 何を敷くか
 * 既定は季節の色。elxea journal の記事を開いている間だけ、その号のテーマ色から
 * 作った色に差し替わる (`wash-theme-store`)。どちらも読みもの用に紙の明度帯へ
 * 写した色 (`reading-palette`) で、本文のコントラストは季節や時刻で動かない。
 */
export function ReadingWash() {
  const theme = useSyncExternalStore(
    subscribeWashTheme,
    getWashTheme,
    getWashThemeServerSnapshot,
  );

  const mounted = useSyncExternalStore(subscribeNever, onClient, onServer);

  /**
   * 色と速さは **ブラウザに届いてから端末の時計で** 決める。
   *
   * サーバー側で決めると、静的に配信されるページではビルド時刻の色が焼き付く
   * (記事ページは ISR で長く生きる)。「いま」の景色であることが要件なので、
   * 描く側と同じくクライアントで決める。
   *
   * 時計を読むのが `useMemo` の中なのは、`useEffect` で state に入れると
   * 「描く → state を入れる → もう一度描く」の連鎖になるため (React の
   * `set-state-in-effect`)。React が `useMemo` を捨てて再計算しても読み直すのは
   * 現在時刻なので、結果は同じか **より正しい** 値になる。
   */
  const clock = useMemo<{ palette: SeasonalPalette; tempo: number } | null>(() => {
    if (!mounted) return null;
    const now = new Date();
    const timeOfDay = timeOfDayFromHour(now.getHours());
    return {
      palette: theme
        ? readingThemePaletteFor(theme, timeOfDay)
        : readingPaletteFor(now.getMonth() + 1, timeOfDay),
      tempo: seasonalTempo(now),
    };
  }, [mounted, theme]);

  if (!clock) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      data-testid="roji-reading-wash"
      data-roji-theme={theme ?? "seasonal"}
    >
      <SeasonalWash
        palette={clock.palette}
        tempo={clock.tempo}
        intensity="soft"
        seed={7}
        className="h-full w-full"
      />
    </div>
  );
}

export default ReadingWash;

/**
 * SeasonalWash の「動くか / どれくらい遅いか」を決める純関数。
 *
 * canvas の描画ループから切り離してあるのは、`prefers-reduced-motion` の分岐が
 * いちばん壊れやすく、かつブラウザ無しで検証できる部分だから。描画そのものは
 * ブラウザでしか確認できないが、**動かさない判断** はここで機械的に守れる。
 */

/** `window.matchMedia` を持つかもしれない対象。SSR とテストのため最小形にしている。 */
export interface MatchMediaHost {
  matchMedia?: (query: string) => { matches: boolean } | null;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 動きを減らす設定か。SSR (host = undefined) と matchMedia 非対応は false。 */
export function prefersReducedMotion(host?: MatchMediaHost | null): boolean {
  if (!host || typeof host.matchMedia !== "function") return false;
  try {
    return host.matchMedia(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    // 一部の古い WebView は不正なクエリで throw する。動かす側に倒す。
    return false;
  }
}

/** tempo の受け付け範囲。props の型では縛れないので実行時に丸める。 */
export const MIN_TEMPO = 0.5;
export const MAX_TEMPO = 2;

export function clampTempo(tempo: number): number {
  if (!Number.isFinite(tempo)) return 1;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo));
}

export interface MotionPlan {
  /** false なら rAF ループを回さず、初期フレームを 1 枚だけ描いて止める。 */
  animate: boolean;
  /** フレーム間隔の下限 (ms)。30fps 目安。 */
  frameIntervalMs: number;
  /** 時間の進み方の倍率。tempo を丸めた値。 */
  timeScale: number;
}

/** 目標フレームレート。60fps は要らない (遅いほど roji らしい)。 */
export const TARGET_FPS = 30;

export function resolveMotion(options: {
  tempo?: number;
  reducedMotion: boolean;
}): MotionPlan {
  const timeScale = clampTempo(options.tempo ?? 1);
  return {
    animate: !options.reducedMotion,
    frameIntervalMs: 1000 / TARGET_FPS,
    timeScale,
  };
}

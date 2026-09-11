/**
 * 読了判定の純ロジック (A6)。
 *
 * DOM を触らないのでそのまま単体テストできる。React 側 (`ArticleReadTracker`)
 * は visibilitychange / scroll をこの関数群に流し込むだけにする。
 *
 * 直した問題:
 * 1. バックグラウンドタブでも 30 秒経てば読了が立っていた。タブを開きっぱなしに
 *    しただけの記事が「読んだ」として行動ログに入り、パーソナライズの入力が汚れる。
 *    → 経過時間ではなく「可視だった時間」で数える。
 * 2. 1 画面に収まる短い記事は `scrollHeight - innerHeight <= 0` になり、
 *    スクロール読了 (80%) が永久に成立しなかった。
 *    → スクロールでは判定不能であることを明示的に返し、可視時間側に委ねる。
 */

/** 読了とみなす可視時間 (ms)。 */
export const READ_VISIBLE_MS = 30_000;

/** 読了とみなすスクロール到達率。 */
export const READ_SCROLL_RATIO = 0.8;

export type VisibleTimer = {
  /** 可視状態に入る。すでに可視なら何もしない (二重計上を防ぐ)。 */
  resume(): void;
  /** 不可視状態に入る。それまでの可視時間を積算して計測を止める。 */
  pause(): void;
  /** これまでに積算された可視時間 (ms)。 */
  elapsedMs(): number;
  /**
   * 読了成立までの残り (ms)。不可視のあいだは時間が進まないので `null` を返す
   * (呼び出し側はタイマーを張らない)。
   */
  remainingMs(): number | null;
};

/**
 * 可視時間だけを積算するストップウォッチ。
 *
 * @param now テスト用に差し替え可能な時刻源 (既定は `Date.now`)。
 */
export function createVisibleTimer(now: () => number = Date.now): VisibleTimer {
  let accumulated = 0;
  /** 可視になった時刻。不可視なら null。 */
  let since: number | null = null;

  function total(): number {
    return accumulated + (since === null ? 0 : now() - since);
  }

  return {
    resume() {
      if (since === null) since = now();
    },
    pause() {
      if (since !== null) {
        accumulated += now() - since;
        since = null;
      }
    },
    elapsedMs: total,
    remainingMs() {
      if (since === null) return null;
      return Math.max(0, READ_VISIBLE_MS - total());
    },
  };
}

/**
 * スクロール読了の判定結果。
 *
 * - `read`        … 8 割まで到達した。
 * - `reading`     … まだ到達していない。
 * - `undecidable` … 1 画面に収まる記事などでスクロール量から判断できない。
 *                   この場合は可視時間 (`READ_VISIBLE_MS`) が唯一の成立条件になる。
 */
export type ScrollReadState = "read" | "reading" | "undecidable";

export function scrollReadState(
  scrollTop: number,
  scrollHeight: number,
  innerHeight: number
): ScrollReadState {
  const docHeight = scrollHeight - innerHeight;
  // 0 以下 / NaN は「スクロールでは判定できない」。従来はここで早期 return して
  // いたため、短い記事は読了が永久に立たなかった。
  if (!(docHeight > 0)) return "undecidable";
  return scrollTop / docHeight >= READ_SCROLL_RATIO ? "read" : "reading";
}

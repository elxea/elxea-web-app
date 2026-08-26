"use client";

import * as React from "react";

/**
 * 「読んでいるあいだは引っ込み、手が止まったら戻ってくる」。
 *
 * ## 何を直しているか (体感品質監査 #17 / 2026-08-25)
 *
 * SP390 の商品一覧で、右下に固定されたチャットの入口が **2 行目の商品カードの
 * タイトル文字に重なっていた** (実測スクリーンショット audit-products-sp390)。
 * 固定要素なので、画面のどこに何が流れてこようと同じ場所に居座る。カード側に
 * 余白を足しても、スクロールの途中では必ず別の行が下に来るので解決しない。
 * z を上げ下げしても「覆う側が入れ替わる」だけで、勝てる並びは無い
 * (2026-08-18 に同意バーで同じ結論に至っている — `use-bottom-stack-slot.ts`)。
 *
 * 下端に積む面どうしの重なりは「高さで避ける」で解けたが、**流れてくる本文との
 * 重なりは高さでは避けられない**。避けられるのは時間軸しかない — 読んでいる
 * (下へスクロールしている) 最中は引っ込み、手が止まった / 上へ戻った瞬間に出る。
 *
 * ## 約束 (`retreatOnScroll` が正本 / テストはこの関数を縛る)
 *
 *   - 下へ **一定量** 動いたときだけ引っ込む (指の震え程度では消えない)
 *   - 上へ動いたら即座に戻る (探した瞬間に無い、が起きない)
 *   - 画面最上部では常に出す (下端に何も流れてこないので隠す理由が無い)
 *   - 手が止まったら戻る (この 1 つだけは時間の話なので hook 側が持つ)
 *
 * 引っ込めるのは**表示だけ**で、DOM からは外さない。外すと開いている会話が
 * 巻き戻り、支援技術から入口そのものが消える。呼び出し側は `transform` /
 * `opacity` だけを切り替えること (コンポジタで動くので描画を止めない)。
 */

/**
 * 引っ込むまでに要る下向きの移動量。1 行 (24px) より大きく、カード 1 枚
 * (約 280px) よりは十分小さい。指の震えや慣性の揺り戻しで点滅させないための下限。
 */
export const RETREAT_THRESHOLD_PX = 48;

/** 手が止まったと見なすまでの間。短すぎると惰性スクロール中に一瞬だけ出る。 */
export const RETREAT_SETTLE_MS = 240;

export type RetreatState = {
  /** いま出しておくべきか。 */
  visible: boolean;
  /** いまの下向きの一続きが始まった地点。ここからの移動量で閾値を測る。 */
  anchorY: number;
  /** 直前の位置。**向きの判定はこれとの差だけ**で行う。 */
  lastY: number;
};

export function initialRetreatState(y = 0): RetreatState {
  return { visible: true, anchorY: y, lastY: y };
}

/**
 * 新しいスクロール位置を 1 つ受け取って、次の状態を返す**純関数**。
 *
 * 2 つの座標を別々に持つのが要点:
 *
 *   - `lastY` … **向き**を決める。1px でも上へ動いたら「探している」と見なす
 *   - `anchorY` … **量**を決める。下向きの一続きが始まった地点で、上へ動いた
 *     ときだけ引き直す
 *
 * 1 つで兼ねると必ずどちらかが壊れる。`anchorY` だけで向きを見ると、一度
 * 隠れたあと上へ戻っても「起点よりは下」なので出てこない。`lastY` だけで量を
 * 見ると、1 フレームの移動量は数 px しかないので永久に閾値へ届かない。
 */
export function retreatOnScroll(
  state: RetreatState,
  y: number,
  thresholdPx: number = RETREAT_THRESHOLD_PX,
): RetreatState {
  /* 画面最上部 (慣性でマイナスへ振れる環境があるので <= 0 で見る) では、
     下端に本文が流れてこないので隠す理由が無い。 */
  if (y <= 0) return { visible: true, anchorY: 0, lastY: 0 };

  /* 上へ戻った = 探している。即座に出し、次の下向きの起点をここに置く。 */
  if (y < state.lastY) return { visible: true, anchorY: y, lastY: y };

  const next: RetreatState = { ...state, lastY: y };
  if (y - state.anchorY > thresholdPx) next.visible = false;
  return next;
}

/**
 * @param enabled false の間は常に true を返す (PC など隠す理由が無い場面)
 * @returns 出しておくべきなら true
 */
export function useRetreatOnScroll(enabled = true): boolean {
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }
    if (typeof window === "undefined") return;

    let state = initialRetreatState(window.scrollY);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      state = retreatOnScroll(state, window.scrollY);
      setVisible(state.visible);

      /* 手が止まったら戻す。時間の話なのでここだけ hook が持つ。 */
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const y = window.scrollY;
        state = { visible: true, anchorY: y, lastY: y };
        setVisible(true);
      }, RETREAT_SETTLE_MS);
    };

    const onScroll = () => {
      /* スクロールは 1 フレームに何度も飛んでくる。読み取りは 1 フレーム 1 回に
         畳む (レンダー中のレイアウト読み取りを避ける — Web UI ガイドライン)。 */
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [enabled]);

  return visible;
}

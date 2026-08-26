"use client";

import * as React from "react";

/**
 * 「読んでいるあいだは引っ込む。本文の上には居座らない」。
 *
 * ## 何を直しているか (体感品質監査 #17 / 2026-08-25 → 通しテスト E-1 / 2026-08-27)
 *
 * SP390 の商品一覧で、右下に固定されたチャットの入口が **商品カードに重なって
 * いた**。固定要素なので、画面のどこに何が流れてこようと同じ場所に居座る。カード
 * 側に余白を足しても、スクロールの途中では必ず別の行が下に来るので解決しない。
 * z を上げ下げしても「覆う側が入れ替わる」だけで、勝てる並びは無い
 * (2026-08-18 に同意バーで同じ結論に至っている — `use-bottom-stack-slot.ts`)。
 *
 * 下端に積む面どうしの重なりは「高さで避ける」で解けたが、**流れてくる本文との
 * 重なりは高さでは避けられない**。SP の一覧は 2 列で画面幅いっぱいに敷き詰める
 * ので、右下 48px を空けられる場所が**そもそも存在しない** (2026-08-27 実測:
 * カード画像は x=203..374、ランチャは x=326..374 で必ず内側に入る)。
 *
 * ## 2026-08-27 の是正 — 「手が止まったら戻る」をやめた
 *
 * 初版は「手が止まったら戻る」を持っていた。その結果 **静止状態では必ず本文の
 * 上に居る**ことになり、通しテスト E-1 は本番 SP390 /ja/products の 5 地点中
 * 3 地点 (scrollY 504 / 756 / 1009) で「48px のボタンが商品カード画像に完全に
 * 重なる」(重なり 1,619 / 2,166 / 2,304 px^2) と実測した。**時間で避けるなら、
 * 止まったときこそ引っ込んでいなければ意味が無い**。
 *
 * 代案は 2 つとも採れなかった。位置をずらす案は上記のとおり空き場所が無い。
 * 「常時縮小・半透明化」案はタップ標的の下限 44px を割れず (48→44 では重なりが
 * 16% しか減らない)、半透明化はボタン内のコントラストを落として別の基準に触れる。
 * よって **静止時は退いたままにし、出す条件を明示する** 設計に寄せた。
 * 呼び出す手段は残っている — 上へ少しでも動かせば即座に出る (下記の約束 2)。
 *
 * ## 約束 (`retreatOnScroll` / `retreatOnSettle` が正本 / テストはこの 2 つを縛る)
 *
 *   - 下へ **一定量** 動いたときだけ引っ込む (指の震え程度では消えない)
 *   - 上へ動いたら即座に戻る (探した瞬間に無い、が起きない = 呼び出す手段)
 *   - 画面最上部では常に出す (下端に何も流れてこないので隠す理由が無い)
 *   - **手が止まっても戻らない** (最上部に居るときを除く)
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

/**
 * 手が止まったと見なすまでの間。惰性スクロールが終わってから判定を 1 回だけ
 * 走らせるための待ち。
 */
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
 * 手が止まったときの判断。**引っ込んでいるものは引っ込んだまま**にする。
 *
 * 2026-08-27 以前はここで無条件に戻していた。それが E-1 の実害 (静止時に必ず
 * 本文の上に居る) そのものだったので、戻す条件を「画面最上部に居るとき」だけに
 * 絞った。最上部は `retreatOnScroll` と同じ理由 — 下端に本文が流れてこない。
 *
 * 純関数として切り出してあるのは、この 1 行が**戻ってしまう実装への差し戻しを
 * 検知できる唯一の場所**だから (hook 内の setTimeout は node 環境の単体テストで
 * 縛れない)。`__tests__/chat-launcher-retreat.test.ts` がここを縛る。
 */
export function retreatOnSettle(state: RetreatState, y: number): RetreatState {
  if (y <= 0) return { visible: true, anchorY: 0, lastY: 0 };
  return { ...state, anchorY: y, lastY: y };
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

      /* 手が止まったときの判断。中身は `retreatOnSettle` が正本で、ここが持つのは
         「いつ判定するか」= 時間だけ。 */
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        state = retreatOnSettle(state, window.scrollY);
        setVisible(state.visible);
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

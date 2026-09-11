"use client";

import * as React from "react";

/**
 * 画面下端に積み重なる固定 UI が「自分がいま占めている高さ」を公開する。
 *
 * ## なぜ z ではなく高さで解くのか (2026-08-18 是正)
 *
 * 下端には最大 4 つの面が同居する — 音声バー / Cookie 同意 / イベント申込バー /
 * チャットランチャ。これを **z の前後で解こうとすると必ずどちらかが覆われる**。
 * 実際に 2026-08-18 の QA で、ランチャ (`--z-chat` 1030) を Cookie 同意
 * (`--z-sticky` 1020) より前に出した結果、同意バーの「詳しく見る」が SP で
 * 押せなくなる回帰を出した (重なり 2304px^2 / `elementFromPoint` がランチャを
 * 返す)。z を入れ替えても今度はランチャが覆われるだけで、勝てる並びが存在しない。
 *
 * 解は **重ねないこと** = それぞれが下の面の高さぶん自分の `bottom` を上げること。
 * 音声バーが `--audio-bar-h` で既にやっていたことを、下端の全要素へ一般化する。
 *
 * ## 積み順 (下から)
 *
 *   1. 音声バー         `--audio-bar-h`   (components/audio/audio-dock.tsx)
 *   2. Cookie 同意       `--consent-bar-h` (components/layout/cookie-consent.tsx)
 *   3. イベント申込バー   `--event-bar-h`   (components/events/event-register-button.tsx)
 *   4. チャットランチャ   (公開しない — 一番上なので誰も参照しない)
 *
 * 各面の `bottom` は「自分より下にある面の変数の和」。順番を変えたいときは
 * この表と `bottom` の式だけを直す (z は触らない)。
 *
 * ## 測って公開する理由
 *
 * 高さを定数で持てるのは音声バーだけ (`BAR_HEIGHT_PX` が SoT)。Cookie 同意は
 * 文章量とビューポート幅で 1 行 / 2 行に変わり、イベント申込バーもボタンの
 * 文字数で変わる。定数を置くと必ず実寸とずれるので実 DOM を測る。
 *
 * `display: none` の要素の `offsetHeight` は 0 なので、`md:hidden` で消えている
 * ブレークポイントでは自動的に 0px になる (メディアクエリを JS 側に複製しない)。
 *
 * @param ref 測る対象の要素
 * @param cssVar 公開する変数名 (例: `--consent-bar-h`)
 * @param active false の間は 0px を公開する (面が出ていないとき)
 */
export function useBottomStackSlot(
  ref: React.RefObject<HTMLElement | null>,
  cssVar: `--${string}`,
  active = true,
): void {
  React.useEffect(() => {
    const root = document.documentElement;
    const reset = () => root.style.setProperty(cssVar, "0px");

    if (!active) {
      reset();
      return reset;
    }

    const element = ref.current;
    if (!element) {
      reset();
      return reset;
    }

    const publish = () => {
      // 上に載る面が知りたいのは「下の面がレイアウト上で占めている高さ」なので、
      // 変形 (退避アニメーション等) を含む getBoundingClientRect ではなく
      // offsetHeight を使う。
      root.style.setProperty(cssVar, `${element.offsetHeight}px`);
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      reset();
    };
  }, [ref, cssVar, active]);
}

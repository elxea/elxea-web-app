"use client";

import { useState } from "react";

import { seedFavoriteKeys } from "@/lib/favorites/client-store";

/**
 * サーバが既に知っているお気に入り一覧を、ブラウザ側の倉庫の初期値として渡す。
 *
 * マイページは元々「人ごとに毎回作る」描画なので、**サーバの手元に一覧がある**。
 * それをそのまま渡せば、この画面の保存トグルは往復ゼロで、1 枚目の描画から
 * 状態が確定する (Setaka 実機指摘 2026-08-25「SSR / 初期データで状態を確定して描画」)。
 *
 * ## なぜ effect ではなく描画中に渡すのか
 *
 * `useEffect` は 1 枚目を描き終えた**後**に走る。そこで初期値を入れると、
 * 1 枚目だけ「まだ分からない」状態で描かれ、直後に差し替わる = ちらつく。
 * `useState` の初期化関数は最初の描画の中で 1 度だけ走るので、ちらつきが出ない。
 *
 * ## サーバでは絶対に走らせない
 *
 * 倉庫はモジュール変数なので、サーバ側で書き込むと **同じプロセスの他のお客さまに
 * 混ざる**。ブラウザでしか動かないことを条件で保証する (`typeof window`)。
 */
export function FavoritesSeed({ keys }: { keys: string[] }) {
  useState(() => {
    if (typeof window !== "undefined") seedFavoriteKeys(keys);
    return null;
  });

  return null;
}

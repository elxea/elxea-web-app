/**
 * 産地を指す印。採用案 R1-A「点と輪」の DOM Marker 実装。
 *
 * 正本: https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8221-25
 *
 * ## なぜ逆さ雫のピンではないのか
 *
 * 一般的な地図ピンは「先端が座標・重心が上」なので、点の位置と視覚的重心がずれる。
 * この地図の用途は産地を **指す** ことなので、重心がそのまま座標に乗る円を採る。
 * 水面に落ちた一滴 — 点が場所そのもので、輪はその周りの気配。
 *
 * ## 通常状態に輪を出さない
 *
 * 生産者一覧 (11 点) では最小 7.6px まで点が接近する。通常から輪を出すと
 * その距離で 2 点が 1 つに潰れる。輪はホバー・選択のときだけ開く。
 * 品目ページは 1 点だけなので、ここでは通常状態しか使わない
 * (ホバー・選択・複数軒の状態は生産者一覧を作るときに足す)。
 *
 * ## cream の縁がある理由
 *
 * 陸 (sand) の上で graphite の点が沈まないようにするための縁。
 * `box-shadow` で描くのは、要素の箱の大きさを変えずに外側へ広げるため
 * (border だと ø5 の点を作るのに要素を 8px にする必要があり、Marker の
 * anchor 計算に縁の太さが混ざる)。
 */

import { mapColor } from "@/lib/viz/map-style";

/** 実点の直径 (px)。BP に依存しない — DOM Marker は CSS px 固定。 */
export const PIN_DOT_SIZE = 5;
/** 縁の太さ (px)。 */
export const PIN_RIM_WIDTH = 1.5;

/**
 * 産地ピンの DOM 要素を作る。
 *
 * MapLibre の symbol レイヤーではなく DOM Marker を使うのは、意匠 (縁・輪・状態)
 * を CSS で持てる方が、スプライト画像を焼き直すより変更に強いため。
 */
export function createOriginPinElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${PIN_DOT_SIZE}px`;
  el.style.height = `${PIN_DOT_SIZE}px`;
  el.style.borderRadius = "9999px";
  el.style.backgroundColor = mapColor("graphite");
  el.style.boxShadow = `0 0 0 ${PIN_RIM_WIDTH}px ${mapColor("cream")}`;
  // 静止画として扱う地図なので、ピン自体もポインタを取らない。
  el.style.pointerEvents = "none";
  el.setAttribute("data-slot", "origin-pin");
  return el;
}

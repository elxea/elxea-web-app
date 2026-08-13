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
 * ## 大きさは 1 つに決まらない (2026-08-14)
 *
 * 当初は `PIN_DOT_SIZE` という単一定数だったが、**同じ大きさでは両画面が成立しない**。
 *
 * - 品目ページ … 400x210 の面に点 1 つ。ø5 では紙の汚れにしか見えず、
 *   「ここです」と指す強さが出ない。ø7 (外径 10px) に上げる。
 * - 生産者一覧 … 同じ面に 11 点。最短で 7.6px しか離れないので、外径を
 *   10px にすると隣の点と重なって 2 軒が 1 軒に見える。**ø5 のまま据え置く**。
 *
 * 点の大きさは意匠ではなく「その画面で点が何個あるか」で決まる量なので、
 * 定数を 1 つに畳まず用途ごとに引けるようにしてある。新しい画面を足すときは
 * 既存の値を流用する前に、その画面での最短点間距離を測ってから選ぶこと。
 *
 * 色は両方とも graphite。tea-red は選択状態だけに使う (常時 tea-red にすると
 * 「選ばれている」の合図が地図から消える)。
 *
 * ## cream の縁がある理由
 *
 * 陸 (sand) の上で graphite の点が沈まないようにするための縁。
 * `box-shadow` で描くのは、要素の箱の大きさを変えずに外側へ広げるため
 * (border だと ø5 の点を作るのに要素を 8px にする必要があり、Marker の
 * anchor 計算に縁の太さが混ざる)。縁の太さは大きさを変えても 1.5px 固定 —
 * 縁は「紙から浮かせる」ための一定の隙間であって、点に比例する装飾ではない。
 */

import { mapColor } from "@/lib/viz/map-style";

/**
 * 実点の直径 (px)。BP に依存しない — DOM Marker は CSS px 固定。
 *
 * キーは意匠の名前ではなく **使う画面** にしてある。値を選ぶ根拠がその画面の
 * 点の数と最短距離にあるので、名前を見て根拠に辿り着けるようにするため。
 */
export const PIN_DOT_SIZE = {
  /** 品目ページの小地図。点は 1 つだけなので指す強さを優先する (外径 10px)。 */
  item: 7,
  /** 生産者一覧。11 点が最短 7.6px まで接近するので上げられない (外径 8px)。 */
  producerList: 5,
} as const;

/** ピンを使う画面。 */
export type OriginPinScale = keyof typeof PIN_DOT_SIZE;

/** 縁の太さ (px)。点の大きさに関わらず一定。 */
export const PIN_RIM_WIDTH = 1.5;

/** 縁まで含めた外径 (px)。点どうしの間隔を検討するときはこちらを使う。 */
export function pinOuterSize(scale: OriginPinScale): number {
  return PIN_DOT_SIZE[scale] + PIN_RIM_WIDTH * 2;
}

/**
 * 産地ピンの DOM 要素を作る。
 *
 * MapLibre の symbol レイヤーではなく DOM Marker を使うのは、意匠 (縁・輪・状態)
 * を CSS で持てる方が、スプライト画像を焼き直すより変更に強いため。
 *
 * `scale` に既定値を置かないのは、呼び出し側に「どの画面か」を必ず宣言させるため。
 * 既定があると新しい画面が黙って片方の値を継いで、点が潰れるまで気づけない。
 */
export function createOriginPinElement(scale: OriginPinScale): HTMLElement {
  const size = PIN_DOT_SIZE[scale];
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.backgroundColor = mapColor("graphite");
  el.style.boxShadow = `0 0 0 ${PIN_RIM_WIDTH}px ${mapColor("cream")}`;
  // 静止画として扱う地図なので、ピン自体もポインタを取らない。
  el.style.pointerEvents = "none";
  el.setAttribute("data-slot", "origin-pin");
  el.setAttribute("data-pin-scale", scale);
  return el;
}

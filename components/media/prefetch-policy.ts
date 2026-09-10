/**
 * 「押される前に取っておいてよいか」の判断。**1 箇所に置く**。
 *
 * 先読み (prefetch) は速さと通信量の取引で、取引の条件は画面ごとに違わない。
 * 写真 (`components/product/image-gallery.tsx`) が持っていた判断を、音源
 * (`components/audio/track-row.tsx`) でも同じ条件で使うためにここへ出した。
 * 条件が変わったとき (例: `connection.effectiveType` も見る) に直す場所を
 * 増やさないための移動で、判断そのものは写真側にあったものと同じ。
 */

/**
 * 客が通信量を惜しむ設定にしているか (データセーバー)。
 *
 * 押されるか分からないものを先に取るのは、その設定への裏切りになる。対応して
 * いないブラウザでは分からないので `false` (= 先読みする) に倒す。
 */
export function savesData(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true;
}

/**
 * いま先読みしてよいか。
 *
 * サーバ (navigator が無い) では常に `false` — 先読みはブラウザが手を空けて
 * から始める話であって、初回描画の HTML に混ぜるものではない。
 */
export function mayPrefetchMedia(): boolean {
  if (typeof navigator === "undefined") return false;
  return !savesData();
}

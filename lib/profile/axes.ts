/**
 * 嗜好空間 (お茶の味わい面) の軸の写像 (判断点 D3)。
 *
 * Setaka 未回答のため、実装では「差し替え可能な設定」にし推奨値を既定にする。
 * 写像を変えたくなったら、このファイルの `TEA_AXIS_MAPPING` を変えるだけでよい
 * (呼び出し側は `mapTeaAxes` の入出力だけを見ており、写像の中身を知らない)。
 *
 * - 写像A (そのまま): 横 = 香りの強さ / 縦 = 味の太さ
 * - 写像B (45度回転・既定): 横 = 香り − 味 / 縦 = 香り + 味
 *   要件の軸語 (フレッシュ⇄リッチ) と一致するが、整数格子を45度回転させる
 *   ため構造的に市松格子になる (半分のマス目には点が乗らない)。等高線・格子の
 *   実装はこれを前提にする。
 *
 * 正本: Spec §「銘柄座標は『無いものを作らない』」(24件実測・検算済み)。
 */

export type TeaAxisMapping = "A" | "B";

/** 既定は写像B (Setaka 確定の軸語と一致・24件で検算済み)。 */
export const TEA_AXIS_MAPPING: TeaAxisMapping = "B";

export interface AxisPoint {
  x: number;
  y: number;
}

/**
 * 味わい (1〜5) ・香り (1〜5) の整数から嗜好空間の座標へ写す。
 *
 * `flavor` / `aroma` は Notion Tea Menu List の実測値そのまま (情報を増やさない)。
 */
export function mapTeaAxes(
  flavor: number,
  aroma: number,
  mapping: TeaAxisMapping = TEA_AXIS_MAPPING,
): AxisPoint {
  if (mapping === "A") {
    return { x: aroma, y: flavor };
  }
  return { x: aroma - flavor, y: aroma + flavor };
}

/**
 * 「味の四象限」のデータ層。
 *
 * ## いまはダミー、あとで Tea Menu List に差し替える
 *
 * 官能評価 (甘み⇄渋み / 軽やか⇄濃厚 / 余韻 / 製法系統) は Notion の
 * Tea Menu List 218 件がいずれ正本になる。ただし現時点でその列は存在しないので、
 * **この層だけがダミーを持ち、描画側は一切データを知らない**構造にしてある。
 * 実データが来たら `flavorMatrixFor` の中身を差し替えるだけでよく、
 * `components/viz/flavor/*` には手を入れない。
 *
 * 差し替え時に守る契約:
 * - `x` / `y` は -1..+1。0 が中央 (どちらでもない)
 * - `weight` は 0.7..1.2。マーカーの大きさ = 余韻の長さ
 * - `process` は 4 系統のいずれか。色はこの系統だけが決める
 * - 数値は画面に出さない (roji 原則)。`note` の言葉が数値の代わりに立つ
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド (20-flavor-matrix / 03-gooey)。
 */

import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

/** 製法系統。色はこれだけで決まる (品種でも産地でもない)。 */
export type TeaProcess = "mushi" | "kama" | "hoiro" | "hakko";

export const TEA_PROCESS_COLOR: Record<TeaProcess, string> = {
  /** 蒸し製 */
  mushi: ROJI_VIZ_COLOR.koke,
  /** 釜炒り */
  kama: ROJI_VIZ_COLOR.usukoke,
  /** 焙煎 */
  hoiro: ROJI_VIZ_COLOR.hoji,
  /** 発酵 */
  hakko: ROJI_VIZ_COLOR.hojiFuka,
};

export const TEA_PROCESS_LABEL: Record<TeaProcess, string> = {
  mushi: "蒸 し 製",
  kama: "釜 炒 り",
  hoiro: "焙 煎",
  hakko: "発 酵",
};

export const TEA_PROCESS_ORDER: readonly TeaProcess[] = [
  "mushi",
  "kama",
  "hoiro",
  "hakko",
];

export interface FlavorPoint {
  /** 一意な鍵。実データでは銘柄番号になる。 */
  id: string;
  /** 図に出す名前。 */
  label: string;
  /** -1 = 甘み ←→ +1 = 渋み */
  x: number;
  /** +1 = 軽やか ←→ -1 = 濃厚 */
  y: number;
  /** 余韻の長さ (0.7..1.2)。マーカーの大きさ。 */
  weight: number;
  process: TeaProcess;
  /** 数値の代わりに置く一言。 */
  note: string;
}

/** 四象限の軸ラベル。字間は描画側が持たず、ここで空白入りの表記にする。 */
export const FLAVOR_AXIS = {
  left: "甘 み",
  right: "渋 み",
  top: "軽 や か",
  bottom: "濃 厚",
  quadrant: { tl: "澄", tr: "涼", bl: "甘 露", br: "滋 味" },
} as const;

/** ダミーの銘柄 10 種。実データ接続時にここが消える。 */
const SAMPLE_POINTS: readonly FlavorPoint[] = [
  { id: "tsuyuhikari", label: "つゆひかり", x: -0.44, y: 0.46, weight: 0.9, process: "mushi", note: "蜜のような甘み" },
  { id: "saemidori", label: "さえみどり", x: -0.72, y: 0.24, weight: 1.0, process: "mushi", note: "旨味の芯" },
  { id: "shiraore", label: "白折 茎茶", x: -0.8, y: 0.74, weight: 0.74, process: "mushi", note: "軽く澄んだ甘み" },
  { id: "genmaicha", label: "玄米茶", x: -0.16, y: 0.74, weight: 0.8, process: "hoiro", note: "香ばしさと軽さ" },
  { id: "gyokuro", label: "玉露 かぶせ", x: -0.74, y: -0.46, weight: 1.16, process: "mushi", note: "濃密な甘露" },
  { id: "hojicha", label: "ほうじ茶 強火", x: -0.08, y: -0.34, weight: 1.06, process: "hoiro", note: "深い焙煎の丸み" },
  { id: "zairai-kamairi", label: "在来 釜炒り", x: 0.24, y: 0.34, weight: 0.86, process: "kama", note: "素朴な渋み" },
  { id: "asamushi-yama", label: "浅蒸し 山", x: 0.58, y: 0.54, weight: 0.9, process: "kama", note: "涼やかな渋み" },
  { id: "fukamushi-yabukita", label: "深蒸し やぶきた", x: 0.48, y: -0.62, weight: 1.2, process: "mushi", note: "濃厚な渋みとコク" },
  { id: "wakoucha", label: "和紅茶 やまなみ", x: 0.76, y: -0.24, weight: 1.02, process: "hakko", note: "渋みに甘い余韻" },
];

export interface FlavorMatrixData {
  points: readonly FlavorPoint[];
  /**
   * 「いま見ている銘柄」。図の中でこの 1 つだけ濃く出す。
   * 引き当てられないときは null (全体図として描く)。
   */
  highlightId: string | null;
}

/**
 * 銘柄番号から四象限のデータを引く。
 *
 * 実データが無い今は **銘柄番号を種にして 10 種のどれかを「この茶」に割り当てる**。
 * 番号が同じなら毎回同じ茶が選ばれるので、ページを開き直しても図は動かない。
 * 番号が無い (一覧・プレビュー) ときは強調なしの全体図になる。
 */
export function flavorMatrixFor(
  menuNumber: string | number | null | undefined
): FlavorMatrixData {
  const points = SAMPLE_POINTS;
  if (menuNumber === null || menuNumber === undefined) {
    return { points, highlightId: null };
  }
  const key = String(menuNumber);
  let acc = 0;
  for (let i = 0; i < key.length; i++) acc = (acc * 31 + key.charCodeAt(i)) >>> 0;
  return { points, highlightId: points[acc % points.length].id };
}

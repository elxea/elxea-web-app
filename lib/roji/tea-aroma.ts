/**
 * 「香りの場」のデータ層。
 *
 * ## 味の四象限と何が違うのか
 *
 * 味は **点** で置ける (甘い・渋いは一つの茶に一つの値)。香りはそうならない —
 * 一つの茶から青葉も花も火も立つし、湯温と時間で強さの順が入れ替わる。だから
 * 香りは点ではなく **領域** として描く (`components/viz/aroma/aroma-field.tsx`)。
 * ここが持つのは「香りの一つ一つが場のどこに立つか」だけで、領域そのものは
 * 描画側がガウス分布の足し合わせから起こす。
 *
 * ## いまはダミー、あとで Tea Menu List に差し替える
 *
 * 香りの記述は Notion の Tea Menu List 218 件がいずれ正本になる。`tea-flavor.ts`
 * と同じく **この層だけがダミーを持つ**。実データが来たら `aromaFieldFor` の
 * 中身を差し替えるだけで、描画側には手を入れない。
 *
 * 差し替え時に守る契約:
 * - `x` / `y` は -1..+1。x = 涼やか⇄あたたか、y = 立ちのぼる⇄底に残る
 * - `weight` は 0.7..1.2。場の濃さへの寄与
 * - `family` は 4 つの香りの系統。色はこれだけが決める
 * - 数値は画面に出さない (roji 原則)
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド (20-flavor-matrix / 06-field)。
 * 軸だけを香り用に差し替えた新規の 1 枚。
 */

import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

/** 香りの系統。色はこれだけで決まる。 */
export type AromaFamily = "wakaba" | "hana" | "kinomi" | "hi";

export const AROMA_FAMILY_COLOR: Record<AromaFamily, string> = {
  /** 若葉 — 摘みたての青い香り */
  wakaba: ROJI_VIZ_COLOR.koke,
  /** 花 — 咲きかけの甘い香り */
  hana: ROJI_VIZ_COLOR.usukoke,
  /** 木の実 — 乾いた実と穀の香り */
  kinomi: ROJI_VIZ_COLOR.hoji,
  /** 火 — 焙りと燻しの香り */
  hi: ROJI_VIZ_COLOR.hojiFuka,
};

export const AROMA_FAMILY_LABEL: Record<AromaFamily, string> = {
  wakaba: "若 葉",
  hana: "花",
  kinomi: "木 の 実",
  hi: "火",
};

export const AROMA_FAMILY_ORDER: readonly AromaFamily[] = [
  "wakaba",
  "hana",
  "kinomi",
  "hi",
];

export interface AromaNote {
  id: string;
  /** 図に出す名前。 */
  label: string;
  /** -1 = 涼やか ←→ +1 = あたたか */
  x: number;
  /** +1 = 立ちのぼる ←→ -1 = 底に残る */
  y: number;
  /** 場への寄与 (0.7..1.2)。 */
  weight: number;
  family: AromaFamily;
}

/** 香りの場の軸ラベル。 */
export const AROMA_AXIS = {
  left: "涼 や か",
  right: "あ た た か",
  top: "立 ち の ぼ る",
  bottom: "底 に 残 る",
  quadrant: { tl: "青", tr: "陽", bl: "露", br: "燻" },
} as const;

/** ダミーの香り 12。実データ接続時にここが消える。 */
const SAMPLE_NOTES: readonly AromaNote[] = [
  { id: "wakakusa", label: "若 草", x: -0.78, y: 0.72, weight: 0.92, family: "wakaba" },
  { id: "kaze-no-ha", label: "風 の 葉", x: -0.56, y: 0.44, weight: 0.86, family: "wakaba" },
  { id: "asatsuyu", label: "朝 露", x: -0.66, y: -0.22, weight: 1.04, family: "wakaba" },
  { id: "kaiko", label: "貝 割", x: -0.34, y: -0.58, weight: 0.8, family: "wakaba" },
  { id: "kuchinashi", label: "梔 子", x: -0.2, y: 0.66, weight: 0.9, family: "hana" },
  { id: "sakurayu", label: "桜 湯", x: 0.06, y: 0.34, weight: 1.0, family: "hana" },
  { id: "mitsu", label: "蜜", x: 0.14, y: -0.36, weight: 1.1, family: "hana" },
  { id: "kuri", label: "栗", x: 0.44, y: 0.26, weight: 0.94, family: "kinomi" },
  { id: "genmai", label: "玄 米", x: 0.34, y: 0.68, weight: 0.86, family: "kinomi" },
  { id: "kurumi", label: "胡 桃", x: 0.62, y: -0.14, weight: 1.02, family: "kinomi" },
  { id: "hi-no-ka", label: "火 の 香", x: 0.82, y: 0.42, weight: 1.06, family: "hi" },
  { id: "kemuri", label: "遠 い 煙", x: 0.7, y: -0.66, weight: 1.18, family: "hi" },
];

export interface AromaFieldData {
  notes: readonly AromaNote[];
  /** 「いま見ている銘柄」でとくに立つ香り。引き当てられないときは null。 */
  highlightId: string | null;
}

/**
 * 銘柄番号から香りの場のデータを引く。
 *
 * 実データが無い今は銘柄番号を種にして 12 のどれかを選ぶ。番号が同じなら毎回
 * 同じ香りが立つので、開き直しても図は動かない。
 */
export function aromaFieldFor(
  menuNumber: string | number | null | undefined
): AromaFieldData {
  const notes = SAMPLE_NOTES;
  if (menuNumber === null || menuNumber === undefined) {
    return { notes, highlightId: null };
  }
  const key = String(menuNumber);
  let acc = 7;
  for (let i = 0; i < key.length; i++) acc = (acc * 131 + key.charCodeAt(i)) >>> 0;
  return { notes, highlightId: notes[acc % notes.length].id };
}

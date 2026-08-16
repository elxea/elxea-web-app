/**
 * 「香りの場」のデータ層。
 *
 * ## 恒久ルール: 比較対象は同じカテゴリーだけ
 *
 * 味の四象限と同じく、この図に載るのは **いま見ているお茶と同じカテゴリー**の
 * 香りだけ。緑茶の頁に紅茶の香りは出さない。図の色はお茶のカテゴリーを表すので、
 * **1 枚の場は必ず単色**になる (系統ごとに色を変えない)。
 * 全文と出典は `docs/roji-dataviz-rules.md` (Setaka 指摘 4 回・2026-08-17 確定)。
 *
 * 系統 (`family`) は **色ではなく場の作り方**を分ける鍵として残す。系統ごとに
 * ガウス分布を足して等高線を起こすので、系統が違えば島が分かれる。色を変えずに
 * 分かれるので、単色でも「香りの通じ合い」は読める。
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
 * と同じく **この層だけがダミーを持つ**。実データが来たら
 * `SAMPLE_NOTES_BY_CATEGORY` を差し替えるだけで、描画側には手を入れない。
 *
 * 差し替え時に守る契約:
 * - `x` / `y` は -1..+1。x = 涼やか⇄あたたか、y = 立ちのぼる⇄底に残る
 * - `weight` は 0.7..1.2。場の濃さへの寄与
 * - 1 つの束に入るのは **同一カテゴリーの香りだけ** (混ざったらテストが落ちる)
 * - 数値は画面に出さない (roji 原則)
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド (20-flavor-matrix / 06-field)。
 * 軸だけを香り用に差し替えた新規の 1 枚。
 */

import { teaCategoryOf, type TeaCategory } from "@/lib/roji/tea-category";

/**
 * 香りの系統。**色は決めない** — 場の島の分かれ方だけを決める。
 * (色はカテゴリーが決める。`lib/roji/tea-category.ts`)
 */
export type AromaFamily = "wakaba" | "hana" | "kinomi" | "hi";

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
  /** 場の島を分けるための系統。色には使わない。 */
  family: AromaFamily;
  /** カテゴリー。同じカテゴリーの香りだけが 1 枚の場に載る。 */
  category: TeaCategory;
}

/** 香りの場の軸ラベル。 */
export const AROMA_AXIS = {
  left: "涼 や か",
  right: "あ た た か",
  top: "立 ち の ぼ る",
  bottom: "底 に 残 る",
  quadrant: { tl: "青", tr: "陽", bl: "露", br: "燻" },
} as const;

/**
 * ダミーの香り。実データ接続時にここが消える。
 *
 * 味の四象限と同じく **カテゴリーごとに束ねる**。混ざる余地を構造で消すため。
 */
const SAMPLE_NOTES_BY_CATEGORY: Record<TeaCategory, readonly AromaNote[]> = {
  green: [
    { id: "g-wakakusa", label: "若 草", x: -0.78, y: 0.72, weight: 0.92, family: "wakaba", category: "green" },
    { id: "g-kazenoha", label: "風 の 葉", x: -0.56, y: 0.44, weight: 0.86, family: "wakaba", category: "green" },
    { id: "g-asatsuyu", label: "朝 露", x: -0.66, y: -0.22, weight: 1.04, family: "wakaba", category: "green" },
    { id: "g-kaiware", label: "貝 割", x: -0.34, y: -0.58, weight: 0.8, family: "wakaba", category: "green" },
    { id: "g-kuchinashi", label: "梔 子", x: -0.2, y: 0.66, weight: 0.9, family: "hana", category: "green" },
    { id: "g-sakurayu", label: "桜 湯", x: 0.06, y: 0.34, weight: 1.0, family: "hana", category: "green" },
    { id: "g-mitsu", label: "蜜", x: 0.14, y: -0.36, weight: 1.1, family: "hana", category: "green" },
    { id: "g-kuri", label: "栗", x: 0.44, y: 0.26, weight: 0.94, family: "kinomi", category: "green" },
    { id: "g-genmai", label: "玄 米", x: 0.34, y: 0.68, weight: 0.86, family: "kinomi", category: "green" },
    { id: "g-kurumi", label: "胡 桃", x: 0.62, y: -0.14, weight: 1.02, family: "kinomi", category: "green" },
    { id: "g-hinoka", label: "火 の 香", x: 0.82, y: 0.42, weight: 1.06, family: "hi", category: "green" },
    { id: "g-kemuri", label: "遠 い 煙", x: 0.7, y: -0.66, weight: 1.18, family: "hi", category: "green" },
  ],
  white: [
    { id: "w-ubuge", label: "産 毛", x: -0.62, y: 0.7, weight: 0.88, family: "wakaba", category: "white" },
    { id: "w-hoshigusa", label: "干 し 草", x: -0.28, y: 0.28, weight: 0.94, family: "wakaba", category: "white" },
    { id: "w-hakumokuren", label: "白 木 蓮", x: -0.06, y: 0.6, weight: 0.9, family: "hana", category: "white" },
    { id: "w-hachimitsu", label: "蜂 蜜", x: 0.24, y: -0.2, weight: 1.06, family: "hana", category: "white" },
    { id: "w-hoshigaki", label: "干 し 柿", x: 0.46, y: -0.54, weight: 1.02, family: "kinomi", category: "white" },
    { id: "w-suhada", label: "杉 の 肌", x: 0.58, y: 0.2, weight: 0.84, family: "hi", category: "white" },
  ],
  yellow: [
    { id: "y-mushiba", label: "蒸 し 葉", x: -0.5, y: 0.52, weight: 0.9, family: "wakaba", category: "yellow" },
    { id: "y-kuchinashi", label: "梔 子 の 実", x: -0.14, y: 0.24, weight: 0.96, family: "hana", category: "yellow" },
    { id: "y-awa", label: "粟 の 粥", x: 0.3, y: -0.18, weight: 1.04, family: "kinomi", category: "yellow" },
    { id: "y-warabai", label: "藁 灰", x: 0.6, y: -0.58, weight: 0.98, family: "hi", category: "yellow" },
    { id: "y-kigi", label: "若 木", x: -0.36, y: -0.34, weight: 0.86, family: "wakaba", category: "yellow" },
  ],
  blue: [
    { id: "b-ranka", label: "蘭 の 花", x: -0.44, y: 0.74, weight: 0.98, family: "hana", category: "blue" },
    { id: "b-kinmokusei", label: "金 木 犀", x: -0.1, y: 0.5, weight: 1.06, family: "hana", category: "blue" },
    { id: "b-jukushi", label: "熟 し 桃", x: 0.28, y: 0.1, weight: 1.12, family: "hana", category: "blue" },
    { id: "b-nyuko", label: "乳 の 含 み", x: 0.04, y: -0.44, weight: 1.0, family: "kinomi", category: "blue" },
    { id: "b-aoba", label: "青 い 葉", x: -0.72, y: 0.3, weight: 0.84, family: "wakaba", category: "blue" },
    { id: "b-baisen", label: "焙 り の 火", x: 0.72, y: -0.3, weight: 1.1, family: "hi", category: "blue" },
    { id: "b-tanbi", label: "炭 火", x: 0.84, y: 0.36, weight: 0.94, family: "hi", category: "blue" },
  ],
  black: [
    { id: "k-bara", label: "薔 薇", x: -0.28, y: 0.72, weight: 0.96, family: "hana", category: "black" },
    { id: "k-mitsuringo", label: "蜜 林 檎", x: 0.06, y: 0.42, weight: 1.08, family: "hana", category: "black" },
    { id: "k-hoshibudo", label: "干 し 葡 萄", x: 0.38, y: -0.12, weight: 1.14, family: "kinomi", category: "black" },
    { id: "k-kokuto", label: "黒 糖", x: 0.2, y: -0.56, weight: 1.1, family: "kinomi", category: "black" },
    { id: "k-wakaba", label: "若 葉 の 名 残", x: -0.68, y: 0.36, weight: 0.8, family: "wakaba", category: "black" },
    { id: "k-shiro", label: "白 檀", x: 0.66, y: 0.5, weight: 0.9, family: "hi", category: "black" },
    { id: "k-shioke", label: "潮 の 気", x: -0.5, y: -0.42, weight: 0.88, family: "wakaba", category: "black" },
  ],
  dark: [
    { id: "d-shitsuchi", label: "湿 っ た 土", x: 0.34, y: -0.68, weight: 1.18, family: "kinomi", category: "dark" },
    { id: "d-kareki", label: "枯 木", x: 0.58, y: -0.2, weight: 1.04, family: "kinomi", category: "dark" },
    { id: "d-kinka", label: "菌 花", x: 0.02, y: -0.3, weight: 0.96, family: "hana", category: "dark" },
    { id: "d-kanzo", label: "甘 草", x: -0.22, y: 0.18, weight: 0.9, family: "hana", category: "dark" },
    { id: "d-koke", label: "苔 む す 石", x: -0.54, y: -0.5, weight: 0.86, family: "wakaba", category: "dark" },
    { id: "d-ibushi", label: "燻 し", x: 0.76, y: 0.3, weight: 1.02, family: "hi", category: "dark" },
  ],
};

export interface AromaFieldData {
  /** この場が扱うカテゴリー。色はこれだけが決める。 */
  category: TeaCategory;
  /** 同一カテゴリーの香りのみ。他カテゴリーは 1 件も入らない。 */
  notes: readonly AromaNote[];
  /** 「いま見ている銘柄」でとくに立つ香り。引き当てられないときは null。 */
  highlightId: string | null;
}

/**
 * 銘柄番号とカテゴリーから香りの場のデータを引く。
 *
 * カテゴリーの決め方・絞り込みの契約は `flavorMatrixFor` と同じ。
 * 実データが無い今は銘柄番号を種にしてそのカテゴリーの中から 1 つ選ぶ。
 * 番号が同じなら毎回同じ香りが立つので、開き直しても図は動かない。
 */
export function aromaFieldFor(
  menuNumber: string | number | null | undefined,
  rawCategory?: string | null
): AromaFieldData {
  const category = teaCategoryOf(menuNumber, rawCategory);
  const notes = SAMPLE_NOTES_BY_CATEGORY[category];

  if (menuNumber === null || menuNumber === undefined) {
    return { category, notes, highlightId: null };
  }
  const key = String(menuNumber);
  let acc = 7;
  for (let i = 0; i < key.length; i++) acc = (acc * 131 + key.charCodeAt(i)) >>> 0;
  return { category, notes, highlightId: notes[acc % notes.length].id };
}

/** カテゴリーごとの束をそのまま返す (テスト・棚卸し用。描画側からは使わない)。 */
export function aromaSamplesByCategory(): Record<TeaCategory, readonly AromaNote[]> {
  return SAMPLE_NOTES_BY_CATEGORY;
}

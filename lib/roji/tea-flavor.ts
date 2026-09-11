/**
 * 「味の四象限」のデータ層。
 *
 * ## 恒久ルール: 比較対象は同じカテゴリーだけ
 *
 * この図に載るのは **いま見ているお茶と同じカテゴリーの銘柄だけ**。緑茶を見て
 * いる人には他の緑茶しか出さず、紅茶なら他の紅茶しか出さない。図の色はお茶の
 * カテゴリーを表すので、**1 枚に載る点は必ず全て同色**になる。
 * 全文と出典は `docs/roji-dataviz-rules.md` (Setaka 指摘 4 回・2026-08-17 確定)。
 * カテゴリーの判定と色は `lib/roji/tea-category.ts` が唯一の入口。
 *
 * 絞り込みは **データ層で行い、描画側には全件を渡さない**。描画側で薄く出す
 * だけの実装にすると「載っているが見えにくい」状態になり、ルール違反が
 * 図の上に残る。`flavorMatrixFor` が返す `points` は常に同一カテゴリーである。
 *
 * ## いまはダミー、あとで Tea Menu List に差し替える
 *
 * 官能評価 (甘み⇄渋み / 軽やか⇄濃厚 / 余韻) は Notion の Tea Menu List 218 件が
 * いずれ正本になる。ただし現時点でその列は存在しないので、**この層だけが
 * ダミーを持ち、描画側は一切データを知らない**構造にしてある。
 * 実データが来たら `SAMPLE_POINTS_BY_CATEGORY` を差し替えるだけでよく、
 * `components/viz/flavor/*` には手を入れない。
 *
 * 差し替え時に守る契約:
 * - `x` / `y` は -1..+1。0 が中央 (どちらでもない)
 * - `weight` は 0.7..1.2。マーカーの大きさ = 余韻の長さ
 * - 1 つの束に入るのは **同一カテゴリーの銘柄だけ** (混ざったらテストが落ちる)
 * - 数値は画面に出さない (roji 原則)。`note` の言葉が数値の代わりに立つ
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド (20-flavor-matrix / 03-gooey)。
 */

import {
  TEA_CATEGORY_ORDER,
  teaCategoryOf,
  type TeaCategory,
} from "@/lib/roji/tea-category";

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
  /** カテゴリー。同じカテゴリーの点だけが 1 枚の図に載る。 */
  category: TeaCategory;
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

/**
 * ダミーの銘柄。実データ接続時にここが消える。
 *
 * カテゴリーごとに束ねてあるのは、**混ざる余地を型と構造で消す**ため。
 * 平坦な配列に `category` を持たせる形だと、絞り忘れが図の上でしか分からない。
 */
const SAMPLE_POINTS_BY_CATEGORY: Record<TeaCategory, readonly FlavorPoint[]> = {
  green: [
    { id: "g-tsuyuhikari", label: "つゆひかり", x: -0.44, y: 0.46, weight: 0.9, category: "green", note: "蜜のような甘み" },
    { id: "g-saemidori", label: "さえみどり", x: -0.72, y: 0.24, weight: 1.0, category: "green", note: "旨味の芯" },
    { id: "g-shiraore", label: "白折 茎茶", x: -0.8, y: 0.74, weight: 0.74, category: "green", note: "軽く澄んだ甘み" },
    { id: "g-genmaicha", label: "玄米茶", x: -0.16, y: 0.74, weight: 0.8, category: "green", note: "香ばしさと軽さ" },
    { id: "g-gyokuro", label: "玉露 かぶせ", x: -0.74, y: -0.46, weight: 1.16, category: "green", note: "濃密な甘露" },
    { id: "g-hojicha", label: "ほうじ茶 強火", x: -0.08, y: -0.34, weight: 1.06, category: "green", note: "深い焙煎の丸み" },
    { id: "g-kamairi", label: "在来 釜炒り", x: 0.24, y: 0.34, weight: 0.86, category: "green", note: "素朴な渋み" },
    { id: "g-asamushi", label: "浅蒸し 山", x: 0.58, y: 0.54, weight: 0.9, category: "green", note: "涼やかな渋み" },
    { id: "g-fukamushi", label: "深蒸し やぶきた", x: 0.48, y: -0.62, weight: 1.2, category: "green", note: "濃厚な渋みとコク" },
    { id: "g-bancha", label: "秋 番茶", x: 0.7, y: 0.14, weight: 0.78, category: "green", note: "枯れた渋み" },
  ],
  white: [
    { id: "w-ginshin", label: "白毫 銀針", x: -0.66, y: 0.68, weight: 0.86, category: "white", note: "産毛の甘い香" },
    { id: "w-botan", label: "白 牡丹", x: -0.3, y: 0.42, weight: 0.94, category: "white", note: "干した花の甘み" },
    { id: "w-jumei", label: "寿 眉", x: 0.16, y: 0.1, weight: 0.82, category: "white", note: "枯葉の落ち着き" },
    { id: "w-rousha", label: "老 白茶", x: 0.02, y: -0.5, weight: 1.08, category: "white", note: "年を経た丸み" },
  ],
  yellow: [
    { id: "y-ginshin", label: "君山 銀針", x: -0.5, y: 0.5, weight: 0.9, category: "yellow", note: "蒸らしの甘み" },
    { id: "y-mouchou", label: "蒙頂 黄芽", x: -0.2, y: 0.06, weight: 1.0, category: "yellow", note: "とろりとした旨味" },
    { id: "y-kakuzan", label: "霍山 黄芽", x: 0.26, y: -0.32, weight: 0.96, category: "yellow", note: "穀の甘い余韻" },
  ],
  blue: [
    { id: "b-shikishun", label: "四季 春", x: -0.56, y: 0.66, weight: 0.88, category: "blue", note: "咲きかけの花" },
    { id: "b-hanhakko", label: "半発酵 在来", x: -0.24, y: 0.3, weight: 0.94, category: "blue", note: "青と蜜のあいだ" },
    { id: "b-toho", label: "東方 美人", x: 0.1, y: -0.24, weight: 1.12, category: "blue", note: "熟した果実の甘み" },
    { id: "b-kanagi", label: "金 萱", x: 0.4, y: 0.44, weight: 0.84, category: "blue", note: "乳のような含み" },
    { id: "b-tekkannon", label: "鉄 観音 焙", x: 0.62, y: -0.5, weight: 1.14, category: "blue", note: "焙りの厚み" },
    { id: "b-suisen", label: "水 仙", x: 0.78, y: -0.08, weight: 1.0, category: "blue", note: "木の渋み" },
  ],
  black: [
    { id: "k-yamanami", label: "和紅茶 やまなみ", x: -0.4, y: 0.36, weight: 0.92, category: "black", note: "渋みに甘い余韻" },
    { id: "k-benifuuki", label: "べにふうき", x: 0.36, y: 0.2, weight: 1.02, category: "black", note: "きりりとした渋み" },
    { id: "k-zairai", label: "在来 紅茶", x: -0.12, y: 0.62, weight: 0.8, category: "black", note: "軽やかな花の甘み" },
    { id: "k-tsushima", label: "対馬 紅茶", x: 0.06, y: -0.3, weight: 1.1, category: "black", note: "潮の効いた濃さ" },
    { id: "k-minamata", label: "水俣 紅茶", x: 0.56, y: -0.56, weight: 1.18, category: "black", note: "蜜と渋みの厚み" },
    { id: "k-koga", label: "古河 紅茶", x: 0.74, y: 0.5, weight: 0.76, category: "black", note: "乾いた渋み" },
    { id: "k-benihikari", label: "べにひかり", x: -0.7, y: -0.18, weight: 1.04, category: "black", note: "果実のような甘み" },
  ],
  dark: [
    { id: "d-jukucha", label: "熟 茶", x: 0.18, y: -0.66, weight: 1.16, category: "dark", note: "土と木の深み" },
    { id: "d-shocha", label: "生茶 陳", x: 0.54, y: -0.2, weight: 1.02, category: "dark", note: "年を経た渋み" },
    { id: "d-rippo", label: "六 堡", x: -0.1, y: -0.34, weight: 0.98, category: "dark", note: "槟榔の香の丸み" },
    { id: "d-heicha", label: "茯 磚", x: -0.42, y: 0.12, weight: 0.86, category: "dark", note: "菌花の甘い含み" },
  ],
};

export interface FlavorMatrixData {
  /** この図が扱うカテゴリー。色はこれだけが決める。 */
  category: TeaCategory;
  /** 同一カテゴリーの銘柄のみ。他カテゴリーは 1 件も入らない。 */
  points: readonly FlavorPoint[];
  /**
   * 「いま見ている銘柄」。図の中でこの 1 つだけ濃く出す。
   * 引き当てられないときは null (そのカテゴリーの全体図として描く)。
   */
  highlightId: string | null;
}

/**
 * 銘柄番号とカテゴリーから四象限のデータを引く。
 *
 * カテゴリーは `teaCategoryOf` が決める (銘柄番号 5 桁 → Sanity の自由記述 →
 * 既定の順)。返す点は **必ずそのカテゴリーだけ**で、他カテゴリーは混ざらない。
 *
 * 実データが無い今は **銘柄番号を種にして、そのカテゴリーの中のどれかを
 * 「この茶」に割り当てる**。番号が同じなら毎回同じ茶が選ばれるので、ページを
 * 開き直しても図は動かない。番号が無い (一覧・プレビュー) ときは強調なしの
 * 全体図になる。
 */
export function flavorMatrixFor(
  menuNumber: string | number | null | undefined,
  rawCategory?: string | null
): FlavorMatrixData {
  const category = teaCategoryOf(menuNumber, rawCategory);
  const points = SAMPLE_POINTS_BY_CATEGORY[category];

  if (menuNumber === null || menuNumber === undefined) {
    return { category, points, highlightId: null };
  }
  const key = String(menuNumber);
  let acc = 0;
  for (let i = 0; i < key.length; i++) acc = (acc * 31 + key.charCodeAt(i)) >>> 0;
  return { category, points, highlightId: points[acc % points.length].id };
}

/**
 * カテゴリーごとの束をそのまま返す (テスト・棚卸し用)。
 *
 * 図の側からは使わない — 図が触れてよいのは `flavorMatrixFor` の返り値だけで、
 * 全カテゴリーを触れる口を描画側に渡すと恒久ルールの抜け道になる。
 */
export function flavorSamplesByCategory(): Record<TeaCategory, readonly FlavorPoint[]> {
  return SAMPLE_POINTS_BY_CATEGORY;
}

/** どのカテゴリーにも最低 1 件はある、という前提を明示するための一覧。 */
export const FLAVOR_SAMPLE_CATEGORIES = TEA_CATEGORY_ORDER;

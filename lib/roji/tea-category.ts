/**
 * お茶のカテゴリー。**データ表現の比較対象と色を決める唯一の軸**。
 *
 * ## この 1 ファイルが何を握っているか (恒久ルールの実装点)
 *
 * roji のデータ表現には設計上の恒久ルールがある:
 *
 * > 比較対象は「いま見ているお茶と同じカテゴリー」だけ。
 * > 地図・図の色はお茶のカテゴリーを表す。
 * > よって 1 枚の図に載る点は必ず全て同色になる。
 *
 * 出典・全文は `docs/roji-dataviz-rules.md` (Setaka 指摘 4 回・2026-08-17 確定)。
 * 本ファイルはそのルールの **実装上の唯一の入口** で、
 * 「どのカテゴリーか」と「そのカテゴリーの色は何か」をここだけが答える。
 * 図の側 (`components/viz/**`) は色を自分で決めない。
 *
 * ## 粒度をなぜ六大茶類にするか
 *
 * roji の銘柄番号 (5 桁) は **先頭 1 桁が六大茶類** になっている。
 * `lib/roji/tea-origins.ts` の対応表がその実データで、
 * `1xxxx = 緑茶` / `4xxxx = 青茶` / `5xxxx = 紅茶` と註がある。
 * つまりカテゴリーの正本は roji のマスタ採番そのものであって、
 * ここで新しい分類を発明しているわけではない。
 *
 * 2 (白茶) / 3 (黄茶) / 6 (黒茶) は同じ並び (緑・白・黄・青・紅・黒) の続きだが、
 * 現時点で該当する銘柄が 1 件も無いので **実データによる裏付けは無い**。
 * 該当銘柄が入った時点でこの対応を確認すること。
 *
 * Sanity の `teaMenu.category` は自由記述 (`sencha` / `煎茶` / `gyokuro` …) で、
 * 六大茶類より細かい。細かい側は `normalizeTeaCategory` で六大茶類へ畳む
 * (煎茶 も 玉露 も ほうじ茶 も緑茶なので、同じ図に載ってよい)。
 * **粒度を煎茶・玉露まで細かくしたくなったらここだけを変える。**
 */

import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

/** 六大茶類。roji の銘柄番号 5 桁の先頭 1 桁と 1:1 に対応する。 */
export type TeaCategory = "green" | "white" | "yellow" | "blue" | "black" | "dark";

/** 番号順 = 六大茶類の並び順 (緑・白・黄・青・紅・黒)。 */
export const TEA_CATEGORY_ORDER: readonly TeaCategory[] = [
  "green",
  "white",
  "yellow",
  "blue",
  "black",
  "dark",
];

/** 銘柄番号の先頭 1 桁 → カテゴリー。 */
const CATEGORY_BY_LEADING_DIGIT: Record<string, TeaCategory> = {
  "1": "green",
  "2": "white",
  "3": "yellow",
  "4": "blue",
  "5": "black",
  "6": "dark",
};

/**
 * カテゴリーの色。**図に載る点の色はここだけが決める**。
 *
 * 1 枚の図には 1 カテゴリーしか載らないので、図の中では常に単色になる。
 * 複数カテゴリーが同時に出るのは一覧ページのテロワール地図だけで、
 * そこでは「色 = カテゴリー」が凡例としてそのまま読める。
 */
export const TEA_CATEGORY_COLOR: Record<TeaCategory, string> = {
  green: ROJI_VIZ_COLOR.koke,
  white: ROJI_VIZ_COLOR.suna,
  yellow: ROJI_VIZ_COLOR.usukoke,
  blue: ROJI_VIZ_COLOR.fukamidori,
  black: ROJI_VIZ_COLOR.hoji,
  dark: ROJI_VIZ_COLOR.hojiFuka,
};

/** 図の中に置く表記 (roji の字間)。図の外の文には `teaCategoryLabel` を使う。 */
export const TEA_CATEGORY_LABEL: Record<TeaCategory, string> = {
  green: "緑 茶",
  white: "白 茶",
  yellow: "黄 茶",
  blue: "青 茶",
  black: "紅 茶",
  dark: "黒 茶",
};

/** 図の外の文 (説明・代替テキスト) に使う素の表記。 */
const CATEGORY_TEXT: Record<TeaCategory, { ja: string; en: string }> = {
  green: { ja: "緑茶", en: "green tea" },
  white: { ja: "白茶", en: "white tea" },
  yellow: { ja: "黄茶", en: "yellow tea" },
  blue: { ja: "青茶", en: "oolong tea" },
  black: { ja: "紅茶", en: "black tea" },
  dark: { ja: "黒茶", en: "dark tea" },
};

/**
 * 図の外の文に差し込む名前。
 *
 * `locale` は next-intl の値をそのまま渡してよい (`ja` 以外は英語表記になる)。
 */
export function teaCategoryLabel(category: TeaCategory, locale: string): string {
  const text = CATEGORY_TEXT[category];
  return locale.startsWith("ja") ? text.ja : text.en;
}

/**
 * カテゴリーが引けなかったときの落とし先。
 *
 * 落とし先を持つのは **図を消さないため**ではなく、
 * 「カテゴリー不明の茶を、他のカテゴリーの茶と並べない」ため。
 * 不明のまま全件と並べると恒久ルールを破るので、必ずどれか 1 つに寄せる。
 * roji の主軸は緑茶なのでそこへ寄せる。
 */
export const DEFAULT_TEA_CATEGORY: TeaCategory = "green";

/** 自由記述のカテゴリー表記 → 六大茶類。小文字・空白除去して照合する。 */
const CATEGORY_ALIASES: readonly (readonly [readonly string[], TeaCategory])[] = [
  [
    [
      "green", "greentea", "緑茶", "煎茶", "sencha", "深蒸し煎茶", "fukamushi",
      "玉露", "gyokuro", "かぶせ茶", "kabusecha", "抹茶", "matcha",
      "ほうじ茶", "焙じ茶", "hojicha", "houjicha", "玄米茶", "genmaicha",
      "番茶", "bancha", "茎茶", "白折", "kukicha", "釜炒り茶", "釜炒り",
      "kamairicha", "碾茶", "tencha",
    ],
    "green",
  ],
  [["white", "whitetea", "白茶", "白毫銀針", "hakucha"], "white"],
  [["yellow", "yellowtea", "黄茶", "kicha", "君山銀針"], "yellow"],
  [
    ["blue", "oolong", "ウーロン", "ウーロン茶", "烏龍茶", "烏龍", "青茶", "aocha", "半発酵"],
    "blue",
  ],
  [["black", "blacktea", "紅茶", "和紅茶", "koucha", "kocha", "wakoucha"], "black"],
  [["dark", "darktea", "黒茶", "プーアル", "プーアル茶", "puer", "puerh", "後発酵"], "dark"],
];

/** 照合用に潰す (大文字小文字・空白・全角空白・ハイフンを無視する)。 */
function fold(value: string): string {
  return value.toLowerCase().replace(/[\s　_-]/g, "");
}

/**
 * 自由記述のカテゴリー表記を六大茶類へ畳む。判定できなければ `null`。
 *
 * 推測はしない — 未知の語は `null` を返し、呼び出し側が
 * `DEFAULT_TEA_CATEGORY` へ落とすかどうかを決める。
 */
export function normalizeTeaCategory(
  raw: string | null | undefined
): TeaCategory | null {
  if (!raw) return null;
  const folded = fold(raw);
  if (!folded) return null;
  for (const [aliases, category] of CATEGORY_ALIASES) {
    for (const alias of aliases) {
      const target = fold(alias);
      if (folded === target || folded.includes(target)) return category;
    }
  }
  return null;
}

/**
 * 銘柄番号 (5 桁) からカテゴリーを引く。5 桁でなければ `null`。
 *
 * Sanity のダミー (`productNumber: 1` / `"ELX-2026-04"`) は 5 桁採番ではないので
 * ここでは `null` になり、`teaCategoryOf` が自由記述側へ回す。
 */
export function teaCategoryFromMenuNumber(
  menuNumber: string | number | null | undefined
): TeaCategory | null {
  if (menuNumber === null || menuNumber === undefined) return null;
  const key = String(menuNumber).trim();
  if (!/^\d{5}$/.test(key)) return null;
  return CATEGORY_BY_LEADING_DIGIT[key[0]] ?? null;
}

/**
 * そのお茶のカテゴリーを 1 つに決める。**図に載せる対象はこの値で絞る**。
 *
 * 優先順位は「構造化されている順」:
 *   1. 銘柄番号 5 桁の先頭 1 桁 (roji のマスタ採番)
 *   2. Sanity `teaMenu.category` の自由記述を畳んだ値
 *   3. どちらも引けなければ `DEFAULT_TEA_CATEGORY`
 */
export function teaCategoryOf(
  menuNumber: string | number | null | undefined,
  rawCategory?: string | null
): TeaCategory {
  return (
    teaCategoryFromMenuNumber(menuNumber) ??
    normalizeTeaCategory(rawCategory) ??
    DEFAULT_TEA_CATEGORY
  );
}

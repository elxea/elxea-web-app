/**
 * 「好みの位置」— 銘柄カタログ (ダミー 26 種)。
 *
 * `lib/roji/tea-flavor.ts` の 10 種を **カテゴリ付き** に広げたもの。
 * 味の座標系 (`x` / `y` / `weight` / `process`) はそのまま借りている。
 *
 * 足したもの:
 * - `category` 緑茶 / 紅茶 / 青茶 … レンズ①の切替単位
 * - `aroma` 0 = 甘い ←→ 1 = 青い … 銘柄カードの「香りの方向」
 * - `poem` 詩的な一言 … 銘柄カードの本文
 *
 * ## 青茶の色を明度で決めてはいけない
 *
 * 半発酵だから淡いだろうと `#93896E` を当てると、緑茶 (苔) と紅茶 (焙じ深) より
 * **明るくなり、青茶のカテゴリだけ生成りの紙に溶ける**。苔 `#7A8B6F` と
 * 焙じ茶 `#8A6E55` のちょうど中点 `#827C62` にすると、製法の位置と画面上の重さが
 * 一致する。色は明度ではなく **分類上の位置** で決める。
 *
 * 出典: viz 査定 `verdicts.md` 第7ラウンド `31-flavor-interactive/catalog.js`。
 */

import { ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";

/**
 * 製法系統。`/dev/me` のモックアップ**専用**の語彙。
 *
 * もとは `lib/roji/tea-flavor.ts` にあったが、「1 枚の図に並べてよいのは同じ
 * カテゴリーだけ」という確定ルールの適用で本番の図から製法系統という軸自体が
 * 外れ、tea-flavor は カテゴリー (`lib/roji/tea-category.ts`) だけを持つように
 * なった。/dev/me は銘柄カードの**言葉**としてこの語彙をまだ使うため、唯一の
 * 利用者であるここに移設して持つ。**本番の図 (tea-menu) からは参照しない。**
 */
export type TeaProcess = "mushi" | "kama" | "hoiro" | "hakko";

const TEA_PROCESS_COLOR: Record<TeaProcess, string> = {
  /** 蒸し製 */
  mushi: ROJI_VIZ_COLOR.koke,
  /** 釜炒り */
  kama: ROJI_VIZ_COLOR.usukoke,
  /** 焙煎 */
  hoiro: ROJI_VIZ_COLOR.hoji,
  /** 発酵 */
  hakko: ROJI_VIZ_COLOR.hojiFuka,
};

const TEA_PROCESS_LABEL: Record<TeaProcess, string> = {
  mushi: "蒸 し 製",
  kama: "釜 炒 り",
  hoiro: "焙 煎",
  hakko: "発 酵",
};

/** 半発酵を足した 5 系統。色はこれだけで決まる (品種でも産地でもない)。 */
export type MeTeaProcess = TeaProcess | "hankou";

/**
 * @deprecated **描画に使わない。** 色はカテゴリーが決める (`TEA_CATEGORY_COLOR`)。
 * 系統ごとの色は「1 枚の図の中で色が割れる」誤った表現になるため廃止した。
 * 参照が残っているのは移行のためだけで、点・凡例・にじみの色に使ってはいけない。
 */
export const ME_PROCESS_COLOR: Record<MeTeaProcess, string> = {
  ...TEA_PROCESS_COLOR,
  hankou: "#827C62",
};

export const ME_PROCESS_LABEL: Record<MeTeaProcess, string> = {
  ...TEA_PROCESS_LABEL,
  hankou: "半 発 酵",
};

export type TeaCategory = "green" | "black" | "blue";

export const TEA_CATEGORIES: readonly { key: TeaCategory; label: string }[] = [
  { key: "green", label: "緑 茶" },
  { key: "black", label: "紅 茶" },
  { key: "blue", label: "青 茶" },
];

export const TEA_CATEGORY_LABEL: Record<TeaCategory, string> = {
  green: "緑 茶",
  black: "紅 茶",
  blue: "青 茶",
};

/**
 * **色はカテゴリーを表す。系統でも品種でも産地でもない。**
 *
 * 比較のために 1 枚の図に並べてよいのは「見ているお茶と同じカテゴリー」だけ、
 * というのが roji の確定ルール (Setaka 指示。過去 4 回指摘済み)。したがって
 * **1 枚の図に載る点はすべて同じカテゴリー = すべて同じ色**になるのが正しい姿で、
 * 図の中で色が割れていたらそれはカテゴリーを跨いだ比較をしている印になる。
 *
 * 以前ここは製法系統 (蒸し製 / 釜炒り / 焙煎 / 発酵) を色にしていたが、
 * それだと同じ図の中に 4 色が出て「色は何を表すのか」が二重になる。系統は
 * `process` として残し、**言葉 (`ME_PROCESS_LABEL`) でだけ**語らせる。
 *
 * 青茶の値は苔 `#7A8B6F` と焙じ茶 `#8A6E55` のちょうど中点。半発酵という
 * 分類上の位置がそのまま画面上の重さになる (明度で決めると青茶だけ紙に溶ける)。
 */
export const TEA_CATEGORY_COLOR: Record<TeaCategory, string> = {
  green: ROJI_VIZ_COLOR.koke,
  black: ROJI_VIZ_COLOR.hojiFuka,
  blue: "#827C62",
};

export interface CatalogTea {
  id: string;
  label: string;
  category: TeaCategory;
  /** -1 = 甘み ←→ +1 = 渋み */
  x: number;
  /** +1 = 軽やか ←→ -1 = 濃厚 */
  y: number;
  /** 余韻の長さ (0.7..1.2)。芯の大きさ。 */
  weight: number;
  process: MeTeaProcess;
  /** 0 = 甘い ←→ 1 = 青い。目盛りの無い一本の線で示す。 */
  aroma: number;
  /** 数値の代わりに置く一言。 */
  note: string;
  /** 詩的な一言。 */
  poem: string;
  /**
   * 描画色。**カテゴリーの色**であって系統の色ではない。
   * 同じ図に載る点は同じカテゴリーなので、この値は図の中で 1 種類しか出ない。
   */
  color: string;
}

type RawTea = Omit<CatalogTea, "category" | "color">;

const GREEN: readonly RawTea[] = [
  { id: "tsuyuhikari", label: "つゆひかり", x: -0.44, y: 0.46, weight: 0.9, process: "mushi", aroma: 0.3, note: "蜜のような甘み", poem: "陽のあたる縁側で、湯気がゆっくりほどけていく。" },
  { id: "saemidori", label: "さえみどり", x: -0.72, y: 0.24, weight: 1.0, process: "mushi", aroma: 0.42, note: "旨味の芯", poem: "飲み下したあとに、青い草の匂いだけが残る。" },
  { id: "shiraore", label: "白折 茎茶", x: -0.8, y: 0.74, weight: 0.74, process: "mushi", aroma: 0.34, note: "軽く澄んだ甘み", poem: "朝いちばんの水のように、なにも引っかからない。" },
  { id: "genmaicha", label: "玄米茶", x: -0.16, y: 0.74, weight: 0.8, process: "hoiro", aroma: 0.12, note: "香ばしさと軽さ", poem: "炒りたての米の匂いが、部屋のすみまで届く。" },
  { id: "gyokuro", label: "玉露 かぶせ", x: -0.74, y: -0.46, weight: 1.16, process: "mushi", aroma: 0.26, note: "濃密な甘露", poem: "一滴が舌の上にとどまって、しばらく動かない。" },
  { id: "kabuse-shinme", label: "かぶせ 新芽", x: -0.62, y: -0.1, weight: 1.04, process: "mushi", aroma: 0.48, note: "若い甘み", poem: "摘んだばかりの葉の、まだ固まっていない甘さ。" },
  { id: "hojicha", label: "ほうじ茶 強火", x: -0.08, y: -0.34, weight: 1.06, process: "hoiro", aroma: 0.08, note: "深い焙煎の丸み", poem: "火にあてた枝の匂い。夜のほうがよく似合う。" },
  { id: "zairai-kamairi", label: "在来 釜炒り", x: 0.24, y: 0.34, weight: 0.86, process: "kama", aroma: 0.62, note: "素朴な渋み", poem: "手をかけすぎない味。山の畑がそのまま出る。" },
  { id: "bancha-hiboshi", label: "番茶 日干し", x: 0.34, y: 0.66, weight: 0.78, process: "kama", aroma: 0.7, note: "素朴で軽い", poem: "干し草を抱えたときの匂い。ふだんの茶。" },
  { id: "asamushi-yama", label: "浅蒸し 山", x: 0.58, y: 0.54, weight: 0.9, process: "kama", aroma: 0.82, note: "涼やかな渋み", poem: "沢の水を汲んだときの、あの冷たさに近い。" },
  { id: "fukamushi-yabukita", label: "深蒸し やぶきた", x: 0.48, y: -0.62, weight: 1.2, process: "mushi", aroma: 0.55, note: "濃厚な渋みとコク", poem: "濃い緑がとろりと沈む。飲んだあとも喉に残る。" },
  // --- 履歴にはまだ無い緑茶 ------------------------------------------------
  // 「この先の一杯」(`lib/roji/me/next-cups.ts`) が返す先。棚には自分が飲んだ
  // ものより多くが並んでいる、という当たり前をデータの形で持たせておく。
  // **同じカテゴリー内にしか候補を作らない** (別カテゴリーとの距離は比較できない)。
  // 座標は既存 11 種と札が重ならない空きに置く。四象限は札の当たり判定を持たず
  // 実測幅で左右に逃がすだけなので、近すぎる 2 点は必ず札が重なって両方読めなくなる。
  { id: "yame-gyokuro", label: "八女 玉露", x: -0.9, y: -0.62, weight: 1.18, process: "mushi", aroma: 0.22, note: "濃い甘露", poem: "とろりとして、飲み込むのが惜しくなる。" },
  { id: "tencha", label: "碾茶 てんちゃ", x: -0.36, y: -0.28, weight: 0.98, process: "mushi", aroma: 0.36, note: "覆いの下の甘み", poem: "挽く前の葉のまま。青海苔のような香りが立つ。" },
  { id: "karigane", label: "雁ヶ音 かりがね", x: -0.48, y: 0.9, weight: 0.8, process: "mushi", aroma: 0.3, note: "軽い甘みと香ばしさ", poem: "茎ばかりを集めた茶。軽いのに、後ろに甘さが残る。" },
  { id: "shuutou-bancha", label: "秋冬番茶", x: 0.84, y: 0.3, weight: 0.76, process: "kama", aroma: 0.68, note: "澄んで軽い渋み", poem: "刈り終えた畑の匂い。冬のあいだ、ずっと飲んでいられる。" },
];

const BLACK: readonly RawTea[] = [
  { id: "wakoucha-minamisayaka", label: "和紅茶 みなみさやか", x: 0.34, y: 0.16, weight: 0.88, process: "hakko", aroma: 0.18, note: "花のような甘い香り", poem: "湯を注いだ瞬間に、白い花の匂いが立ちのぼる。" },
  { id: "mushisei-koucha", label: "蒸し製 和紅茶", x: -0.24, y: -0.1, weight: 0.94, process: "hakko", aroma: 0.2, note: "丸く柔らかい甘み", poem: "角がない。湯冷ましでゆっくり出すとよく分かる。" },
  { id: "mishou-koucha", label: "実生 紅茶", x: 0.06, y: -0.28, weight: 0.96, process: "hakko", aroma: 0.24, note: "素朴な甘い余韻", poem: "種から育った木の、ばらばらで正直な味。" },
  { id: "baisen-koucha", label: "焙煎 紅茶", x: -0.02, y: -0.7, weight: 1.1, process: "hoiro", aroma: 0.06, note: "焦がした糖の深み", poem: "底のほうに、焦げた砂糖のような甘さが沈む。" },
  { id: "koushun-aki", label: "香駿 秋摘み", x: 0.6, y: 0.44, weight: 0.84, process: "hakko", aroma: 0.66, note: "涼しい渋みと香り", poem: "秋の空気が入った茶。細く高いところで香る。" },
  { id: "wakoucha-yamanami", label: "和紅茶 やまなみ", x: 0.76, y: -0.24, weight: 1.02, process: "hakko", aroma: 0.3, note: "渋みに甘い余韻", poem: "渋みの奥に、干した果実の甘さがひそんでいる。" },
  { id: "wakoucha-benifuuki", label: "和紅茶 べにふうき", x: 0.86, y: -0.52, weight: 1.08, process: "hakko", aroma: 0.44, note: "強い渋みとコク", poem: "一口目で背筋が伸びる。朝に向いた強さ。" },
];

const BLUE: readonly RawTea[] = [
  { id: "bunzan-housyu", label: "文山包種", x: -0.62, y: 0.78, weight: 0.76, process: "hankou", aroma: 0.88, note: "青く軽やかな花", poem: "ほとんど緑茶の顔をしている。香りだけが花。" },
  { id: "arisan-kouzan", label: "阿里山 高山", x: -0.56, y: 0.34, weight: 0.94, process: "hankou", aroma: 0.6, note: "澄んだ甘み", poem: "高いところの霧を、そのまま閉じ込めたような。" },
  { id: "touchou-oolong", label: "凍頂烏龍", x: -0.4, y: 0.6, weight: 0.88, process: "hankou", aroma: 0.4, note: "乳のような甘い香り", poem: "湯気に鼻を寄せると、温めた乳の匂いがする。" },
  { id: "tekkannon", label: "鉄観音", x: -0.12, y: 0.26, weight: 1.0, process: "hankou", aroma: 0.34, note: "蘭のような香り", poem: "蘭の花。何煎いれても、まだ奥に残っている。" },
  { id: "touhou-bijin", label: "東方美人", x: -0.3, y: -0.26, weight: 1.08, process: "hakko", aroma: 0.14, note: "蜜と熟した果実", poem: "虫が噛んだ葉から出る蜜の香り。事故のような甘さ。" },
  { id: "hakugou-oolong", label: "白毫烏龍 摘みたて", x: 0.3, y: 0.52, weight: 0.82, process: "hankou", aroma: 0.74, note: "涼しい渋みと花", poem: "摘んですぐの葉の、青くとがった気配が残る。" },
  { id: "baisen-oolong", label: "焙煎 烏龍", x: 0.18, y: -0.42, weight: 1.04, process: "hoiro", aroma: 0.1, note: "焙煎の丸み", poem: "炭の上で何度も眠らせた葉。静かに温かい。" },
  { id: "bui-gancha", label: "武夷岩茶", x: 0.44, y: -0.64, weight: 1.14, process: "hoiro", aroma: 0.22, note: "岩の深み", poem: "岩の匂いがする、と言う人がいる。たしかにする。" },
];

function tag(teas: readonly RawTea[], category: TeaCategory): CatalogTea[] {
  return teas.map((tea) => ({
    ...tea,
    category,
    // 色はカテゴリーが決める。系統 (`process`) は言葉でだけ語る。
    color: TEA_CATEGORY_COLOR[category],
  }));
}

/** 全 26 銘柄。 */
export const CATALOG_TEAS: readonly CatalogTea[] = [
  ...tag(GREEN, "green"),
  ...tag(BLACK, "black"),
  ...tag(BLUE, "blue"),
];

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogTea> = new Map(
  CATALOG_TEAS.map((tea) => [tea.id, tea])
);

export interface LegendEntry {
  process: MeTeaProcess;
  color: string;
  label: string;
}

/**
 * カテゴリごとの凡例。
 *
 * **1 枚の図に載る点は同じカテゴリーなので、凡例も必ず 1 行になる**。
 * 以前は系統ごとに 3〜4 色を並べていたが、色がカテゴリーを表すことにした以上
 * それは「1 枚の図の中でカテゴリーが割れている」と読める誤った説明だった。
 * 系統は色ではなく銘柄カードの言葉 (`ME_PROCESS_LABEL`) 側に移してある。
 */
function buildLegend(): Record<TeaCategory, readonly LegendEntry[]> {
  const legend = {} as Record<TeaCategory, readonly LegendEntry[]>;
  for (const { key } of TEA_CATEGORIES) {
    // 凡例の `process` は互換のために残すが、色の決定には使わない。
    const first = CATALOG_TEAS.find((tea) => tea.category === key);
    legend[key] = [
      {
        process: first?.process ?? "mushi",
        color: TEA_CATEGORY_COLOR[key],
        label: TEA_CATEGORY_LABEL[key],
      },
    ];
  }
  return legend;
}

export const CATALOG_LEGEND: Record<TeaCategory, readonly LegendEntry[]> = buildLegend();

/** 香りの方向の両端の言葉。数値は出さない。 */
export const AROMA_AXIS = { left: "甘 い", right: "青 い" } as const;

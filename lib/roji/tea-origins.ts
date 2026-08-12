/**
 * 銘柄番号 (5 桁) → 産地 (都道府県 / 市町村) の対応表。
 *
 * roji「お茶の旅の地図」(飲んだ産地が日本地図上に灯る可視化) の前提データ。
 * 地図は都道府県ポリゴンを塗るので、**銘柄から一意に都道府県が引ける** ことが
 * 実装の必要条件になる。その結合キーを与えるのがこのファイル。
 *
 * ## データの出どころ (2026-08-12 棚卸し)
 *
 * 正本は Notion の 2 つの DB で、産地は銘柄ではなく **仕入先 (農家)** に紐づいている。
 *
 *   Tea Menu List (ee367f6c-3ff3-4251-ad9e-0bc5a2cc7358)
 *     └─ Supplier Name (relation) ─→ Supplier List (a721731c-6477-47a4-833e-26a3f3f2c926)
 *                                      ├─ Prefecture (select・47 都道府県の正式名称)
 *                                      └─ Regions    (text・自由記述)
 *
 * つまり「産地が自由記述で構造化されていない」は **半分だけ正しい**。
 * 自由記述なのは Regions と Sanity `teaMenu.origin` であって、
 * 都道府県は Supplier List の Prefecture に select として既に構造化されている。
 * このファイルはそれをコード側へ写したスナップショットであり、新たに人手で
 * 産地を推定したものではない (推定を挟むと正本と食い違うため)。
 *
 * ## なぜ Sanity ではなくコード側に置くか
 *
 * Sanity の `teaMenu` は 2026-08-12 時点で 3 件しか無く、その 3 件は
 * `scripts/seed-dummy-content.ts` が入れたダミー (productNumber が 1/2/3 で
 * 5 桁採番になっていない)。銘柄マスタの実体は Notion 側 43 件であり、
 * Sanity にスキーマを足しても埋めるデータが無い。
 * 中長期的には Sanity `teaMenu` に構造化産地フィールドを足し、Notion からの
 * 同期に乗せるのが単一正本として筋が良い (下の「将来の移行」を参照)。
 *
 * ## 将来の移行
 *
 * このファイルは **暫定の写し** であって正本ではない。Notion 側で仕入先の
 * Prefecture が変われば、ここは自動では追随しない。恒久策は
 * `scripts/sync-notion-to-sanity.ts` に teaMenu の同期を足し、
 * Supplier の Prefecture / Regions を Sanity の構造化フィールドへ流し込むこと。
 * それが入った時点でこのファイルは削除し、参照を Sanity クエリへ差し替える。
 *
 * ## 出さないもの
 *
 * 仕入先の住所・連絡先はここに持たない。地図に必要なのは都道府県と地域名だけで、
 * 取引先の所在地詳細は roji の表示に使わないため (必要になったら Notion を引く)。
 */

import { isPrefecture, type Prefecture } from "./prefectures";

/**
 * 産地の一件。地図が必要とする最小限だけを持つ。
 */
export interface TeaOrigin {
  /**
   * 都道府県 (47 の正式名称)。地図ポリゴンとの結合キー。
   *
   * `null` は「まだ判定できていない」を意味する。推測で埋めない。
   * 国外産 (Supplier List の Country=中国) もここは `null` になり、
   * 日本地図には灯らない。
   */
  prefecture: Prefecture | null;
  /**
   * 市町村・地域名。都道府県より細かい表示 (ピンのラベル等) に使う。
   * 粒度は仕入先ごとに揃っていない (「八女市」もあれば「西臼杵郡五ヶ瀬町」もある)。
   * 正本の Regions がそう書かれているためで、ここで丸めると情報が減るので触らない。
   */
  area: string | null;
  /** Notion Supplier List の Regions の原文。判定の根拠を追えるように残す。 */
  raw: string | null;
  /** `prefecture` が自動判定できず人の確認が要る場合に true。 */
  needsReview: boolean;
}

/**
 * 仕入先ごとの産地。銘柄 43 件に対し仕入先は 12 件なので、
 * 産地は仕入先側に 1 度だけ持つ (銘柄側に写すと同じ値が 14 個並び、
 * 修正漏れの発生源になる)。
 */
interface OriginSource {
  /** Notion Supplier List の Name。どの農家由来かを追えるように持つ。 */
  supplier: string;
  prefecture: Prefecture | null;
  area: string | null;
  /** Supplier List の Regions 原文。全角・半角スペースもそのまま。 */
  raw: string | null;
}

/**
 * 産地の実体 (Notion Supplier List のスナップショット)。
 * `area` は `raw` の先頭から都道府県名を落として区切りスペースを詰めたもの。
 */
const ORIGIN_SOURCES = {
  shibakiri: {
    supplier: "しばきり園",
    prefecture: "静岡県",
    area: "静岡市",
    raw: "静岡県 静岡市",
  },
  "ryokuheki-gokase": {
    supplier: "緑碧茶園 五ヶ瀬茶園",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
  },
  nakakubo: {
    supplier: "中窪製茶園",
    prefecture: "京都府",
    area: "相楽郡南山城村",
    raw: "京都府 相楽郡 南山城村",
  },
  masui: {
    supplier: "ますいさんちの茶　益井園",
    prefecture: "静岡県",
    area: "榛原郡川根本町",
    raw: "静岡県 榛原郡 川根本町",
  },
  mitocha: {
    supplier: "みとちゃ農園",
    prefecture: "奈良県",
    area: "山添村",
    raw: "奈良県 山添村",
  },
  chiyonoen: {
    supplier: "お茶の千代乃園",
    prefecture: "福岡県",
    area: "八女市",
    raw: "福岡県 八女市",
  },
  kajihara: {
    supplier: "お茶のカジハラ",
    prefecture: "熊本県",
    area: "葦北郡芦北町",
    raw: "熊本県 葦北郡芦北町",
  },
  "miyazaki-sabo": {
    supplier: "宮崎茶房",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
  },
  sakaguchi: {
    supplier: "お茶の坂口園",
    prefecture: "熊本県",
    area: "水俣市",
    raw: "熊本県 水俣市",
  },
  "tsushima-oishi": {
    supplier: "つしま大石農園",
    prefecture: "長崎県",
    area: "対馬市上県町",
    raw: "長崎県 対馬市 上県町",
  },
  hasama: {
    supplier: "ハサマ共同製茶組合",
    prefecture: "三重県",
    area: "四日市市川島町",
    raw: "三重県 四日市市 川島町",
  },
  yoshida: {
    supplier: "吉田茶園",
    prefecture: "茨城県",
    area: "古河市",
    raw: "茨城県 古河市",
  },
} as const satisfies Record<string, OriginSource>;

/** 仕入先キー。 */
export type OriginSourceKey = keyof typeof ORIGIN_SOURCES;

/**
 * 銘柄番号 (5 桁) → 仕入先キー。
 *
 * 対象は Tea Menu List のうち Menu Name (5 桁採番) が入っている 43 件。
 * 採番前の下書き行 (175 件) は銘柄として成立していないので含めない。
 * 販売停止・準備中も残す — 地図は「過去に飲んだお茶」も灯すため、
 * 現在の販売状態で絞ると過去の記録が引けなくなる。
 */
const TEA_ORIGIN_BY_NUMBER = {
  // 緑茶
  "10101": "shibakiri",
  "10102": "shibakiri",
  "10201": "shibakiri",
  "10202": "shibakiri",
  "10301": "shibakiri",
  "10401": "ryokuheki-gokase",
  "10501": "ryokuheki-gokase",
  "10502": "ryokuheki-gokase",
  "10601": "ryokuheki-gokase",
  "10602": "ryokuheki-gokase",
  "10701": "nakakubo",
  "10801": "masui",
  "10901": "shibakiri",
  "11001": "shibakiri",
  "11101": "shibakiri",
  "11201": "shibakiri",
  "11301": "mitocha",
  "11401": "mitocha",
  "11501": "ryokuheki-gokase",
  "11601": "chiyonoen",
  "11701": "chiyonoen",
  // 青茶
  "40101": "chiyonoen",
  "40201": "kajihara",
  "40301": "miyazaki-sabo",
  "40401": "masui",
  "40501": "chiyonoen",
  "40601": "chiyonoen",
  // 紅茶
  "50101": "chiyonoen",
  "50201": "chiyonoen",
  "50301": "kajihara",
  "50401": "sakaguchi",
  "50501": "kajihara",
  "50601": "masui",
  "50701": "masui",
  "50801": "masui",
  "50901": "chiyonoen",
  "51001": "tsushima-oishi",
  "51101": "kajihara",
  "51201": "chiyonoen",
  "51301": "hasama",
  "51401": "hasama",
  "51501": "yoshida",
  "51601": "yoshida",
} as const satisfies Record<string, OriginSourceKey>;

/** 対応表に載っている銘柄番号。 */
export type TeaMenuNumber = keyof typeof TEA_ORIGIN_BY_NUMBER;

/** 対応表に載っている銘柄番号の一覧 (昇順)。 */
export const TEA_MENU_NUMBERS = Object.keys(TEA_ORIGIN_BY_NUMBER).sort() as TeaMenuNumber[];

/** 産地が判定できなかったときの値。地図には灯らず、確認対象として数える。 */
const UNKNOWN_ORIGIN: TeaOrigin = {
  prefecture: null,
  area: null,
  raw: null,
  needsReview: true,
};

/**
 * 銘柄番号から産地を引く。
 *
 * 未知の番号 (対応表に無い / 5 桁でない) は推測せず `needsReview: true` を返す。
 * 地図側は `prefecture === null` の銘柄を「灯さない」で扱えばよく、
 * 例外を投げないのは 1 件の欠損で地図全体が落ちるのを避けるため。
 */
export function resolveTeaOrigin(menuNumber: string): TeaOrigin {
  const key = TEA_ORIGIN_BY_NUMBER[menuNumber as TeaMenuNumber];
  if (!key) return UNKNOWN_ORIGIN;

  const source = ORIGIN_SOURCES[key];
  // 正本 (Notion) 側で Prefecture が空 / 国外の場合に備えて必ず検証する。
  // ここを素通しにすると地図の結合キーに未知の文字列が混じる。
  const prefecture = isPrefecture(source.prefecture) ? source.prefecture : null;

  return {
    prefecture,
    area: source.area,
    raw: source.raw,
    needsReview: prefecture === null,
  };
}

/** 銘柄番号から仕入先名を引く (物語・農家紹介の導線用)。 */
export function resolveTeaSupplier(menuNumber: string): string | null {
  const key = TEA_ORIGIN_BY_NUMBER[menuNumber as TeaMenuNumber];
  return key ? ORIGIN_SOURCES[key].supplier : null;
}

/**
 * 飲んだ銘柄の一覧から、灯すべき都道府県の集合を作る。
 * 地図コンポーネントの入口になる想定。未知・国外の銘柄は黙って捨てる。
 */
export function prefecturesFromMenuNumbers(menuNumbers: readonly string[]): Set<Prefecture> {
  const lit = new Set<Prefecture>();
  for (const n of menuNumbers) {
    const { prefecture } = resolveTeaOrigin(n);
    if (prefecture) lit.add(prefecture);
  }
  return lit;
}

/** 都道府県ごとの銘柄数。棚卸し・デバッグ用。 */
export function teaCountByPrefecture(): Map<Prefecture, number> {
  const counts = new Map<Prefecture, number>();
  for (const n of TEA_MENU_NUMBERS) {
    const { prefecture } = resolveTeaOrigin(n);
    if (!prefecture) continue;
    counts.set(prefecture, (counts.get(prefecture) ?? 0) + 1);
  }
  return counts;
}

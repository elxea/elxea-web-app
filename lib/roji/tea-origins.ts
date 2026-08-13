/**
 * 銘柄番号 (5 桁) → 産地 (都道府県 / 市町村) の対応表。
 *
 * roji「お茶の旅の地図」(飲んだ産地が日本地図上に灯る可視化) の前提データ。
 * 地図は Mapbox で点を打つので、**銘柄から一意に緯度経度が引ける** ことが
 * 実装の必要条件になる。その結合キーを与えるのがこのファイル。
 * 都道府県名はポリゴン塗り・集計・凡例の側で使う。
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
 * ## この地図が指しているもの — 茶畑ではない (2026-08-14 確定)
 *
 * 座標は **茶畑の位置ではない**。仕入先の事務所・製茶所の位置である。
 * 茶畑そのものの区画は公開情報から特定できないことを 2026-08-14 の調査で確定した。
 * 農地の筆界は公開されておらず、農家は複数の圃場を山あいに分散して持つのが普通で、
 * そもそも「1 点」に還元できない。
 *
 * よってこの地図が伝えるのは「その茶がどの畑で摘まれたか」ではなく、
 * **つくり手が拠って立つ土地はどこか** である。地図の周りに置く文言もこの意味で
 * 書く (「茶畑の場所」と言わない)。
 *
 * ## 緯度経度の出どころ (2026-08-14 に全 12 軒を取り直し)
 *
 * 初版 (2026-08-12) は Notion Supplier List の `Place` プロパティを正本にしていたが、
 * `Place` に入っていたのは **市町村の代表点 (役場の位置)** であって仕入先の所在地
 * ではなかった。「静岡県静岡市」を geocode した点は市役所を指し、実際の産地から
 * 20km 以上離れる。産地を指す地図としては事実誤りなので 12 軒すべて置き換えた。
 *
 * 取得手順 (`coordSource: "survey-2026-08"`):
 *   1. 各仕入先が自ら公開している所在地 (自社サイト・組合の公表資料) を集める
 *   2. その住所を国土地理院のジオコーダに掛けて緯度経度に変換する
 *      https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
 *
 * つまり **公開された住所に基づく点** であり、市町村の代表点ではない。
 * `precision: "area"` のままなのは、住所の解決精度が大字〜番地の間で軒ごとに
 * 揺れるためで、粒度の主張を実態より強くしないため。
 *
 * ### 同一座標の 2 軒は正しい状態 — ずらして誤魔化さない
 *
 * 緑碧茶園 五ヶ瀬茶園 と 宮崎茶房 は同じ座標を持つ。両者は **別会社で番地も別**
 * だが、無料で使えるジオコーダでは大字の代表点までしか解決できないため同値になる。
 * これは不具合ではない。見た目のために座標をずらすと、地図が事実でなくなる。
 * 分離したければ番地まで解決する有料ジオコーダを入れるのが筋 (未導入)。
 *
 * **Notion 側の `Place` はもう参照していない。** 仕入先の所在地が変わったら
 * 本ファイルを調査し直して手で更新する。
 *
 * 座標は **推測で作らない**。住所が公開されていない軒は `lat`/`lng` を `null` に
 * し `needsReview: true` を立てる (地図に打たず、確認対象として数える)。
 * 2026-08-14 時点で該当は無い。
 *
 * ## 将来の移行
 *
 * 都道府県・地域名は Notion Supplier List の写しであって正本ではない。Notion 側で
 * 仕入先の Prefecture / Regions が変われば、ここは自動では追随しない。恒久策は
 * `scripts/sync-notion-to-sanity.ts` に teaMenu の同期を足し、
 * Supplier の Prefecture / Regions を Sanity の構造化フィールドへ流し込むこと。
 *
 * ただし **緯度経度は同期に乗せない**。Notion の `Place` は市町村の代表点しか
 * 持っておらず (2026-08-14 に判明)、同期すると調査で取り直した座標が
 * 役場の位置へ戻ってしまう。座標は調査結果として本ファイルが持ち続ける。
 *
 * ## 出さないもの
 *
 * 仕入先の住所・連絡先はここに持たない。地図に必要なのは都道府県と地域名だけで、
 * 取引先の所在地詳細は roji の表示に使わないため (必要になったら Notion を引く)。
 */

import { isPrefecture, type Prefecture } from "./prefectures";

/**
 * 座標がどの粒度で取れているか。Mapbox の見せ方を分ける材料になる。
 *
 * - `area`       市町村・地域まで特定できた。その地域の代表座標。
 * - `prefecture` 都道府県までしか分からず、県庁所在地 / 県の重心で代用した。
 *                実際の茶園はここから数十 km ずれうるので、ピンを小さくする・
 *                ぼかす等の扱いを地図側で選べるようにこの値を残す。
 * - `none`       座標が無い (`lat`/`lng` が `null`)。地図に打たない。
 */
export type OriginPrecision = "area" | "prefecture" | "none";

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
  /**
   * 緯度 (WGS84・度)。日本国内なので 24〜46 の範囲に収まる。
   * `null` は座標を確定できていない状態で、推測値は入れない。
   */
  lat: number | null;
  /** 経度 (WGS84・度)。日本国内なので 122〜154 の範囲に収まる。 */
  lng: number | null;
  /** 座標の粒度。`lat`/`lng` が `null` のときは必ず `none`。 */
  precision: OriginPrecision;
  /**
   * 座標に紐づく地点の正式名称。どの地点に解決されたかの根拠。
   * 正本由来の軒は Notion `Place` の name、GSI 由来の軒は GSI が返した title。
   * 座標が無いときは `null`。
   */
  geoTitle: string | null;
  /** `prefecture` か座標が自動判定できず人の確認が要る場合に true。 */
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
  lat: number | null;
  lng: number | null;
  precision: OriginPrecision;
  /**
   * 座標の出どころ。
   *
   * - `survey-2026-08` 2026-08-14 の調査。仕入先が公開している所在地の住所を
   *                    国土地理院のジオコーダに掛けた値。現行の全 12 軒がこれ。
   * - `notion-place`   Notion Supplier List の `Place`。市町村の代表点 (役場) を
   *                    指し産地から最大 20km 以上ずれるため 2026-08-14 に全廃。
   *                    値を戻す変更を目で検知できるよう、列挙値だけ残してある。
   * - `gsi`            市町村名だけを geocode した旧値。同上の理由で全廃。
   *
   * 新しい軒を足すときは `survey-2026-08` 系 (= 住所ベース) を使う。
   * 市町村名だけを geocode した値を混ぜない — 軒ごとに地図の意味が変わるため。
   */
  coordSource: "survey-2026-08" | "notion-place" | "gsi";
  /**
   * ジオコーダに投げた文字列 (再取得・検証用)。
   *
   * 仕入先の番地入り住所そのものはここに書かない (取引先の所在地詳細を
   * このファイルに持たない方針。ファイル冒頭「出さないもの」を参照)。
   */
  geoQuery: string | null;
  /** 座標が属する自治体の正式名称。どこに落ちたかを目で確かめるための根拠。 */
  geoTitle: string | null;
}

/**
 * 産地の実体。
 *
 * `prefecture` / `area` / `raw` は Notion Supplier List のスナップショット。
 * `area` は `raw` の先頭から都道府県名を落として区切りスペースを詰めたもの。
 *
 * `lat`/`lng` は 2026-08-14 の調査値 (公開された所在地の住所 → 国土地理院の
 * ジオコーダ)。**丸めない** — 丸めると軒ごとに精度が変わり、どこまで信じてよいかが
 * 読めなくなる。これらが指すのは事務所・製茶所であって茶畑ではない
 * (ファイル冒頭「この地図が指しているもの」を参照)。
 */
const ORIGIN_SOURCES = {
  shibakiri: {
    supplier: "しばきり園",
    prefecture: "静岡県",
    area: "静岡市",
    raw: "静岡県 静岡市",
    // 静岡市は政令市で南北に長い。旧値 (34.97516, 138.38324) は市役所付近を
    // 指していたが、実際の所在地は市域北部の山あいで 20km 以上北にある。
    lat: 35.081059,
    lng: 138.494431,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "静岡県静岡市",
  },
  "ryokuheki-gokase": {
    supplier: "緑碧茶園 五ヶ瀬茶園",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    lat: 32.722046,
    lng: 131.222107,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  nakakubo: {
    supplier: "中窪製茶園",
    prefecture: "京都府",
    area: "相楽郡南山城村",
    raw: "京都府 相楽郡 南山城村",
    lat: 34.778164,
    lng: 136.00592,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "京都府相楽郡南山城村",
  },
  masui: {
    supplier: "ますいさんちの茶　益井園",
    prefecture: "静岡県",
    area: "榛原郡川根本町",
    raw: "静岡県 榛原郡 川根本町",
    lat: 35.086945,
    lng: 138.120773,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "静岡県榛原郡川根本町",
  },
  mitocha: {
    supplier: "みとちゃ農園",
    prefecture: "奈良県",
    area: "山添村",
    raw: "奈良県 山添村",
    // Regions は「山添村」だが正式には山辺郡山添村。geoTitle は郡名込みで持つ。
    lat: 34.684731,
    lng: 135.973053,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "奈良県山辺郡山添村",
  },
  chiyonoen: {
    supplier: "お茶の千代乃園",
    prefecture: "福岡県",
    area: "八女市",
    raw: "福岡県 八女市",
    // 八女市は 2010 年の合併で東西に長い。旧値 (33.21141, 130.55804) は
    // 市役所 (西端の平地) で、産地のある東部山間からは 25km 以上ずれていた。
    lat: 33.162601,
    lng: 130.835953,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "福岡県八女市",
  },
  kajihara: {
    supplier: "お茶のカジハラ",
    prefecture: "熊本県",
    area: "葦北郡芦北町",
    raw: "熊本県 葦北郡芦北町",
    lat: 32.263771,
    lng: 130.581467,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "熊本県葦北郡芦北町",
  },
  "miyazaki-sabo": {
    supplier: "宮崎茶房",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    // 緑碧茶園 五ヶ瀬茶園 と同一座標。**別会社で番地も別だが**、無料の
    // ジオコーダでは大字の代表点までしか解決できないため同値になる。
    // これは正しい状態であって不具合ではない (地図側で 1 点に畳まれる)。
    // 見た目のためにずらすと地図が事実でなくなるので、ずらさない。
    lat: 32.722046,
    lng: 131.222107,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  sakaguchi: {
    supplier: "お茶の坂口園",
    prefecture: "熊本県",
    area: "水俣市",
    raw: "熊本県 水俣市",
    lat: 32.147873,
    lng: 130.446335,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "熊本県水俣市",
  },
  "tsushima-oishi": {
    supplier: "つしま大石農園",
    prefecture: "長崎県",
    area: "対馬市上県町",
    raw: "長崎県 対馬市 上県町",
    // 対馬は南北に約 80km あり、市の重心 (旧値 34.20277) は島の南部を指して
    // 産地から約 45km 外れていた。調査値は島北部の上県町側に落ちる。
    lat: 34.607712,
    lng: 129.353561,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "長崎県対馬市上県町",
  },
  hasama: {
    supplier: "ハサマ共同製茶組合",
    prefecture: "三重県",
    area: "四日市市川島町",
    raw: "三重県 四日市市 川島町",
    lat: 34.968712,
    lng: 136.549942,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "三重県四日市市川島町",
  },
  yoshida: {
    supplier: "吉田茶園",
    prefecture: "茨城県",
    area: "古河市",
    raw: "茨城県 古河市",
    lat: 36.176147,
    lng: 139.715469,
    precision: "area",
    coordSource: "survey-2026-08",
    geoQuery: null,
    geoTitle: "茨城県古河市",
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

/** 産地が判定できなかったときの値。地図には打たず、確認対象として数える。 */
const UNKNOWN_ORIGIN: TeaOrigin = {
  prefecture: null,
  area: null,
  raw: null,
  lat: null,
  lng: null,
  precision: "none",
  geoTitle: null,
  needsReview: true,
};

/** 日本国内の緯度経度の範囲 (南鳥島・与那国島・沖ノ鳥島を含む外接矩形)。 */
const JAPAN_LAT_RANGE = [24, 46] as const;
const JAPAN_LNG_RANGE = [122, 154] as const;

/** 日本国内の座標として妥当かを判定する。範囲外は取り違えとみなし採用しない。 */
function isInJapan(lat: number, lng: number): boolean {
  return (
    lat >= JAPAN_LAT_RANGE[0] &&
    lat <= JAPAN_LAT_RANGE[1] &&
    lng >= JAPAN_LNG_RANGE[0] &&
    lng <= JAPAN_LNG_RANGE[1]
  );
}

/**
 * 銘柄番号から産地を引く。
 *
 * 未知の番号 (対応表に無い / 5 桁でない) は推測せず `needsReview: true` を返す。
 * 地図側は `lat === null` の銘柄を「打たない」で扱えばよく、
 * 例外を投げないのは 1 件の欠損で地図全体が落ちるのを避けるため。
 */
export function resolveTeaOrigin(menuNumber: string): TeaOrigin {
  const key = TEA_ORIGIN_BY_NUMBER[menuNumber as TeaMenuNumber];
  if (!key) return UNKNOWN_ORIGIN;

  const source = ORIGIN_SOURCES[key];
  // 正本 (Notion) 側で Prefecture が空 / 国外の場合に備えて必ず検証する。
  // ここを素通しにすると地図の結合キーに未知の文字列が混じる。
  const prefecture = isPrefecture(source.prefecture) ? source.prefecture : null;

  // 座標も同様に範囲検証する。桁の打ち間違い (緯度と経度の取り違え等) を
  // 地図に届く前に落とすため、疑わしい値は採用せず null 扱いにする。
  const hasCoords =
    source.lat !== null && source.lng !== null && isInJapan(source.lat, source.lng);

  return {
    prefecture,
    area: source.area,
    raw: source.raw,
    lat: hasCoords ? source.lat : null,
    lng: hasCoords ? source.lng : null,
    precision: hasCoords ? source.precision : "none",
    geoTitle: hasCoords ? source.geoTitle : null,
    needsReview: prefecture === null || !hasCoords,
  };
}

/**
 * 銘柄番号から表示用の産地名を作る (「静岡県 静岡市」)。
 *
 * 都道府県しか分からなければ都道府県だけを返し、どちらも無ければ `null`。
 * 表示側で毎回 `[prefecture, area].filter(Boolean).join(" ")` を書くと
 * 区切り方が面ごとにずれるので、繋ぎ方はここに 1 つだけ持つ。
 * この値を i18n しないのは、中身が正本 (Notion) の日本語の固有名詞そのもので、
 * 訳語を持たないため (英語面でも地名は日本語表記のまま出す)。
 */
export function resolveTeaOriginPlace(menuNumber: string): string | null {
  const { prefecture, area } = resolveTeaOrigin(menuNumber);
  const place = [prefecture, area].filter(Boolean).join(" ");
  return place || null;
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

/** 地図に打つ 1 点。Mapbox のマーカー / GeoJSON feature の元になる。 */
export interface TeaOriginPoint {
  menuNumber: string;
  prefecture: Prefecture;
  area: string | null;
  lat: number;
  lng: number;
  precision: OriginPrecision;
}

/**
 * 飲んだ銘柄の一覧から、地図に打つ点を作る。
 *
 * 同じ産地の銘柄が複数あっても **1 点に畳む** (同じ座標にピンが重なるのを避ける)。
 * 座標の無い銘柄は黙って捨てる — 1 件の欠損で地図が壊れないようにするため。
 * `menuNumber` は畳んだうちの最初の 1 件で、点の代表として持たせている。
 */
export function teaOriginPoints(menuNumbers: readonly string[]): TeaOriginPoint[] {
  const byCoord = new Map<string, TeaOriginPoint>();
  for (const menuNumber of menuNumbers) {
    const o = resolveTeaOrigin(menuNumber);
    if (o.lat === null || o.lng === null || o.prefecture === null) continue;
    const coordKey = `${o.lat},${o.lng}`;
    if (byCoord.has(coordKey)) continue;
    byCoord.set(coordKey, {
      menuNumber,
      prefecture: o.prefecture,
      area: o.area,
      lat: o.lat,
      lng: o.lng,
      precision: o.precision,
    });
  }
  return [...byCoord.values()];
}

/** 座標の粒度ごとの銘柄数。棚卸し・データ品質の確認用。 */
export function originPrecisionBreakdown(): Record<OriginPrecision, number> {
  const breakdown: Record<OriginPrecision, number> = {
    area: 0,
    prefecture: 0,
    none: 0,
  };
  for (const n of TEA_MENU_NUMBERS) {
    breakdown[resolveTeaOrigin(n).precision] += 1;
  }
  return breakdown;
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

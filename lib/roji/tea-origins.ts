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
 * ## 緯度経度の正本 (2026-08-12 二重管理を解消)
 *
 * **座標の正本は Notion Supplier List の `Place` プロパティ** (place 型) である。
 * 12 軒すべてに緯度経度が入っている。`Place` は SQL クエリ (query_data_sources)
 * では取得できず、各仕入先ページを個別に fetch すると
 * `place:Place:latitude` / `place:Place:longitude` / `place:Place:name` として返る。
 * 初版に「Notion 側に座標は無い」と書かれていたが、それは SQL で見えなかった
 * だけで **誤り**。この取り違えが座標 2 系統 (Notion / GSI) の二重管理を生んだ。
 *
 * 国土地理院 (GSI) の住所検索 API は **当初の取得手段であって正本ではない**。
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=<地名>
 * 初版はここから座標を引いていたが、正本と食い違う 2 系統目になるため
 * Notion 側へ寄せた。
 *
 * 2 系統を突き合わせた結果 (距離は Haversine):
 *   - 12 軒中 10 軒は **26m 以内で一致**。どちらも同じ市町村名を geocode した
 *     結果なので実質同一。正本 (Notion) を採用。
 *   - `hasama` のみ 1.3km ずれる。ただし両者とも「三重県四日市市川島町」に
 *     解決しており、同じ町の代表点の取り方が違うだけ。町の広がりに収まるので
 *     `precision: "area"` の粒度として許容し、正本 (Notion) を採用。
 *   - `tsushima-oishi` のみ **GSI を残した** (唯一の例外)。理由は当該エントリの
 *     コメントを参照。
 *
 * 各エントリの `coordSource` がどちら由来かを持ち、`geoTitle` はその座標に
 * 紐づく地点の正式名称 (どこに解決されたかの根拠) を原文のまま残している。
 *
 * **Notion 側で `Place` が変われば、ここは自動では追随しない。** 仕入先の所在地が
 * 更新されたら本ファイルも手で更新する必要がある (恒久策は「将来の移行」を参照)。
 *
 * 座標は **推測で作らない**。正本にも GSI にも無い地名は `lat`/`lng` を `null` に
 * し `needsReview: true` を立てる (地図に打たず、確認対象として数える)。
 *
 * ## 将来の移行
 *
 * このファイルは **暫定の写し** であって正本ではない。Notion 側で仕入先の
 * Prefecture / Regions / Place が変われば、ここは自動では追随しない。恒久策は
 * `scripts/sync-notion-to-sanity.ts` に teaMenu の同期を足し、
 * Supplier の Prefecture / Regions / **Place (緯度経度)** を Sanity の構造化
 * フィールドへ流し込むこと。同期を書くときは `Place` が SQL で取れない点に注意
 * (仕入先ページを個別 fetch して `place:Place:*` を読む必要がある)。
 * それが入った時点でこのファイルは削除し、参照を Sanity クエリへ差し替える。
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
   * 座標の出どころ。既定は正本の `notion-place`。
   * `gsi` は正本の値が明らかに劣るため例外的に国土地理院の値を残した軒で、
   * その理由を必ずエントリのコメントに書く (無言の例外を作らないため)。
   */
  coordSource: "notion-place" | "gsi";
  /**
   * 国土地理院に投げた地名 (再取得・検証用)。
   * `coordSource: "gsi"` の軒だけ持ち、正本由来の軒は `null`。
   */
  geoQuery: string | null;
  /**
   * 座標に紐づく地点の正式名称。
   * 正本由来の軒は Notion `Place` の name、GSI 由来の軒は GSI が返した title。
   */
  geoTitle: string | null;
}

/**
 * 産地の実体 (Notion Supplier List のスナップショット)。
 * `area` は `raw` の先頭から都道府県名を落として区切りスペースを詰めたもの。
 * `lat`/`lng` は 2026-08-12 に Notion `Place` から読んだ値をそのまま使う (丸めない)。
 * 例外は `tsushima-oishi` のみで、そこだけ GSI の値を残している (理由は当該コメント)。
 */
const ORIGIN_SOURCES = {
  shibakiri: {
    supplier: "しばきり園",
    prefecture: "静岡県",
    area: "静岡市",
    raw: "静岡県 静岡市",
    // 静岡市は政令市で市域が広く、この座標は市全体の代表点。
    lat: 34.97516,
    lng: 138.38324,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "静岡県静岡市",
  },
  "ryokuheki-gokase": {
    supplier: "緑碧茶園 五ヶ瀬茶園",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    lat: 32.68345,
    lng: 131.19693,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  nakakubo: {
    supplier: "中窪製茶園",
    prefecture: "京都府",
    area: "相楽郡南山城村",
    raw: "京都府 相楽郡 南山城村",
    lat: 34.77275,
    lng: 135.99359,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "京都府相楽郡南山城村",
  },
  masui: {
    supplier: "ますいさんちの茶　益井園",
    prefecture: "静岡県",
    area: "榛原郡川根本町",
    raw: "静岡県 榛原郡 川根本町",
    lat: 35.04684,
    lng: 138.08192,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "静岡県榛原郡川根本町",
  },
  mitocha: {
    supplier: "みとちゃ農園",
    prefecture: "奈良県",
    area: "山添村",
    raw: "奈良県 山添村",
    // Regions は「山添村」だが正式には山辺郡山添村。Notion `Place` の name も
    // 郡名込みで入っているので、そちらを geoTitle に採る。
    lat: 34.68088,
    lng: 136.04343,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "奈良県山辺郡山添村",
  },
  chiyonoen: {
    supplier: "お茶の千代乃園",
    prefecture: "福岡県",
    area: "八女市",
    raw: "福岡県 八女市",
    lat: 33.21141,
    lng: 130.55804,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "福岡県八女市",
  },
  kajihara: {
    supplier: "お茶のカジハラ",
    prefecture: "熊本県",
    area: "葦北郡芦北町",
    raw: "熊本県 葦北郡芦北町",
    lat: 32.29897,
    lng: 130.49309,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "熊本県葦北郡芦北町",
  },
  "miyazaki-sabo": {
    supplier: "宮崎茶房",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    // 緑碧茶園 五ヶ瀬茶園 と同一町。別の仕入先だが Notion `Place` も同値なので
    // 座標は同じ地域代表点になる (地図側で 1 点に畳まれる)。
    lat: 32.68345,
    lng: 131.19693,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  sakaguchi: {
    supplier: "お茶の坂口園",
    prefecture: "熊本県",
    area: "水俣市",
    raw: "熊本県 水俣市",
    lat: 32.21181,
    lng: 130.40858,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "熊本県水俣市",
  },
  "tsushima-oishi": {
    supplier: "つしま大石農園",
    prefecture: "長崎県",
    area: "対馬市上県町",
    raw: "長崎県 対馬市 上県町",
    // === 正本 (Notion `Place`) を採らない唯一の例外 ===
    // Notion `Place` は「長崎県対馬市」= 市全体の重心 (34.20277, 129.28751) で、
    // 旧町 (上県町) まで降りていない。対馬は南北に約 80km あるため、市の重心は
    // 島の南部 (旧厳原町あたり) を指し、島北部にある当該産地から大きく外れる。
    // 実測: 正本の点は産地の大字 (上県町佐護) から約 45km、GSI の点は約 5km。
    // 「県庁所在地レベルに丸められている」に相当する劣化なので、ここだけ GSI の
    // 上県町の代表点を残す。Notion 側の `Place` が上県町まで絞られたら追随する。
    lat: 34.566456,
    lng: 129.333176,
    precision: "area",
    coordSource: "gsi",
    geoQuery: "長崎県対馬市上県町",
    geoTitle: "長崎県対馬市上県町伊奈",
  },
  hasama: {
    supplier: "ハサマ共同製茶組合",
    prefecture: "三重県",
    area: "四日市市川島町",
    raw: "三重県 四日市市 川島町",
    // 正本と GSI が 1.3km ずれる唯一の軒。ただし両者とも「三重県四日市市川島町」
    // に解決しており、同じ町の代表点の取り方が違うだけ (町の広がりの中に収まる)。
    // どちらが劣るとは言えないので単一正本の原則どおり Notion を採る。
    lat: 34.97434,
    lng: 136.56266,
    precision: "area",
    coordSource: "notion-place",
    geoQuery: null,
    geoTitle: "三重県四日市市川島町",
  },
  yoshida: {
    supplier: "吉田茶園",
    prefecture: "茨城県",
    area: "古河市",
    raw: "茨城県 古河市",
    lat: 36.1782,
    lng: 139.75491,
    precision: "area",
    coordSource: "notion-place",
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

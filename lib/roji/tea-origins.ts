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
 * ## 緯度経度の出どころ
 *
 * Notion 側に座標は無い (Place 型の `Place` プロパティは全件空)。よって座標は
 * **国土地理院 (GSI) の住所検索 API** から取得した公開データを使う。
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=<地名>
 * 問い合わせたのは `raw` から組み立てた **地名だけ** (仕入先名・番地は送っていない)。
 * 各エントリの `geoTitle` は GSI が返した正式名称で、どの地点に解決されたかを
 * 後から検証できるように原文のまま残している。
 *
 * 座標は **推測で作らない**。GSI が解決できない地名は `lat`/`lng` を `null` にし
 * `needsReview: true` を立てる (地図に打たず、確認対象として数える)。
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
   * 国土地理院の住所検索が返した正式名称。どの地点に解決されたかの根拠。
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
  /** 国土地理院に投げた地名 (再取得・検証用)。 */
  geoQuery: string | null;
  /** 国土地理院が返した正式名称。 */
  geoTitle: string | null;
}

/**
 * 産地の実体 (Notion Supplier List のスナップショット + GSI の座標)。
 * `area` は `raw` の先頭から都道府県名を落として区切りスペースを詰めたもの。
 * `lat`/`lng` は 2026-08-12 に GSI 住所検索から取得した値をそのまま使う (丸めない)。
 */
const ORIGIN_SOURCES = {
  shibakiri: {
    supplier: "しばきり園",
    prefecture: "静岡県",
    area: "静岡市",
    raw: "静岡県 静岡市",
    // 静岡市は政令市で市域が広く、この座標は市全体の代表点。
    lat: 34.975185,
    lng: 138.383286,
    precision: "area",
    geoQuery: "静岡県静岡市",
    geoTitle: "静岡県静岡市",
  },
  "ryokuheki-gokase": {
    supplier: "緑碧茶園 五ヶ瀬茶園",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    lat: 32.68338,
    lng: 131.196915,
    precision: "area",
    geoQuery: "宮崎県西臼杵郡五ヶ瀬町",
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  nakakubo: {
    supplier: "中窪製茶園",
    prefecture: "京都府",
    area: "相楽郡南山城村",
    raw: "京都府 相楽郡 南山城村",
    lat: 34.772709,
    lng: 135.993774,
    precision: "area",
    geoQuery: "京都府相楽郡南山城村",
    geoTitle: "京都府相楽郡南山城村",
  },
  masui: {
    supplier: "ますいさんちの茶　益井園",
    prefecture: "静岡県",
    area: "榛原郡川根本町",
    raw: "静岡県 榛原郡 川根本町",
    lat: 35.046944,
    lng: 138.081665,
    precision: "area",
    geoQuery: "静岡県榛原郡川根本町",
    geoTitle: "静岡県榛原郡川根本町",
  },
  mitocha: {
    supplier: "みとちゃ農園",
    prefecture: "奈良県",
    area: "山添村",
    raw: "奈良県 山添村",
    // Regions は「山添村」だが正式には山辺郡山添村。GSI には郡名込みで問い合わせた。
    lat: 34.680874,
    lng: 136.043472,
    precision: "area",
    geoQuery: "奈良県山辺郡山添村",
    geoTitle: "奈良県山辺郡山添村",
  },
  chiyonoen: {
    supplier: "お茶の千代乃園",
    prefecture: "福岡県",
    area: "八女市",
    raw: "福岡県 八女市",
    lat: 33.211426,
    lng: 130.558151,
    precision: "area",
    geoQuery: "福岡県八女市",
    geoTitle: "福岡県八女市",
  },
  kajihara: {
    supplier: "お茶のカジハラ",
    prefecture: "熊本県",
    area: "葦北郡芦北町",
    raw: "熊本県 葦北郡芦北町",
    lat: 32.299034,
    lng: 130.493118,
    precision: "area",
    geoQuery: "熊本県葦北郡芦北町",
    geoTitle: "熊本県葦北郡芦北町",
  },
  "miyazaki-sabo": {
    supplier: "宮崎茶房",
    prefecture: "宮崎県",
    area: "西臼杵郡五ヶ瀬町",
    raw: "宮崎県 西臼杵郡五ヶ瀬町",
    // 緑碧茶園 五ヶ瀬茶園 と同一町。別の仕入先だが座標は同じ地域代表点になる。
    lat: 32.68338,
    lng: 131.196915,
    precision: "area",
    geoQuery: "宮崎県西臼杵郡五ヶ瀬町",
    geoTitle: "宮崎県西臼杵郡五ヶ瀬町",
  },
  sakaguchi: {
    supplier: "お茶の坂口園",
    prefecture: "熊本県",
    area: "水俣市",
    raw: "熊本県 水俣市",
    lat: 32.211784,
    lng: 130.4086,
    precision: "area",
    geoQuery: "熊本県水俣市",
    geoTitle: "熊本県水俣市",
  },
  "tsushima-oishi": {
    supplier: "つしま大石農園",
    prefecture: "長崎県",
    area: "対馬市上県町",
    raw: "長崎県 対馬市 上県町",
    // 上県町は対馬市の旧町で GSI に単独の重心が無く、大字単位で複数返る。
    // 先頭の「伊奈」を旧町域の代表点として採用した (対馬市の重心だと
    // 島が南北に長いぶん実際の産地から離れるため)。
    lat: 34.566456,
    lng: 129.333176,
    precision: "area",
    geoQuery: "長崎県対馬市上県町",
    geoTitle: "長崎県対馬市上県町伊奈",
  },
  hasama: {
    supplier: "ハサマ共同製茶組合",
    prefecture: "三重県",
    area: "四日市市川島町",
    raw: "三重県 四日市市 川島町",
    lat: 34.968712,
    lng: 136.549942,
    precision: "area",
    geoQuery: "三重県四日市市川島町",
    geoTitle: "三重県四日市市川島町",
  },
  yoshida: {
    supplier: "吉田茶園",
    prefecture: "茨城県",
    area: "古河市",
    raw: "茨城県 古河市",
    lat: 36.178242,
    lng: 139.75502,
    precision: "area",
    geoQuery: "茨城県古河市",
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

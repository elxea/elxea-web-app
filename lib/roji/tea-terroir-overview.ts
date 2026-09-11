/**
 * お茶リストの先頭に置くテロワール地図のデータ層。
 *
 * ## 単品詳細の地図と何が違うのか
 *
 * | | 単品詳細「土地を読む」 | 一覧のテロワール地図 |
 * |---|---|---|
 * | 見せる範囲 | その産地 1 か所 | **表示中のメニュー群の産地すべて** |
 * | 尺度 | 産地ごとに固定 (`TERROIR_SPAN_LNG`) | **産地全体が収まるよう自動フィット** |
 * | 追従 | しない | **フィルタで表示が変わると尺度も変わる** |
 * | 色 | レンズごとの段彩 | 点の色 = お茶のカテゴリー |
 *
 * 単品詳細の尺度は変えない (土地の襞が見える縮尺が意味を持つため)。
 * ここが動的なのは、一覧の地図が「いま何を見ているか」の縮図だからである。
 *
 * ## 座標をどう引くか (推測はしない)
 *
 * 1. 銘柄番号が 5 桁採番なら `resolveTeaOrigin` (Notion Supplier List の実測座標)
 * 2. でなければ `teaMenu.origin` の自由記述から都道府県を拾って代表点に落とす
 *    (`resolveTeaOriginByPlaceText`。粒度は `prefecture` 止まり)
 * 3. どちらでも引けなければ **地図に出さない**。適当な座標で埋めない
 *
 * 3 の結果として、地図に立つ点は一覧の件数より少なくなることがある。
 * これは欠損であって不具合ではないので、地図の外に「n 件のうち m 件」のような
 * 数字は出さない (roji は数値を出さない)。
 *
 * ## 色はカテゴリー (恒久ルール)
 *
 * 点の色はお茶のカテゴリーを表す (`docs/roji-dataviz-rules.md`)。
 * カテゴリーで絞り込めば地図も単色になり、絞り込みが図の上で読める。
 */

import {
  teaCategoryOf,
  type TeaCategory,
} from "@/lib/roji/tea-category";
import {
  resolveTeaOrigin,
  resolveTeaOriginByPlaceText,
  type OriginPrecision,
} from "@/lib/roji/tea-origins";

/** 地図に渡す 1 件。ページ側の型 (Sanity) に依存させないための最小形。 */
export interface TerroirOverviewItem {
  /** 一意な鍵 (Sanity `_id` 等)。 */
  id: string;
  /** 銘柄番号。5 桁採番なら実測座標が引ける。 */
  menuNumber?: string | number | null;
  /** Sanity `teaMenu.origin` の自由記述。 */
  origin?: string | null;
  /** Sanity `teaMenu.category` の生値。 */
  category?: string | null;
}

/** 地図に立つ 1 点。同じ座標の銘柄は 1 点に畳む。 */
export interface TerroirOverviewPin {
  id: string;
  lat: number;
  lng: number;
  /** 画面に出す土地の名 (都道府県 + 市町村 or 都道府県のみ)。 */
  place: string;
  /** 色を決める唯一の値。 */
  category: TeaCategory;
  /** 座標の粒度。県止まりの点は小さく・淡く出す。 */
  precision: OriginPrecision;
  /** この点に畳まれた銘柄の数。大きさに使う (数字としては出さない)。 */
  count: number;
}

export interface TerroirOverviewBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface TerroirOverviewData {
  pins: readonly TerroirOverviewPin[];
  /** 全ての点が収まる矩形。地図はこれに合わせる。 */
  bounds: TerroirOverviewBounds;
  /** 矩形の中心。点が 1 つのときの中心でもある。 */
  center: { lng: number; lat: number };
  /**
   * 図に載っているカテゴリー。1 つなら地図は単色になる。
   * 一覧のカテゴリー絞り込みと一致するので、凡例をここから組める。
   */
  categories: readonly TeaCategory[];
}

/**
 * 点が 1 つ (あるいは全部が同じ座標) のときに使う最小の広がり (度)。
 *
 * 0 幅の矩形をそのまま `fitBounds` に渡すと最大ズームまで寄り、
 * 地形が見えない「灰色の面」になる。1 点でも土地の襞が見える程度に開く。
 * 単品詳細の `TERROIR_SPAN_LNG` (0.3068) より広いのは、一覧の地図が
 * 「どのあたりの土地か」を示す図で、襞の細部を読む図ではないため。
 */
export const OVERVIEW_MIN_SPAN_LNG = 0.9;
/** 縦方向の最小の広がり (度)。経度より狭いのは緯度 1 度のほうが長いため。 */
export const OVERVIEW_MIN_SPAN_LAT = 0.6;

/** 矩形の縁に足す余白 (広がりに対する比)。点が枠の縁に貼り付くのを防ぐ。 */
const BOUNDS_PADDING_RATIO = 0.18;

/**
 * 表示中のメニュー群からテロワール地図のデータを組む。
 *
 * 座標が 1 件も引けなければ `null` を返す (地図ごと出さない)。
 * 空の枠を出すと「地図が壊れている」ように見えるため、
 * `TeaOriginBlock` と同じ方針にそろえる。
 */
export function terroirOverviewFor(
  items: readonly TerroirOverviewItem[]
): TerroirOverviewData | null {
  const byCoord = new Map<string, TerroirOverviewPin>();

  for (const item of items) {
    const byNumber =
      item.menuNumber === null || item.menuNumber === undefined
        ? null
        : resolveTeaOrigin(String(item.menuNumber));
    const origin =
      byNumber && byNumber.lat !== null && byNumber.lng !== null
        ? byNumber
        : resolveTeaOriginByPlaceText(item.origin);

    if (origin.lat === null || origin.lng === null) continue;

    const category = teaCategoryOf(item.menuNumber, item.category);
    // 同じ座標でもカテゴリーが違えば別の点にする — 色がカテゴリーを表すので、
    // 畳んでしまうと「どちらの色で出すか」が決まらなくなる。
    const key = `${origin.lat},${origin.lng},${category}`;
    const existing = byCoord.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    byCoord.set(key, {
      id: item.id,
      lat: origin.lat,
      lng: origin.lng,
      place: [origin.prefecture, origin.area].filter(Boolean).join(" "),
      category,
      precision: origin.precision,
      count: 1,
    });
  }

  const pins = [...byCoord.values()];
  if (pins.length === 0) return null;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const pin of pins) {
    if (pin.lng < west) west = pin.lng;
    if (pin.lng > east) east = pin.lng;
    if (pin.lat < south) south = pin.lat;
    if (pin.lat > north) north = pin.lat;
  }

  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;

  // 最小の広がりを保証してから、縁の余白を足す。順序が逆だと 1 点のときに
  // 余白が 0 に掛かって効かない。
  let spanLng = Math.max(east - west, OVERVIEW_MIN_SPAN_LNG);
  let spanLat = Math.max(north - south, OVERVIEW_MIN_SPAN_LAT);
  spanLng *= 1 + BOUNDS_PADDING_RATIO * 2;
  spanLat *= 1 + BOUNDS_PADDING_RATIO * 2;

  const categories = [...new Set(pins.map((pin) => pin.category))];

  return {
    pins,
    bounds: {
      west: centerLng - spanLng / 2,
      east: centerLng + spanLng / 2,
      south: centerLat - spanLat / 2,
      north: centerLat + spanLat / 2,
    },
    center: { lng: centerLng, lat: centerLat },
    categories,
  };
}

/**
 * データの同一性を判定するための鍵。
 *
 * 一覧はサーバーで render し直されるので、`terroirOverviewFor` の返り値は
 * 毎回別のオブジェクトになる。地図側が「本当に変わったか」を見るのに使う
 * (変わっていないのに `fitBounds` を撃つと、無意味な移動が毎回起きる)。
 */
export function terroirOverviewKey(data: TerroirOverviewData): string {
  return data.pins
    .map((pin) => `${pin.lat},${pin.lng},${pin.category},${pin.count}`)
    .sort()
    .join("|");
}

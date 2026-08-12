import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// .mjs のビルドスクリプト。検査ロジックの正本はスクリプト側にあり、テストが
// 写しを持つと二重管理になるので直接読む。
import { REQUIRED_ISLANDS, countVerticesInBbox } from "@/scripts/roji/build-japan-geo.mjs";

/** bbox は [west, south, east, north] の 4 要素固定 (build-japan-geo.mjs と同じ順)。 */
type Bbox = [number, number, number, number];
type RequiredIsland = { key: string; name: string; bbox: Bbox };

/**
 * 産地の地図が使う地形データ (`public/geo/`) の作り直し検査。
 *
 * ## なぜテストにするのか
 *
 * 生成物はコミットされていて、普段は誰も作り直さない。だからこそ
 * 「作り直したときに静かに壊れる」ことが最大のリスクになる。
 *
 * mapshaper の `keep-shapes` は multipart feature の **最大パートしか保証しない**。
 * 長崎県は対馬・壱岐・五島列島を 1 feature に持つので、`-explode` を挟み忘れた
 * まま簡略化すると **対馬が地図から消える**。消えても地図は「それらしく」描画
 * されるため、目視レビューでは通ってしまう。よって機械で見張る。
 *
 * 生成手順とその根拠: `scripts/roji/build-japan-geo.mjs`
 */

const GEO_DIR = path.join(process.cwd(), "public", "geo");

function readGeoJson(name: string) {
  const raw = readFileSync(path.join(GEO_DIR, name), "utf8");
  return { raw, json: JSON.parse(raw) };
}

const land = readGeoJson("jp-land.geojson");
const pref = readGeoJson("jp-pref-borders.geojson");

describe("jp-land.geojson (陸地・海岸線)", () => {
  it("MapLibre の geojson ソースが前提とする FeatureCollection である", () => {
    expect(land.json.type).toBe("FeatureCollection");
    expect(Array.isArray(land.json.features)).toBe(true);
    expect(land.json.features.length).toBeGreaterThan(0);
  });

  it.each(REQUIRED_ISLANDS as RequiredIsland[])(
    "簡略化後も $name が残っている",
    ({ bbox }) => {
      const { rings } = countVerticesInBbox(land.json, bbox);
      expect(rings).toBeGreaterThan(0);
    },
  );

  it("本州 (静岡・駿河湾) の輪郭を持つ — 品目ページの既定の画角", () => {
    const { rings } = countVerticesInBbox(land.json, [137.5, 34.5, 139.2, 35.5]);
    expect(rings).toBeGreaterThan(0);
  });
});

describe("jp-pref-borders.geojson (県境)", () => {
  it("FeatureCollection である", () => {
    expect(pref.json.type).toBe("FeatureCollection");
    expect(pref.json.features.length).toBeGreaterThan(0);
  });

  it("内側の境界だけを持つ (線が 2 本という仕様の担保)", () => {
    // -innerlines の出力は線分。ポリゴンが混じっていると県ごとに海岸線が
    // 二重に引かれ、stone 100% の線と stone 40% の線が同じ場所に重なる。
    for (const feature of pref.json.features) {
      expect(["LineString", "MultiLineString"]).toContain(feature.geometry.type);
    }
  });
});

describe("配信サイズ", () => {
  /**
   * 地図が読み込む静的ファイルの合計。maplibre-gl 本体 (gzip 271KB) に対して
   * 地形データが同じ桁に膨らむと「軽いから静的 GeoJSON で足りる」という
   * 選定の前提が崩れるので上限を置く。
   */
  it("陸 + 県境の生バイトが合わせて 200KB 未満", () => {
    const totalKb = (
      Buffer.byteLength(land.raw) + Buffer.byteLength(pref.raw)
    ) / 1024;
    expect(totalKb).toBeLessThan(200);
  });
});

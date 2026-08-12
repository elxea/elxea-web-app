#!/usr/bin/env node
/**
 * 産地の地図が使う地形データ (陸地 + 県境) を Natural Earth 10m から作る。
 *
 * ## なぜタイルサーバーではなく静的 GeoJSON か
 *
 * デザイン仕様 (Figma node 8221:24) で地図に残す要素は 3 つだけ — 陸のかたち・
 * 県の区切り・産地の点。道路・地名・建物のベクタータイルは 1 バイトも要らない。
 * 必要なのが「日本の陸地ポリゴン」と「都道府県境界」の 2 レイヤーだけなので、
 * MapLibre の geojson ソースに静的ファイルを渡すだけで成立する。
 *
 * ## なぜ Natural Earth か
 *
 * パブリックドメインで帰属表示すら不要。「文字を地図に重ねない」という
 * デザイン原則と衝突しない唯一の候補だった (次点の国土数値情報は CC BY 4.0 で
 * 国交省指定書式のクレジットが必須)。選定の全比較は下記 Planning を参照。
 * https://www.notion.so/3ba70c9d064c817e8d29fc622f5c4dbd
 *
 * ## 陸だけ日本視点版 (admin_0_countries_jpn) を使う理由
 *
 * Natural Earth の既定版は北方領土をロシア領、竹島を収録なしとして持つ。
 * 日本向けの消費者プロダクトで北方領土が「陸ごと消える」のは避けたいので、
 * 陸レイヤーは国別視点版 (jpn) を使う。県境は admin_1 から取るが、両者の
 * 海岸線ジオメトリは一致することが実測で確認済みなので混在させても線はズレない。
 *
 * ## 離島が消える罠 (このスクリプトの存在理由の半分)
 *
 * mapshaper の `keep-shapes` の仕様は「multipart feature では **最大の bbox を
 * 持つパートだけ** を保証する」。長崎県は対馬・壱岐・五島列島を 1 feature に
 * 持つため、素直に `-simplify keep-shapes` すると対馬が消えうる。
 * よって **`-explode` を先に適用して各島を独立 feature にしてから** 簡略化し、
 * そのあと `-dissolve` で 1 つに戻す。
 * 生成後は主要離島の存在を bbox 包含判定で機械検査し、1 つでも欠けたら異常終了する
 * (検査は `__tests__/roji-japan-geo.test.ts` でも回るので CI でも落ちる)。
 *
 * ## 使い方
 *
 *   node scripts/roji/build-japan-geo.mjs
 *
 * ソース GeoJSON は `.cache/natural-earth/` に落として再利用する (gitignore 済み)。
 * 出力は `public/geo/` にコミットする — ビルド時にネットワークへ出ないようにするため。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = join(ROOT, ".cache/natural-earth");
const OUT_DIR = join(ROOT, "public/geo");

const NE_BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

/** 簡略化率。20% ≒ Douglas-Peucker 約 200m 相当。 */
const SIMPLIFY = "20%";
/** 座標の小数桁。0.0001 度 ≒ 11m。表示縮尺 (1px ≒ 800m) に対して十分細かい。 */
const PRECISION = "0.0001";

const SOURCES = [
  {
    name: "ne_10m_admin_0_countries_jpn.geojson",
    purpose: "陸地・海岸線 (日本視点版)",
  },
  {
    name: "ne_10m_admin_1_states_provinces.geojson",
    purpose: "県境",
  },
];

/**
 * 生成物に必ず残っていなければならない離島。
 * bbox は島を確実に含み、かつ隣の陸地を拾わない大きさに取ってある。
 * 対馬は「素直に簡略化すると消える」代表例なので必ず先頭に置く。
 */
export const REQUIRED_ISLANDS = [
  { key: "tsushima", name: "対馬", bbox: [129.15, 34.05, 129.55, 34.75] },
  { key: "iki", name: "壱岐", bbox: [129.6, 33.7, 129.85, 33.9] },
  { key: "goto", name: "五島列島", bbox: [128.5, 32.5, 129.2, 33.3] },
  { key: "okinawa", name: "沖縄本島", bbox: [127.6, 26.0, 128.4, 26.9] },
  { key: "sado", name: "佐渡", bbox: [138.0, 37.7, 138.6, 38.4] },
  { key: "oki", name: "隠岐", bbox: [132.6, 35.9, 133.4, 36.4] },
  { key: "tanegashima", name: "種子島", bbox: [130.8, 30.3, 131.2, 30.9] },
  { key: "yakushima", name: "屋久島", bbox: [130.3, 30.2, 130.7, 30.5] },
  { key: "awaji", name: "淡路島", bbox: [134.7, 34.2, 135.1, 34.6] },
  { key: "amakusa", name: "天草下島", bbox: [129.9, 32.2, 130.3, 32.7] },
];

function run(args) {
  return execFileSync("npx", ["--yes", "mapshaper@0.7.52", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 512,
  });
}

async function ensureSource({ name, purpose }) {
  const path = join(CACHE_DIR, name);
  if (existsSync(path) && statSync(path).size > 0) {
    console.log(`[cache] ${name} (${purpose})`);
    return path;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const url = `${NE_BASE}/${name}`;
  console.log(`[fetch] ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/** ポリゴン/マルチポリゴンの全リングを、リング単位の座標配列として吐く。 */
function* ringsOf(geometry) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    yield* geometry.coordinates;
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) yield* polygon;
  } else if (geometry.type === "LineString") {
    yield geometry.coordinates;
  } else if (geometry.type === "MultiLineString") {
    yield* geometry.coordinates;
  }
}

/**
 * bbox の中に頂点を持つリングを数える。
 *
 * 「島が残っているか」の判定に面積や重心ではなく頂点の有無を使うのは、
 * 簡略化で島が消えるときは feature ごと (= 頂点ごと) 消えるため。
 * 頂点が 1 つでも bbox 内にあれば、その島の輪郭は生き残っている。
 */
export function countVerticesInBbox(geojson, [west, south, east, north]) {
  let vertices = 0;
  let rings = 0;
  for (const feature of geojson.features ?? []) {
    for (const ring of ringsOf(feature.geometry)) {
      let hit = 0;
      for (const [lng, lat] of ring) {
        if (lng >= west && lng <= east && lat >= south && lat <= north) hit += 1;
      }
      if (hit > 0) {
        rings += 1;
        vertices += hit;
      }
    }
  }
  return { rings, vertices };
}

/** 末尾に改行が無ければ足す (pre-commit の end-of-file-fixer と揃えるため)。 */
function endWithNewline(path) {
  const raw = readFileSync(path);
  if (raw.length > 0 && raw[raw.length - 1] !== 0x0a) {
    writeFileSync(path, Buffer.concat([raw, Buffer.from("\n")]));
  }
}

function inspect(path) {
  const raw = readFileSync(path);
  const json = JSON.parse(raw.toString("utf8"));
  let vertices = 0;
  for (const feature of json.features ?? []) {
    for (const ring of ringsOf(feature.geometry)) vertices += ring.length;
  }
  return {
    json,
    bytes: raw.byteLength,
    gzip: gzipSync(raw, { level: 9 }).byteLength,
    features: (json.features ?? []).length,
    vertices,
    sha256: createHash("sha256").update(raw).digest("hex").slice(0, 12),
  };
}

async function main() {
  const [landSrc, prefSrc] = await Promise.all(SOURCES.map(ensureSource));
  mkdirSync(OUT_DIR, { recursive: true });

  const landOut = join(OUT_DIR, "jp-land.geojson");
  const prefOut = join(OUT_DIR, "jp-pref-borders.geojson");

  // 陸地 + 海岸線。-explode を -simplify より前に置くのが対馬対策の本体。
  console.log("[build] jp-land.geojson");
  run([
    landSrc,
    "-filter",
    'ADM0_A3 === "JPN"',
    "-explode",
    "-simplify",
    SIMPLIFY,
    "keep-shapes",
    "-dissolve",
    "-o",
    "format=geojson",
    // 属性を持たない出力に mapshaper は既定で GeometryCollection を吐くが、
    // MapLibre の geojson ソースは FeatureCollection を前提にしているので明示する。
    "geojson-type=FeatureCollection",
    `precision=${PRECISION}`,
    "force",
    landOut,
  ]);

  // 県境。-innerlines は「隣接県が共有する境界だけ」を残すので海岸線を含まない。
  // 県ポリゴンをそのまま線で描くと海岸線が県ごとに二重に引かれ、stone 100% の線と
  // stone 40% の線が同じ場所に重なる (デザイン仕様「線は 2 本だけ」が破綻する)。
  console.log("[build] jp-pref-borders.geojson");
  run([
    prefSrc,
    "-filter",
    'adm0_a3 === "JPN"',
    "-simplify",
    SIMPLIFY,
    "keep-shapes",
    "-innerlines",
    "-o",
    "format=geojson",
    "geojson-type=FeatureCollection",
    `precision=${PRECISION}`,
    "force",
    prefOut,
  ]);

  // mapshaper は末尾改行を書かないが、リポジトリの pre-commit
  // (end-of-file-fixer) は付ける。揃えておかないと作り直すたびに 1 バイトの
  // 差分が出て「変わっていないのに変わった」ように見える。
  endWithNewline(landOut);
  endWithNewline(prefOut);

  const land = inspect(landOut);
  const pref = inspect(prefOut);

  console.log("\n=== 生成物 ===");
  for (const [label, m] of [
    ["jp-land.geojson", land],
    ["jp-pref-borders.geojson", pref],
  ]) {
    console.log(
      `${label.padEnd(24)} features=${String(m.features).padStart(4)} ` +
        `vertices=${String(m.vertices).padStart(6)} ` +
        `raw=${String(Math.round(m.bytes / 1024)).padStart(4)}KB ` +
        `gzip=${String(Math.round(m.gzip / 1024)).padStart(3)}KB sha=${m.sha256}`,
    );
  }
  console.log(
    `${"合計".padEnd(22)} gzip=${Math.round((land.gzip + pref.gzip) / 1024)}KB`,
  );

  console.log("\n=== 離島の存在検査 (簡略化後) ===");
  const missing = [];
  for (const island of REQUIRED_ISLANDS) {
    const { rings, vertices } = countVerticesInBbox(land.json, island.bbox);
    const ok = rings > 0;
    if (!ok) missing.push(island.name);
    console.log(
      `${ok ? "[OK]  " : "[FAIL]"} ${island.name.padEnd(8)} rings=${String(rings).padStart(2)} vertices=${String(vertices).padStart(4)}`,
    );
  }

  if (missing.length > 0) {
    console.error(`\n[FAIL] 簡略化で消えた島: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("\n[OK] 全ての必須離島が残存");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

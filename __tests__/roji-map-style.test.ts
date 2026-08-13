import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ITEM_MAP_SIZE,
  ITEM_MAP_ZOOM,
  LINE_WIDTH,
  MAPLIBRE_WORKER_URL,
  MAP_TOKEN_COLORS,
  PIN_TOP_PX,
  PREF_BORDER_OPACITY,
  centerForPin,
  mapColor,
  originMapStyle,
} from "@/lib/viz/map-style";
import {
  MAPLIBRE_PUBLIC_DIR,
  MAPLIBRE_WORKER_FILES,
} from "@/scripts/copy-maplibre-worker.mjs";
import {
  PIN_DOT_SIZE,
  PIN_RIM_WIDTH,
  pinOuterSize,
} from "@/components/viz/map/origin-pin";

/**
 * 産地の地図のスタイル。守るのは 4 つ。
 *
 * 1. **トークンと切れていないこと** — MapLibre に CSS 変数は渡せないので
 *    色は `dist/tokens.css` の写しになっている。トークンが動いたらここが落ちる
 * 2. **線が 2 本しか無いこと** — 道路・地名ラベル・地形を足したら落ちる。
 *    「地図ウィジェットにしない」という設計判断を機械で固定する
 * 3. **海を塗らないこと** — background が cream (ページの紙) のままであること
 * 4. **ピンが Figma の位置に来ること** — center の計算が上端 57px を満たす
 *
 * Figma 正本:
 * - 地図スタイル仕様 https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8221-24
 * - 品目ページ PC   https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-3
 * - 品目ページ SP   https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8229-26
 */

const TOKENS_CSS = readFileSync(
  path.join(process.cwd(), "dist", "tokens.css"),
  "utf8",
);

describe("トークンとの対応", () => {
  it("地図の色の実値は dist/tokens.css と一致する", () => {
    for (const [name, oklch] of Object.entries(MAP_TOKEN_COLORS)) {
      const match = TOKENS_CSS.match(
        new RegExp(
          `--color-brand-${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`,
        ),
      );
      expect(match, `token --color-brand-${name} が見つからない`).toBeTruthy();
      const [, l, c, h] = match as RegExpMatchArray;
      expect(oklch, `--color-brand-${name} の写しがずれている`).toEqual({
        l: Number(l),
        c: Number(c),
        h: Number(h),
      });
    }
  });

  it("mapColor は #rrggbb を返す (MapLibre は oklch を解釈できない)", () => {
    for (const name of Object.keys(MAP_TOKEN_COLORS)) {
      expect(mapColor(name as keyof typeof MAP_TOKEN_COLORS)).toMatch(
        /^#[0-9a-f]{6}$/,
      );
    }
  });
});

describe("originMapStyle", () => {
  const style = originMapStyle();

  it("レイヤーは 4 つだけ (紙・陸・県境・海岸線)", () => {
    expect(style.layers.map((l) => l.id)).toEqual([
      "paper",
      "land",
      "pref-border",
      "coastline",
    ]);
  });

  it("線は 2 本だけ — 海岸線 0.75px / 県境 0.5px 40%", () => {
    const lines = style.layers.filter((l) => l.type === "line");
    expect(lines).toHaveLength(2);

    const coastline = style.layers.find((l) => l.id === "coastline");
    expect(coastline?.paint).toMatchObject({
      "line-color": mapColor("stone"),
      "line-width": LINE_WIDTH.coastline,
    });
    // 海岸線に opacity を置かない = 100%。地図で最も強い線であることの担保。
    expect(coastline?.paint).not.toHaveProperty("line-opacity");

    expect(style.layers.find((l) => l.id === "pref-border")?.paint).toMatchObject({
      "line-color": mapColor("stone"),
      "line-opacity": PREF_BORDER_OPACITY,
      "line-width": LINE_WIDTH.prefBorder,
    });
  });

  it("海は塗らない — 地はページの紙 (cream) のまま", () => {
    const paper = style.layers.find((l) => l.id === "paper");
    expect(paper?.type).toBe("background");
    expect(paper?.paint).toMatchObject({ "background-color": mapColor("cream") });

    // 陸だけが sand。海に色を持つレイヤーがあってはいけない。
    expect(style.layers.find((l) => l.id === "land")?.paint).toMatchObject({
      "fill-color": mapColor("sand"),
    });
  });

  it("地名ラベルを描かないので glyphs を要求しない", () => {
    expect(style.glyphs).toBeUndefined();
    expect(style.layers.some((l) => l.type === "symbol")).toBe(false);
  });

  /**
   * MapLibre のスタイル検査はキーの **存在** を見るので、`glyphs: undefined` と
   * 「glyphs を書かない」は同じではない。前者は
   * `glyphs: string expected, undefined found` で検査に落ち、スタイルの読み込みが
   * そこで中止される — ソースが 1 本も取りに行かれず、地図は真っ白のままになる。
   *
   * 直前の `expect(style.glyphs).toBeUndefined()` は「キーが無い」と
   * 「キーはあるが値が undefined」を区別できず、実際にこの不具合を通した。
   * 省略可能なキーは値ではなく **キーの有無** で固定する。
   */
  it("省略可能なキーは undefined を代入せずキーごと省く", () => {
    for (const key of ["glyphs", "sprite"]) {
      expect(
        Object.keys(style),
        `${key}: undefined を代入すると MapLibre のスタイル検査が落ちる`,
      ).not.toContain(key);
    }
  });

  it("県境が海岸線より先に描かれる (重なる場所で強い線が勝つ)", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("pref-border")).toBeLessThan(ids.indexOf("coastline"));
  });

  it("ソースは静的 GeoJSON 2 本だけ — タイルサーバーを介さない", () => {
    expect(Object.keys(style.sources)).toEqual(["jp-land", "jp-pref"]);
    for (const source of Object.values(style.sources)) {
      expect(source.type).toBe("geojson");
      // 外部ホストを踏まない (ビルド時もランタイムも自前配信)。
      expect(String((source as { data: string }).data)).toMatch(/^\/geo\//);
    }
  });

  it("prefers-reduced-motion ではトランジションを 0 にする", () => {
    expect(originMapStyle({ reducedMotion: true }).transition).toEqual({
      duration: 0,
      delay: 0,
    });
    expect(style.transition).toEqual({ duration: 300, delay: 0 });
  });
});

describe("centerForPin", () => {
  /** Figma の 静岡・駿河湾 と同じ点 (しばきり園 = 静岡市)。 */
  const shizuoka = { lng: 138.38324, lat: 34.97516 };
  const TILE_SIZE = 512;

  /** 緯度 -> Web Mercator の正規化 y。検算用に独立実装する。 */
  function mercatorY(lat: number): number {
    const rad = (lat * Math.PI) / 180;
    return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
  }

  /** center と zoom から、ピンが上端から何 px に来るかを逆算する。 */
  function pinTopPxOf(
    center: { lng: number; lat: number },
    point: { lng: number; lat: number },
    zoom: number,
    height: number,
  ): number {
    const worldPx = TILE_SIZE * Math.pow(2, zoom);
    return height / 2 - (mercatorY(center.lat) - mercatorY(point.lat)) * worldPx;
  }

  it("PC (210px) でピンが上端から 57px に来る", () => {
    const center = centerForPin(shizuoka, {
      zoom: ITEM_MAP_ZOOM,
      height: ITEM_MAP_SIZE.pc.height,
    });
    expect(
      pinTopPxOf(center, shizuoka, ITEM_MAP_ZOOM, ITEM_MAP_SIZE.pc.height),
    ).toBeCloseTo(PIN_TOP_PX, 6);
  });

  it("SP (180px) でもピンが上端から 57px に来る (比率ではなく px 固定)", () => {
    const center = centerForPin(shizuoka, {
      zoom: ITEM_MAP_ZOOM,
      height: ITEM_MAP_SIZE.sp.height,
    });
    expect(
      pinTopPxOf(center, shizuoka, ITEM_MAP_ZOOM, ITEM_MAP_SIZE.sp.height),
    ).toBeCloseTo(PIN_TOP_PX, 6);
  });

  it("経度は動かさない (南北にだけずらす)", () => {
    const center = centerForPin(shizuoka, { zoom: ITEM_MAP_ZOOM, height: 210 });
    expect(center.lng).toBe(shizuoka.lng);
    // ピンを上に置く = center は点より南 (緯度が小さい)。
    expect(center.lat).toBeLessThan(shizuoka.lat);
  });
});

/**
 * MapLibre は GeoJSON の解析を Worker で行う。Worker が起動しないと
 * **枠と DOM のピンだけが出て陸・海岸線・県境が出ない** — Marker は DOM なので
 * Worker と無関係に描かれ、地図が壊れているように見えない。この見分けの付かなさが
 * 実際に調査を長引かせたので、配線を機械で固定する。
 *
 * 既定の Worker URL は `import.meta.url` から組み立てられるが、Turbopack は
 * これを自前の内部値に書き換えるため URL が空文字になる。よって
 * `setWorkerUrl` で `public/` の実体を指すのが唯一効く手段で、その実体は
 * `dev` / `build` の先頭で node_modules から複製される。
 * この 3 点 (URL の写し・複製・複製の起動) のどれが欠けても地図は白いままになる。
 */
describe("maplibre worker の配線", () => {
  it("setWorkerUrl に渡す URL が複製先と一致する", () => {
    expect(MAPLIBRE_WORKER_URL).toBe(
      `/${MAPLIBRE_PUBLIC_DIR}/${MAPLIBRE_WORKER_FILES[0]}`,
    );
  });

  it("worker と相方の shared を同じ場所へ複製する", () => {
    // worker は `./maplibre-gl-shared.mjs` を相対 import する。片方だけ置くと
    // worker は最初の import で落ち、症状は「複製し忘れ」と同じ白い地図になる。
    expect(MAPLIBRE_WORKER_FILES).toEqual([
      "maplibre-gl-worker.mjs",
      "maplibre-gl-shared.mjs",
    ]);
  });

  it("複製が dev と build の両方で走る", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const name of ["dev", "build"]) {
      expect(
        pkg.scripts[name],
        `${name}: 複製が走らないと public/maplibre が空になり地図が白いまま出る`,
      ).toContain("scripts/copy-maplibre-worker.mjs");
    }
  });

  it("複製物は git に入れない (node_modules と二重管理にしない)", () => {
    const gitignore = readFileSync(
      path.join(process.cwd(), ".gitignore"),
      "utf8",
    );
    expect(gitignore).toContain("public/maplibre/");
  });
});

describe("Figma 実測値との対応", () => {
  it("地図の寸法は PC 400x210 / SP 335x180", () => {
    expect(ITEM_MAP_SIZE.pc).toEqual({ width: 400, height: 210 });
    expect(ITEM_MAP_SIZE.sp).toEqual({ width: 335, height: 180 });
  });

  it("品目ページのピンは実点 ø7 + 縁 1.5px (外径 10px)", () => {
    expect(PIN_DOT_SIZE.item).toBe(7);
    expect(PIN_RIM_WIDTH).toBe(1.5);
    expect(pinOuterSize("item")).toBe(10);
  });

  it("生産者一覧のピンは ø5 のまま — 最も近い 2 軒の間に紙が残る", () => {
    // 11 点表示で最も近い 2 軒 (みとちゃ農園 / 中窪製茶園) の中心間距離。
    const CLOSEST_GAP_PX = 7.6;
    /** 点の縁どうしの隙間。ここが詰まると 2 軒が 1 つの点に見える。 */
    const paperBetween = (dot: number) => CLOSEST_GAP_PX - dot;

    expect(PIN_DOT_SIZE.producerList).toBe(5);
    expect(pinOuterSize("producerList")).toBe(8);
    // ø5 なら 2.6px の紙が残る。品目ページと同じ ø7 にすると 0.6px しか残らず
    // 2 軒が 1 点に潰れるので、こちらは上げられない。
    expect(paperBetween(PIN_DOT_SIZE.producerList)).toBeGreaterThanOrEqual(2);
    expect(paperBetween(PIN_DOT_SIZE.item)).toBeLessThan(2);
  });

  it("zoom はモック実描画を正本とした 7.35 (仕様テキストの 8.2 ではない)", () => {
    expect(ITEM_MAP_ZOOM).toBe(7.35);
  });
});

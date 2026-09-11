import { describe, expect, it } from "vitest";

import {
  AROMA_FAMILY_ORDER,
  aromaFieldFor,
} from "@/lib/roji/tea-aroma";
import { TEA_CATEGORY_ORDER } from "@/lib/roji/tea-category";
import { flavorMatrixFor } from "@/lib/roji/tea-flavor";
import {
  CONTOUR_RAMP,
  ELEVATION_RAMP,
  SOIL_CLASSES,
  TERROIR_BASE,
  TERROIR_FALLBACK,
  TERROIR_LENSES,
  WARMTH_RAMP,
  terroirDataFor,
} from "@/lib/roji/tea-terroir";
import { contourLabelSpots } from "@/lib/viz/contour-path";
import { latToTileY, lngToTileX, zoomForLngSpan } from "@/lib/viz/dem";
import { quadrantLayout } from "@/lib/viz/quadrant";
import { rampFn, seededRandom } from "@/lib/viz/roji-viz-palette";

/**
 * データ層の契約テスト。
 *
 * 3 枚の図は「データ層だけがダミーを持ち、描画側はデータを知らない」構造で、
 * Tea Menu List 218 件が正本になったら差し替わるのはデータ層だけ。よってここで
 * 守るのは **差し替え後も成り立つべき契約** (値域・決定性・落とし先) であり、
 * ダミーの中身そのものではない。
 */

describe("味の四象限のデータ層", () => {
  it("座標は -1..+1、余韻は 0.7..1.2 に収まる", () => {
    for (const point of flavorMatrixFor(null).points) {
      expect(point.x).toBeGreaterThanOrEqual(-1);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(-1);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(point.weight).toBeGreaterThanOrEqual(0.7);
      expect(point.weight).toBeLessThanOrEqual(1.2);
      expect(TEA_CATEGORY_ORDER).toContain(point.category);
    }
  });

  it("id が重複しない (描画側が key に使う)", () => {
    const ids = flavorMatrixFor(null).points.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("銘柄番号が無いときは強調なしの全体図になる", () => {
    expect(flavorMatrixFor(null).highlightId).toBeNull();
    expect(flavorMatrixFor(undefined).highlightId).toBeNull();
  });

  it("同じ銘柄番号なら毎回同じ茶が強調される (開き直しても図が動かない)", () => {
    const first = flavorMatrixFor("10234").highlightId;
    expect(first).not.toBeNull();
    expect(flavorMatrixFor("10234").highlightId).toBe(first);
    expect(flavorMatrixFor(10234).highlightId).toBe(first);
  });

  it("強調される id は必ず点の集合の中にある", () => {
    for (const n of ["10001", "20304", "99999", "7"]) {
      const data = flavorMatrixFor(n);
      expect(data.points.some((p) => p.id === data.highlightId)).toBe(true);
    }
  });
});

describe("香りの場のデータ層", () => {
  it("座標は -1..+1、寄与は 0.7..1.2 に収まる", () => {
    for (const note of aromaFieldFor(null).notes) {
      expect(note.x).toBeGreaterThanOrEqual(-1);
      expect(note.x).toBeLessThanOrEqual(1);
      expect(note.y).toBeGreaterThanOrEqual(-1);
      expect(note.y).toBeLessThanOrEqual(1);
      expect(note.weight).toBeGreaterThanOrEqual(0.7);
      expect(note.weight).toBeLessThanOrEqual(1.2);
      expect(AROMA_FAMILY_ORDER).toContain(note.family);
    }
  });

  it("4 系統すべてに少なくとも 1 つの香りがある (場が欠けない)", () => {
    const notes = aromaFieldFor(null).notes;
    for (const family of AROMA_FAMILY_ORDER) {
      expect(notes.some((n) => n.family === family)).toBe(true);
    }
  });

  it("同じ銘柄番号なら毎回同じ香りが立つ", () => {
    const first = aromaFieldFor("10234").highlightId;
    expect(first).not.toBeNull();
    expect(aromaFieldFor("10234").highlightId).toBe(first);
  });
});

describe("テロワールのデータ層", () => {
  it("産地が引けないときは既定の主産地に落ちる", () => {
    const data = terroirDataFor({ lat: null, lng: null }, null);
    expect(data.center).toEqual(TERROIR_FALLBACK.center);
    expect(data.placeLabel).toBe(TERROIR_FALLBACK.placeLabel);
  });

  it("産地が引けるときはその座標が中心になる", () => {
    const data = terroirDataFor({ lat: 34.75, lng: 138.02 }, "静岡県 島田市");
    expect(data.center).toEqual({ lat: 34.75, lng: 138.02 });
    expect(data.placeLabel).toBe("静岡県 島田市");
  });

  it("茶園は中心の近傍に置かれる (画角から外れない)", () => {
    const center = { lat: 34.75, lng: 138.02 };
    for (const garden of terroirDataFor(center, "静岡県 島田市").gardens) {
      expect(Math.abs(garden.lng - center.lng)).toBeLessThan(0.1);
      expect(Math.abs(garden.lat - center.lat)).toBeLessThan(0.1);
    }
  });

  it("同じ中心なら茶園は毎回同じ場所に立つ", () => {
    const a = terroirDataFor({ lat: 34.75, lng: 138.02 }, null).gardens;
    const b = terroirDataFor({ lat: 34.75, lng: 138.02 }, null).gardens;
    expect(a.map((g) => [g.lng, g.lat])).toEqual(b.map((g) => [g.lng, g.lat]));
  });

  it("全レンズに基層の設定がある (切替で undefined を踏まない)", () => {
    for (const lens of TERROIR_LENSES) {
      expect(TERROIR_BASE[lens]).toBeDefined();
    }
  });

  it("地形図レンズは地図の基層を伏せる (紙の上に線だけを立てるため)", () => {
    expect(TERROIR_BASE.contour.relief).toBe(0);
    expect(TERROIR_BASE.contour.hillshade).toBe(0);
  });

  it("色域の停止点は昇順 (rampFn が線形補間できる前提)", () => {
    for (const ramp of [ELEVATION_RAMP, CONTOUR_RAMP, WARMTH_RAMP]) {
      for (let i = 1; i < ramp.length; i++) {
        expect(ramp[i][0]).toBeGreaterThan(ramp[i - 1][0]);
      }
    }
  });

  it("土の分類は標高の下限が昇順 (分類が飛ばされない)", () => {
    for (let i = 1; i < SOIL_CLASSES.length; i++) {
      expect(SOIL_CLASSES[i].cut).toBeGreaterThan(SOIL_CLASSES[i - 1].cut);
    }
  });
});

describe("描画の下請け", () => {
  it("作図面は 1.35:1 で枠の中央に置かれる", () => {
    const layout = quadrantLayout(1000, 600);
    expect(layout.planeWidth / layout.planeHeight).toBeCloseTo(1.35, 5);
    expect(layout.left + layout.planeWidth / 2).toBeCloseTo(500, 5);
    expect(layout.top + layout.planeHeight / 2).toBeCloseTo(300, 5);
  });

  it("横長の枠でも作図面が枠から出ない (帯にならない)", () => {
    const layout = quadrantLayout(1600, 300);
    expect(layout.planeWidth).toBeLessThanOrEqual(1600);
    expect(layout.planeHeight).toBeLessThanOrEqual(300);
    expect(layout.left).toBeGreaterThanOrEqual(0);
  });

  it("スケールは中心 0 / 端 ±1 を返す", () => {
    const layout = quadrantLayout(800, 500);
    expect(layout.sx(0)).toBeCloseTo(layout.cx, 6);
    expect(layout.sy(0)).toBeCloseTo(layout.cy, 6);
    // y は +1 が上 (画面座標は下が大きい)
    expect(layout.sy(1)).toBeLessThan(layout.sy(-1));
  });

  it("rampFn は範囲外を端の色に丸める", () => {
    const ramp = rampFn([
      [0, "#000000"],
      [100, "#ffffff"],
    ]);
    expect(ramp(-50)).toEqual([0, 0, 0]);
    expect(ramp(150)).toEqual([255, 255, 255]);
    expect(ramp(50)).toEqual([127.5, 127.5, 127.5]);
  });

  it("seededRandom は同じ種で同じ列を返す (絵が毎回同じになる前提)", () => {
    const a = Array.from({ length: 8 }, seededRandom(42));
    const b = Array.from({ length: 8 }, seededRandom(42));
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("短い輪にはラベルを載せない (数字で画面が埋まらない)", () => {
    const tiny = {
      type: "MultiPolygon" as const,
      value: 500,
      coordinates: [[[[0, 0] as [number, number], [1, 0], [1, 1], [0, 0]]]],
    };
    expect(contourLabelSpots(tiny, { minRingLength: 100, spacing: 50 })).toHaveLength(0);
  });

  it("長い輪には間隔ぶんのラベルが載り、文字は逆さまにならない", () => {
    const ring: [number, number][] = [];
    for (let i = 0; i <= 400; i++) ring.push([i, i % 2]);
    const long = {
      type: "MultiPolygon" as const,
      value: 500,
      coordinates: [[ring]],
    };
    const spots = contourLabelSpots(long, { minRingLength: 100, spacing: 150 });
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      expect(spot.angle).toBeGreaterThanOrEqual(-90);
      expect(spot.angle).toBeLessThanOrEqual(90);
    }
  });

  it("タイル座標は経度 0 / 緯度 0 で世界の中心を指す", () => {
    expect(lngToTileX(0, 0)).toBeCloseTo(0.5, 6);
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 6);
    // 東へ行くほど x が増え、北へ行くほど y が減る
    expect(lngToTileX(138.1, 12)).toBeGreaterThan(lngToTileX(137.9, 12));
    expect(latToTileY(35.2, 12)).toBeLessThan(latToTileY(34.9, 12));
  });

  it("ズームは枠幅いっぱいで指定の経度幅を見せる値になる", () => {
    const span = 0.3068;
    for (const width of [358, 720, 1312]) {
      const zoom = zoomForLngSpan(width, span);
      // 世界幅 512 * 2^zoom px のうち width px が span 度に相当する
      const covered = (360 * width) / (512 * 2 ** zoom);
      expect(covered).toBeCloseTo(span, 6);
    }
  });
});

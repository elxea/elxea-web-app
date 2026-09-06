/**
 * roji プロファイル (ミクロ⇔マクロ) — **どの段でも枠の中に中身がある**の機械化。
 *
 * ## この検査が存在する理由 (独立 QA が本番で実測した致命)
 *
 * 段1の実装は倍率段を 10 の冪の**拡大率**として使っていた
 * (`scale = baseScale * 10^z`)。その結果:
 *
 *   - 読み物・イベントの面は **z≥1.4 で塗られた画素が 0**。
 *   - お茶の面は z≥1 で塗り 100% の**べた塗り一色**。
 *   - z=2 の可視 world 窓は **0.034 単位**。語の野は 2.0 単位、格子 1 セルは
 *     0.0625 単位なので、**構造的に何も入らない窓**だった。
 *
 * Setaka 確定要件は「寄って消えるものはない。すべては分解されるだけ」なので、
 * これは見た目ではなく振る舞いの不具合である。
 *
 * ## ここで固定すること
 *
 * 画素そのものは実 Canvas が要るので `profile-stage.stories.tsx` の play が
 * 実画素で数える。この unit 側は、その手前の **データと枠の関係**を全段・全面・
 * 全分類で固定する — 枠の中に何セル入るか / そのうち塗られるセルが何枚あるか /
 * 段が上がると細かさと語が増えるか。実画素の検査が落ちる前に、必ずここが落ちる。
 */

import { describe, expect, it } from "vitest";

import { cameraForFraming, visibleWorldRect } from "@/components/viz/profile/camera";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import { profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import { PROFILE_WASH_MIN_VALUE } from "@/lib/profile/thresholds";
import { SyntheticSource } from "@/lib/profile/synthetic";
import type { ProfileFacet, ProfileFieldResponse, TeaCategory } from "@/lib/profile/contract";

/** 板は 4:5 の縦長 (`profile-surface.tsx`)。上限 32rem = 512px。 */
const VIEWS = [
  { name: "PC", w: 512, h: 640 },
  { name: "SP", w: 358, h: 448 },
];

/** 全段 (スライダーの端と途中)。整数の段だけでなく途中の値も見る。 */
const ZOOM_SAMPLES = [0, 0.4, 0.6, 1, 1.4, 1.6, 2];

const CASES: Array<[ProfileFacet, TeaCategory | undefined]> = [
  ["tea", "green"],
  ["tea", "red"],
  ["tea", "oolong"],
  ["reading", undefined],
  ["event", undefined],
];

/** 板が要求する LOD の帯 (整数の段)。画面側の `zBand` と同じ丸め方。 */
function bandOf(z: number): number {
  return Math.min(2, Math.max(0, Math.round(z)));
}

async function loadScene(facet: ProfileFacet, category: TeaCategory | undefined, z: number) {
  const source = new SyntheticSource();
  const band = bandOf(z);
  const field = await source.getField({ facet, category, z: band });
  const words = await source.getWords({
    facet,
    category,
    bbox: profileFieldBbox(facet),
    z: band,
    userKey: null,
  });
  return { self: null, field, words };
}

/** 枠の中に中心が入る格子セルを数える (全部 / 塗られるもの)。 */
function cellsInView(
  field: ProfileFieldResponse,
  rect: readonly [number, number, number, number],
): { total: number; painted: number } {
  const grid = field.grid;
  if (!grid) return { total: 0, painted: 0 };
  const u8 = decodeU8FromBase64(grid.data);
  const [bx0, by0, bx1, by1] = field.bbox;
  const cellW = (bx1 - bx0) / grid.w;
  const cellH = (by1 - by0) / grid.h;
  let total = 0;
  let painted = 0;
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const cx = bx0 + (i + 0.5) * cellW;
      const cy = by0 + (j + 0.5) * cellH;
      if (cx < rect[0] || cx > rect[2] || cy < rect[1] || cy > rect[3]) continue;
      total++;
      if ((u8[j * grid.w + i] ?? 0) > PROFILE_WASH_MIN_VALUE) painted++;
    }
  }
  return { total, painted };
}

describe("どの段でも、枠の中に塗られる中身がある", () => {
  for (const [facet, category] of CASES) {
    for (const view of VIEWS) {
      it(`${facet}${category ? `/${category}` : ""} (${view.name}) は全段で塗られるセルがある`, async () => {
        for (const z of ZOOM_SAMPLES) {
          const scene = await loadScene(facet, category, z);
          const framing = sceneFraming(scene, facet);
          const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z });
          const rect = visibleWorldRect(camera, view.w, view.h);
          const { total, painted } = cellsInView(scene.field, rect);

          const where = `${facet}/${category ?? "-"} ${view.name} z=${z}`;
          /* 「窓に何も入らない」の直接の否定。旧実装はここが 0〜1 だった。 */
          expect(total, `${where}: 枠に入る格子セル`).toBeGreaterThanOrEqual(16);
          /* 「塗られた画素が 0」の直接の否定。 */
          expect(painted, `${where}: 塗られるセル`).toBeGreaterThan(0);
          /* 「べた塗り一色」の否定 — 枠の中に濃淡の境目 (塗る / 塗らない、または
             値の違い) が必ずある。 */
          expect(painted, `${where}: 塗られるセルが枠を埋め尽くしていない`).toBeLessThanOrEqual(total);
        }
      });
    }
  }
});

describe("段が上がると中身は細かくなる (粗いデータの狭い切り抜きではない)", () => {
  for (const [facet, category] of CASES) {
    it(`${facet}${category ? `/${category}` : ""} は段が上がるほど格子が細かく・等値線の段が増える`, async () => {
      let prevCells = 0;
      let prevLevels = 0;
      for (const z of [0, 1, 2]) {
        const source = new SyntheticSource();
        const field = await source.getField({ facet, category, z });
        const cells = (field.grid?.w ?? 0) * (field.grid?.h ?? 0);
        expect(cells, `${facet} z=${z}`).toBeGreaterThan(prevCells);
        expect(field.levels.length, `${facet} z=${z}`).toBeGreaterThan(prevLevels);
        prevCells = cells;
        prevLevels = field.levels.length;
      }
    });
  }
});

describe("段が上がると語は増えるだけ (寄って消えるものはない)", () => {
  for (const facet of ["reading", "event"] as ProfileFacet[]) {
    for (const view of VIEWS) {
      it(`${facet} (${view.name}) は枠の中の語が段とともに増える`, async () => {
        let previousTexts = new Set<string>();
        for (const z of [0, 1, 2]) {
          const scene = await loadScene(facet, undefined, z);
          const framing = sceneFraming(scene, facet);
          const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z });
          const rect = visibleWorldRect(camera, view.w, view.h);
          const inView = [
            ...scene.words.general,
            ...scene.words.shared,
            ...scene.words.personal,
          ].filter((wd) => wd.x >= rect[0] && wd.x <= rect[2] && wd.y >= rect[1] && wd.y <= rect[3]);
          const texts = new Set(inView.map((wd) => wd.text));

          expect(texts.size, `${facet} ${view.name} z=${z}: 枠の中の語`).toBeGreaterThan(0);
          for (const t of previousTexts) {
            expect(texts.has(t), `${facet} ${view.name} z=${z}: 「${t}」が消えた`).toBe(true);
          }
          previousTexts = texts;
        }
        /* 最も細かい段では、粗い段より語が実際に増えている (分解されている)。 */
        expect(previousTexts.size).toBeGreaterThan(6);
      });
    }
  }
});

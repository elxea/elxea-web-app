/**
 * roji プロファイル — 言葉の札の置き方。
 *
 * ## この検査が存在する理由 (実際に本番で出た不具合)
 *
 * 読み物・イベントの面は座標が -1..1 の正規化空間なのに、倍率が定数
 * 40px/world-unit だったため、**言葉の野が板の中央 70×67px に潰れ**、18 枚の札の
 * うち 74/153 対 (48%) が重なって判読できなかった (1024×640・実測 2026-09-06)。
 * 倍率の方は `lib/profile/framing.ts` が直し、残る重なりをここが引き受ける。
 *
 * ## 守るべき性質は「消さない」
 *
 * Setaka 確定要件「寄って消えるものはない。すべては分解されるだけ」。よって
 * 検査するのは「重なりが 0 になったか」だけではなく、**入力が出力から失われて
 * いないか** と **段を上げると語は増えるだけか** の 2 つ。
 *
 * 段 (`z`) は拡大率ではなく細かさなので、語が現れる仕組みは「寄れば札の画面
 * 距離が開く」ではなく「層が増える (一般語 → 共通語 → 個人語)」である
 * (`components/viz/profile/camera.ts` の冒頭・`lib/profile/words.ts#wordLayerDepth`)。
 */

import { describe, expect, it } from "vitest";

import { worldToScreen } from "@/components/viz/profile/camera";
import { cameraForFraming } from "@/components/viz/profile/camera";
import { profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import { placeLabels, type LabelCandidate } from "@/lib/profile/labels";
import { buildWordsLayers } from "@/lib/profile/words";
import { SyntheticSource } from "@/lib/profile/synthetic";
import type { VocabularyFacet } from "@/lib/profile/vocabulary";

/**
 * 明朝の全角を 1em、半角を 0.55em として札の幅を見積もる。
 *
 * 実測 (`ctx.measureText`) は描き手が行う。ここは Node なので Canvas を持たない
 * — 幅の見積りが**多め**に出る側なら、重なり判定は本番より厳しくなるだけで
 * 甘くはならない。
 */
function approxWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) w += size * 0.35;
    else if (/[\x20-\x7e]/.test(ch)) w += size * 0.55;
    else w += size;
  }
  return w;
}

const LAYERS = [
  { key: "general", size: 15, priority: 0 },
  { key: "shared", size: 12, priority: 1 },
] as const;

/** 語彙表 1 面ぶんを、指定の段で画面へ写した候補にする。 */
function candidatesFor(facet: VocabularyFacet, view: { w: number; h: number }, z: number): LabelCandidate[] {
  const layers = buildWordsLayers(facet, 240, z);
  const framing = sceneFraming(
    {
      self: null,
      field: null,
      words: { source: "synthetic", facet, general: layers.general, shared: layers.shared, personal: [] },
    },
    facet,
  );
  const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z });
  const out: LabelCandidate[] = [];
  for (const layer of LAYERS) {
    const list = layer.key === "general" ? layers.general : layers.shared;
    for (let i = 0; i < list.length; i++) {
      const p = worldToScreen(camera, list[i].x, list[i].y, view.w, view.h);
      out.push({
        key: `${layer.key}:${i}`,
        x: p.x,
        y: p.y,
        w: approxWidth(list[i].text, layer.size),
        h: layer.size,
        priority: layer.priority,
      });
    }
  }
  return out;
}

function overlappingPairs(
  placed: readonly { key: string; x: number; y: number }[],
  byKey: Map<string, LabelCandidate>,
): number {
  let n = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const ca = byKey.get(a.key)!;
      const cb = byKey.get(b.key)!;
      if (Math.abs(a.x - b.x) < (ca.w + cb.w) / 2 && Math.abs(a.y - b.y) < (ca.h + cb.h) / 2) n++;
    }
  }
  return n;
}

describe("札は重ねない", () => {
  it("置いた札どうしは 1 対も重ならない", () => {
    for (const facet of ["reading", "event"] as VocabularyFacet[]) {
      for (const view of [
        { w: 1024, h: 640 },
        { w: 358, h: 480 },
      ]) {
        /* 語が最も多い段 (すべての層が出ている段) で見る。 */
        const candidates = candidatesFor(facet, view, 2);
        const byKey = new Map(candidates.map((c) => [c.key, c]));
        const { placed } = placeLabels(candidates);
        expect(overlappingPairs(placed, byKey), `${facet} ${view.w}x${view.h}`).toBe(0);
      }
    }
  });

  it("同じ座標に積まれても 1 枚だけ置き、残りは保留にする (消さない)", () => {
    const stacked: LabelCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`,
      x: 100,
      y: 100,
      w: 200,
      h: 20,
      priority: i,
    }));
    const { placed, deferred } = placeLabels(stacked, { nudges: [] });
    expect(placed).toHaveLength(1);
    expect(deferred).toHaveLength(4);
    expect(placed[0].key).toBe("k0"); // 優先度の高い (粗い) 語が場所を取る
  });
});

describe("消さない — 入力は必ず「置いた」か「保留」のどちらかになる", () => {
  it("置いた枚数 + 保留の枚数 = 候補の枚数", () => {
    for (const facet of ["reading", "event"] as VocabularyFacet[]) {
      const candidates = candidatesFor(facet, { w: 358, h: 358 }, 2);
      const { placed, deferred } = placeLabels(candidates);
      expect(placed.length + deferred.length).toBe(candidates.length);
      const keys = new Set([...placed.map((p) => p.key), ...deferred]);
      expect(keys.size).toBe(candidates.length);
    }
  });
});

describe("段を上げると語は増えるだけ (減らない)", () => {
  /* 「寄って消えるものはない。すべては分解されるだけ」の言葉の側の担い手。
     段が上がると層が増えるので、前の段に出ていた語は必ず次の段にも出る。 */
  it.each(["reading", "event"] as VocabularyFacet[])("%s は段が上がるほど語が増える", (facet) => {
    let previous = new Set<string>();
    let previousCount = 0;
    for (const z of [0, 1, 2]) {
      const layers = buildWordsLayers(facet, 240, z);
      const texts = new Set([...layers.general, ...layers.shared].map((w) => w.text));
      for (const t of previous) expect(texts.has(t), `${facet} z=${z} で「${t}」が消えた`).toBe(true);
      expect(texts.size).toBeGreaterThanOrEqual(previousCount);
      previous = texts;
      previousCount = texts.size;
    }
    // 粗い段は一般語だけ、細かい段では共通語まで分解される。
    expect(buildWordsLayers(facet, 240, 0).shared).toHaveLength(0);
    expect(buildWordsLayers(facet, 240, 2).shared.length).toBeGreaterThan(0);
  });
});

describe("重なりは間隔が開けば必ず解ける (placeLabels の性質)", () => {
  /* 札の大きさ (px) は間隔によらないので、札どうしの画面距離が開けば
     「いま重なっているから置かない」は必ず解ける。板が大きくなったとき・
     語の配置が広がったときに保留が残り続けないことを固定する。 */
  it("同じ候補集合を引き伸ばすと、保留の割合が単調に減る", () => {
    for (const facet of ["reading", "event"] as VocabularyFacet[]) {
      const base = candidatesFor(facet, { w: 1024, h: 640 }, 2);
      let previousRatio = Number.POSITIVE_INFINITY;
      for (const factor of [1, 1.5, 2, 3, 5]) {
        const spread = base.map((c) => ({
          ...c,
          x: 512 + (c.x - 512) * factor,
          y: 320 + (c.y - 320) * factor,
        }));
        const { placed, deferred } = placeLabels(spread);
        const ratio = deferred.length / (placed.length + deferred.length);
        expect(ratio, `${facet} x${factor}`).toBeLessThanOrEqual(previousRatio + 1e-9);
        previousRatio = ratio;
      }
      expect(previousRatio).toBe(0); // 十分に寄れば全部出る
    }
  });
});

describe("言葉の予算は地の面と分けて持つ", () => {
  it("格子のセル数が最大でも、言葉の予算は減らない", async () => {
    /* LOD micro (z=2) は格子が最大になる段。ひとつの予算を共有していた頃は
       ここで地がすべて使い切り、言葉が 1 つも描かれなかった。 */
    const source = new SyntheticSource();
    const field = await source.getField({ facet: "reading", z: 2 });
    const words = await source.getWords({
      facet: "reading",
      bbox: profileFieldBbox("reading"),
      z: 2,
      userKey: null,
    });
    const cells = (field.grid?.w ?? 0) * (field.grid?.h ?? 0);
    expect(cells).toBeGreaterThan(0);

    const { PROFILE_WORDS_FRAME_BUDGET } = await import("@/lib/profile/thresholds");
    const total = words.general.length + words.shared.length + words.personal.length;
    expect(total).toBeGreaterThan(0);
    expect(PROFILE_WORDS_FRAME_BUDGET).toBeGreaterThanOrEqual(total);
  });
});

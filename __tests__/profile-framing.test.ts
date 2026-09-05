/**
 * roji プロファイル (ミクロ⇔マクロ) — 「自分が画面の中心にいる」の機械化。
 *
 * ## この検査が存在する理由 (実際に本番で出た不具合)
 *
 * 段1の実装は world 原点 (0,0) を自分と見なして画面中心に固定していた。
 * お茶の面の写像B は `y = 香り + 味わい ∈ [2,10]` なので**原点は嗜好空間の中に
 * 無く**、生成データ 240 人の分布は画面中心から 198〜291px 右下にずれて描かれ、
 * 画面が読み上げる「自分は中心にいて」と絵が食い違っていた (2026-09-06 実測)。
 *
 * 見た目の話に見えるが、これは Decision Log
 * https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac の確定事項
 * 「ズームの中心は常に自分」が守れていないという**振る舞いの不具合**なので、
 * 視覚回帰 (人が見る) ではなく px の数値で固定する。
 */

import { describe, expect, it } from "vitest";

import { mapTeaAxes } from "@/lib/profile/axes";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import { cameraForFraming, worldToScreen } from "@/components/viz/profile/camera";
import { fitBaseScale, profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import { SyntheticSource } from "@/lib/profile/synthetic";
import type {
  ProfileFacet,
  ProfileFieldResponse,
  ProfileSelfResponse,
  TeaCategory,
} from "@/lib/profile/contract";

const VIEWS = [
  { name: "PC", w: 1024, h: 640 },
  { name: "SP", w: 358, h: 480 },
];

/** 画面に描かれる「みんな」の重心 (= 濃度で重み付けした格子の重心)。 */
function crowdCentroid(field: ProfileFieldResponse): { x: number; y: number } | null {
  const grid = field.grid;
  if (!grid) return null;
  const u8 = decodeU8FromBase64(grid.data);
  const [x0, y0, x1, y1] = field.bbox;
  const cellW = (x1 - x0) / grid.w;
  const cellH = (y1 - y0) / grid.h;
  let x = 0;
  let y = 0;
  let t = 0;
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const v = u8[j * grid.w + i] ?? 0;
      if (v <= 0) continue;
      x += (x0 + (i + 0.5) * cellW) * v;
      y += (y0 + (j + 0.5) * cellH) * v;
      t += v;
    }
  }
  return t > 0 ? { x: x / t, y: y / t } : null;
}

async function loadScene(facet: ProfileFacet, category: TeaCategory | undefined, withSelf: boolean) {
  const source = new SyntheticSource();
  const field = await source.getField({ facet, category, z: 0 });
  const words = await source.getWords({ facet, category, bbox: profileFieldBbox(facet), userKey: null });
  let self: ProfileSelfResponse | null = null;
  if (withSelf && facet === "tea" && category) {
    self = await source.getSelf({ facet: "tea", category, userKey: "test-user" });
  }
  return { self, field, words };
}

describe("嗜好空間の bbox は写像から導く (手で置いた四角にしない)", () => {
  it("写像Bの到達範囲そのもので、原点を含まない", () => {
    const bbox = profileFieldBbox("tea");
    expect(bbox).toEqual([-4, 2, 4, 10]);

    // 実測 24 銘柄が全部その中に入る。
    for (const [flavor, aroma] of [
      [1, 1],
      [1, 5],
      [5, 1],
      [5, 5],
      [3, 3],
    ]) {
      const p = mapTeaAxes(flavor, aroma);
      expect(p.x).toBeGreaterThanOrEqual(bbox[0]);
      expect(p.x).toBeLessThanOrEqual(bbox[2]);
      expect(p.y).toBeGreaterThanOrEqual(bbox[1]);
      expect(p.y).toBeLessThanOrEqual(bbox[3]);
    }

    /* 原点が範囲の外にあること自体が、「world 原点 = 自分」という旧実装の
       前提が成り立たない理由。ここが変わったら camera 側の前提も見直す。 */
    expect(bbox[1]).toBeGreaterThan(0);
  });

  it("言葉の面は語彙表の正規化空間 (-1..1)", () => {
    expect(profileFieldBbox("reading")).toEqual([-1, -1, 1, 1]);
    expect(profileFieldBbox("event")).toEqual([-1, -1, 1, 1]);
  });
});

describe("画面の中心は自分。自分が居なければみんなの重心", () => {
  it("ログイン済みなら anchor は自分の重心そのもの", async () => {
    const scene = await loadScene("tea", "green", true);
    const framing = sceneFraming(scene, "tea");
    expect(framing.anchorOf).toBe("self");
    expect(framing.anchor.x).toBeCloseTo(scene.self!.centroid!.x, 10);
    expect(framing.anchor.y).toBeCloseTo(scene.self!.centroid!.y, 10);
  });

  it("未ログイン (self が 401 で null) ならみんなの重心に落ちる", async () => {
    const scene = await loadScene("tea", "green", false);
    const framing = sceneFraming(scene, "tea");
    expect(framing.anchorOf).toBe("field");
    const crowd = crowdCentroid(scene.field)!;
    expect(framing.anchor.x).toBeCloseTo(crowd.x, 6);
    expect(framing.anchor.y).toBeCloseTo(crowd.y, 6);
  });

  it("何も無い面でも anchor と縮尺が決まる (板が真っ白にならない)", () => {
    const framing = sceneFraming({ self: null, field: null, words: null }, "tea");
    expect(framing.anchorOf).toBe("bbox");
    expect(framing.radius.rx).toBeGreaterThan(0);
    expect(framing.radius.ry).toBeGreaterThan(0);
    const scale = fitBaseScale(framing.radius, 1024, 640, 56);
    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

describe("回帰: 未ログインの本番で、みんなの重心が画面中心に来る", () => {
  /* 旧実装での実測値 (1024×640・z=0): 緑茶 235px / 紅茶 291px / 青茶 198px の
     ずれ。「中心にいる」と読み上げながら右下に寄っていた。 */
  const CASES: Array<[ProfileFacet, TeaCategory | undefined]> = [
    ["tea", "green"],
    ["tea", "red"],
    ["tea", "oolong"],
    ["reading", undefined],
    ["event", undefined],
  ];

  for (const [facet, category] of CASES) {
    for (const view of VIEWS) {
      it(`${facet}${category ? `/${category}` : ""} (${view.name}) は倍率3段すべてで 1px 未満`, async () => {
        const scene = await loadScene(facet, category, false);
        const framing = sceneFraming(scene, facet);
        const crowd = crowdCentroid(scene.field)!;
        expect(crowd).not.toBeNull();

        for (const z of [0, 1, 2]) {
          const camera = cameraForFraming({
            anchor: framing.anchor,
            radius: framing.radius,
            viewW: view.w,
            viewH: view.h,
            z,
          });
          const p = worldToScreen(camera, crowd.x, crowd.y, view.w, view.h);
          expect(Math.hypot(p.x - view.w / 2, p.y - view.h / 2)).toBeLessThan(1);
        }
      });
    }
  }
});

describe("回帰: ログイン済みなら自分の粒がちょうど画面中心に描かれる", () => {
  for (const category of ["green", "red", "oolong"] as TeaCategory[]) {
    it(`${category} は倍率3段すべてで自分が中心 (ずれ 0px)`, async () => {
      const scene = await loadScene("tea", category, true);
      const framing = sceneFraming(scene, "tea");
      const self = scene.self!.centroid!;
      for (const z of [0, 1, 2]) {
        const camera = cameraForFraming({
          anchor: framing.anchor,
          radius: framing.radius,
          viewW: 1024,
          viewH: 640,
          z,
        });
        const p = worldToScreen(camera, self.x, self.y, 1024, 640);
        expect(p.x).toBeCloseTo(512, 6);
        expect(p.y).toBeCloseTo(320, 6);
      }
    });

    it(`${category} は ×1 でみんなの重心も板の中に収まる`, async () => {
      const scene = await loadScene("tea", category, true);
      const framing = sceneFraming(scene, "tea");
      const camera = cameraForFraming({
        anchor: framing.anchor,
        radius: framing.radius,
        viewW: 1024,
        viewH: 640,
        z: 0,
      });
      const crowd = crowdCentroid(scene.field)!;
      const p = worldToScreen(camera, crowd.x, crowd.y, 1024, 640);
      /* 自分を中心に置いたぶん、みんなの重心は中心から少し離れる。それでも
         板の中央寄り (short 辺の 1/4 以内) に居ることを固定する。 */
      expect(Math.hypot(p.x - 512, p.y - 320)).toBeLessThan(640 / 4);
    });
  }
});

describe("余白は中心の周りに対称に付く (絵が下に寄って上が空く、を止める)", () => {
  it("中身が板に収まり、上下の余白が等しい", async () => {
    const scene = await loadScene("tea", "green", false);
    const framing = sceneFraming(scene, "tea");
    const view = { w: 1024, h: 640 };
    const padding = 56;
    const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z: 0, padding });

    const top = worldToScreen(camera, framing.anchor.x, framing.anchor.y - framing.radius.ry, view.w, view.h);
    const bottom = worldToScreen(camera, framing.anchor.x, framing.anchor.y + framing.radius.ry, view.w, view.h);
    const left = worldToScreen(camera, framing.anchor.x - framing.radius.rx, framing.anchor.y, view.w, view.h);
    const right = worldToScreen(camera, framing.anchor.x + framing.radius.rx, framing.anchor.y, view.w, view.h);

    expect(top.y).toBeGreaterThanOrEqual(0);
    expect(bottom.y).toBeLessThanOrEqual(view.h);
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(right.x).toBeLessThanOrEqual(view.w);

    expect(top.y).toBeCloseTo(view.h - bottom.y, 6);
    expect(left.x).toBeCloseTo(view.w - right.x, 6);
    /* short 辺のどちらかは padding ちょうどまで使う (無駄な余白を残さない)。 */
    expect(Math.min(top.y, left.x)).toBeCloseTo(padding, 6);
  });
});

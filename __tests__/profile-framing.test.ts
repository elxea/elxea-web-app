/**
 * roji プロファイル (ミクロ⇔マクロ) — 「自分が画面の中心にいる」と「板が空か
 * ない」の機械化。
 *
 * ## この検査が存在する理由 (実際に本番で出た不具合)
 *
 * 1. 段1の実装は world 原点 (0,0) を自分と見なして画面中心に固定していた。
 *    お茶の面の写像B は `y = 香り + 味わい ∈ [2,10]` なので**原点は嗜好空間の中に
 *    無く**、生成データ 240 人の分布は画面中心から 198〜291px 右下にずれて描かれ、
 *    画面が読み上げる「自分は中心にいて」と絵が食い違っていた (2026-09-06 実測)。
 * 2. 続く実装は中心を「みんなの重心 (濃度で重み付けした平均)」に置いた。平均は
 *    中身の真ん中ではないので、**中身が片側に偏ると反対側にだけ大きな余白が残る**
 *    (独立 QA 実測: 下の余白が上の 1.8 倍 / PC で横幅の 68% が空)。
 *
 * どちらも見た目の話に見えるが、1 は Decision Log
 * https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac の確定事項
 * 「ズームの中心は常に自分」が守れていないという**振る舞いの不具合**であり、
 * 2 は「板に対して図が小さすぎる」という可読性の不具合である。どちらも人が見る
 * 視覚回帰ではなく px の数値で固定する。
 */

import { describe, expect, it } from "vitest";

import { mapTeaAxes } from "@/lib/profile/axes";
import { decodeU8FromBase64 } from "@/lib/profile/field";
import {
  cameraForFraming,
  PROFILE_VIEW_PADDING_X,
  PROFILE_VIEW_PADDING_Y,
  worldToScreen,
} from "@/components/viz/profile/camera";
import { fitBaseScale, profileFieldBbox, sceneFraming } from "@/lib/profile/framing";
import { SyntheticSource } from "@/lib/profile/synthetic";
import type {
  ProfileFacet,
  ProfileFieldResponse,
  ProfileSelfResponse,
  TeaCategory,
} from "@/lib/profile/contract";

/** 板は 4:5 の縦長 (`profile-surface.tsx`)。上限 32rem = 512px。 */
const VIEWS = [
  { name: "PC", w: 512, h: 640 },
  { name: "SP", w: 358, h: 448 },
];

const ZOOM_STEPS = [0, 1, 2];

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

async function loadScene(
  facet: ProfileFacet,
  category: TeaCategory | undefined,
  withSelf: boolean,
  z = 0,
) {
  const source = new SyntheticSource();
  const field = await source.getField({ facet, category, z });
  const words = await source.getWords({
    facet,
    category,
    bbox: profileFieldBbox(facet),
    z,
    userKey: null,
  });
  let self: ProfileSelfResponse | null = null;
  if (withSelf && facet === "tea" && category) {
    self = await source.getSelf({ facet: "tea", category, userKey: "test-user" });
  }
  return { self, field, words };
}

const CASES: Array<[ProfileFacet, TeaCategory | undefined]> = [
  ["tea", "green"],
  ["tea", "red"],
  ["tea", "oolong"],
  ["reading", undefined],
  ["event", undefined],
];

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

describe("画面の中心は自分。自分が居なければ中身の真ん中", () => {
  it("ログイン済みなら anchor は自分の重心そのもの", async () => {
    const scene = await loadScene("tea", "green", true);
    const framing = sceneFraming(scene, "tea");
    expect(framing.anchorOf).toBe("self");
    expect(framing.anchor.x).toBeCloseTo(scene.self!.centroid!.x, 10);
    expect(framing.anchor.y).toBeCloseTo(scene.self!.centroid!.y, 10);
  });

  it("未ログイン (self が 401 で null) なら中身の外接矩形の中心に落ちる", async () => {
    const scene = await loadScene("tea", "green", false);
    const framing = sceneFraming(scene, "tea");
    expect(framing.anchorOf).toBe("content");
  });

  it("何も無い面でも anchor と縮尺が決まる (板が真っ白にならない)", () => {
    const framing = sceneFraming({ self: null, field: null, words: null }, "tea");
    expect(framing.anchorOf).toBe("bbox");
    expect(framing.radius.rx).toBeGreaterThan(0);
    expect(framing.radius.ry).toBeGreaterThan(0);
    const scale = fitBaseScale(framing.radius, 512, 640);
    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

describe("回帰: 余白は四方で対称 (下だけ 1.8 倍、が起きない)", () => {
  /* 旧実装での実測 (独立 QA・2026-09-06): 下の余白が上の 1.8 倍 / PC で横幅の
     68% が空。原因は「中心を平均で決めていた」こと。 */
  for (const [facet, category] of CASES) {
    for (const view of VIEWS) {
      it(`${facet}${category ? `/${category}` : ""} (${view.name}) は上下・左右の余白が等しい`, async () => {
        const scene = await loadScene(facet, category, false);
        const framing = sceneFraming(scene, facet);
        const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z: 0 });

        const top = worldToScreen(camera, framing.anchor.x, framing.anchor.y - framing.radius.ry, view.w, view.h);
        const bottom = worldToScreen(camera, framing.anchor.x, framing.anchor.y + framing.radius.ry, view.w, view.h);
        const left = worldToScreen(camera, framing.anchor.x - framing.radius.rx, framing.anchor.y, view.w, view.h);
        const right = worldToScreen(camera, framing.anchor.x + framing.radius.rx, framing.anchor.y, view.w, view.h);

        // 中身は板の中に収まる。
        expect(top.y).toBeGreaterThanOrEqual(0);
        expect(bottom.y).toBeLessThanOrEqual(view.h);
        expect(left.x).toBeGreaterThanOrEqual(0);
        expect(right.x).toBeLessThanOrEqual(view.w);

        // 余白は対称。
        expect(top.y).toBeCloseTo(view.h - bottom.y, 6);
        expect(left.x).toBeCloseTo(view.w - right.x, 6);

        // 短辺のどちらかは padding ちょうどまで使う (無駄な余白を残さない)。
        const usedX = Math.abs(left.x - PROFILE_VIEW_PADDING_X) < 1e-6;
        const usedY = Math.abs(top.y - PROFILE_VIEW_PADDING_Y) < 1e-6;
        expect(usedX || usedY, `left=${left.x} top=${top.y}`).toBe(true);
      });
    }
  }
});

describe("回帰: 板に対して図が小さすぎない", () => {
  /* 独立 QA 実測: PC で横幅の 68% が空。板を 4:5 の縦長にし、逃げを左右 36px・
     上下 28px にしたうえで、**縮尺を決めた側の軸は逃げを除く全部を中身が使う**
     ことを固定する。もう一方の軸は中身の縦横比で決まる (歪めないので 100% には
     できない) が、実測の下限 0.59 を割らないことを固定する。 */
  for (const [facet, category] of CASES) {
    for (const view of VIEWS) {
      it(`${facet}${category ? `/${category}` : ""} (${view.name}) は板の広い面積を中身が使う`, async () => {
        const scene = await loadScene(facet, category, false);
        const framing = sceneFraming(scene, facet);
        const camera = cameraForFraming({ ...framing, viewW: view.w, viewH: view.h, z: 0 });
        const spanX = 2 * framing.radius.rx * camera.scale;
        const spanY = 2 * framing.radius.ry * camera.scale;

        const fillX = spanX / view.w;
        const fillY = spanY / view.h;
        /* 縮尺を決めた側の軸は 8 割以上を使う (余白は逃げのぶんだけ)。 */
        expect(Math.max(fillX, fillY), `fillX=${fillX} fillY=${fillY}`).toBeGreaterThan(0.78);
        /* もう一方の軸は中身の縦横比で決まる。歪めないので 100% にはできないが、
           旧実装の実測 (横 32% = 68% が空) を大きく上回ることを固定する。 */
        expect(Math.min(fillX, fillY), `fillX=${fillX} fillY=${fillY}`).toBeGreaterThan(0.55);
      });
    }
  }
});

describe("回帰: ログイン済みなら自分の粒がちょうど画面中心に描かれる", () => {
  for (const category of ["green", "red", "oolong"] as TeaCategory[]) {
    it(`${category} は全段で自分が中心 (ずれ 0px)`, async () => {
      const scene = await loadScene("tea", category, true);
      const framing = sceneFraming(scene, "tea");
      const self = scene.self!.centroid!;
      for (const z of ZOOM_STEPS) {
        const camera = cameraForFraming({ ...framing, viewW: 512, viewH: 640, z });
        const p = worldToScreen(camera, self.x, self.y, 512, 640);
        expect(p.x).toBeCloseTo(256, 6);
        expect(p.y).toBeCloseTo(320, 6);
      }
    });

    it(`${category} はみんなの重心も板の中に収まる`, async () => {
      const scene = await loadScene("tea", category, true);
      const framing = sceneFraming(scene, "tea");
      const camera = cameraForFraming({ ...framing, viewW: 512, viewH: 640, z: 0 });
      const crowd = crowdCentroid(scene.field)!;
      const p = worldToScreen(camera, crowd.x, crowd.y, 512, 640);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(512);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(640);
    });
  }
});

describe("段を動かしても枠は動かない (寄って消えるものはない)", () => {
  /* 本 PR の核心。旧実装は `scale = baseScale * 10^z` で、z=2 の可視 world 窓が
     0.034 単位しかなく (語の野は 2.0 単位・格子 1 セルは 0.0625 単位)、
     **構造的に何も入らない窓**になっていた。段は拡大率ではなく細かさなので、
     枠 (中心・縮尺) は段によらず一定でなければならない。 */
  for (const [facet, category] of CASES) {
    it(`${facet}${category ? `/${category}` : ""} は全段で中心・縮尺が同じ`, async () => {
      const scene = await loadScene(facet, category, false);
      const framing = sceneFraming(scene, facet);
      const cameras = ZOOM_STEPS.map((z) =>
        cameraForFraming({ ...framing, viewW: 512, viewH: 640, z }),
      );
      for (const cam of cameras) {
        expect(cam.scale).toBeCloseTo(cameras[0].scale, 10);
        expect(cam.cx).toBeCloseTo(cameras[0].cx, 10);
        expect(cam.cy).toBeCloseTo(cameras[0].cy, 10);
      }
      expect(cameras.map((c) => c.z)).toEqual(ZOOM_STEPS);
    });
  }
});

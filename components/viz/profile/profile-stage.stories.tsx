import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import { ProfileStagePreview } from "@/components/viz/profile/profile-stage-preview";
import { buildStoryScene } from "@/lib/profile/story-fixtures";
import {
  PROFILE_DARK_AREA_MAX_RATIO,
  PROFILE_DARK_LUMA_THRESHOLD,
} from "@/lib/profile/thresholds";
import { hexToRgb, perceivedLuma, ROJI_VIZ_COLOR } from "@/lib/viz/roji-viz-palette";
import type { ProfileFacet, TeaCategory } from "@/lib/profile/contract";

/**
 * roji プロファイル (ミクロ⇔マクロ) — 段1の視覚回帰。
 *
 * 倍率3段 (×1 / ×10 / ×100) × 面3種 (お茶 / 読み物 / イベント) × PC/SP の
 * 18枚 (Spec §「テスト計画」4)。固定 seed の生成データ (`lib/profile/story-fixtures.ts`)
 * を直接 props で渡す静止プレビュー (`ProfileStagePreview`) を使うので、
 * データ取得 (fetch) を経由せず決定的。
 *
 * 見た目は暫定 (`CanvasProfileRenderer`) — Figma 確定後に描き手だけ差し替わる。
 */
const meta = {
  title: "Viz/Profile",
  component: ProfileStagePreview,
  parameters: {
    layout: "fullscreen",
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
} satisfies Meta<typeof ProfileStagePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

const FACETS: Array<{ key: ProfileFacet; label: string; heading: string }> = [
  { key: "tea", label: "お茶の面 (緑茶)", heading: "お 茶   味 わ い の 地" },
  { key: "reading", label: "読み物の面", heading: "読 み 物   言 葉 の 野" },
  { key: "event", label: "イベントの面", heading: "イ ベ ン ト   言 葉 の 野" },
];

/**
 * 段は拡大率ではなく**細かさ** (`components/viz/profile/camera.ts` の冒頭)。
 * story の名前も「×10」ではなく段の粗さ・細かさで呼ぶ。
 */
const ZOOM_LEVELS: Array<{ z: number; label: string }> = [
  { z: 0, label: "粗い段 (一般語まで)" },
  { z: 1, label: "中間の段 (共通語まで)" },
  { z: 2, label: "細かい段 (個人語まで)" },
];

/** 板は 4:5 の縦長・上限 32rem (`profile-surface.tsx`)。 */
const VIEWPORTS: Array<{ key: "pc" | "sp"; width: number; height: number }> = [
  { key: "pc", width: 512, height: 640 },
  { key: "sp", width: 358, height: 448 },
];

function frame(width: number, height: number, children: React.ReactNode) {
  return (
    <div style={{ width, maxWidth: "100%", height }}>{children}</div>
  );
}

/* ------------------------------------------------------------------ *
 * 機械検査 — 画素を数える
 * ------------------------------------------------------------------ */

/** 検査する面 (お茶は分類 3 つとも)。 */
const PROBE_SCENES: Array<{ id: string; facet: ProfileFacet; category?: TeaCategory }> = [
  { id: "tea-green", facet: "tea", category: "green" },
  { id: "tea-red", facet: "tea", category: "red" },
  { id: "tea-oolong", facet: "tea", category: "oolong" },
  { id: "reading", facet: "reading" },
  { id: "event", facet: "event" },
];

/** 検査する段。スライダーの端と途中の両方を見る。 */
const PROBE_ZOOMS = [0, 0.6, 1, 1.4, 2];

const PROBE_W = 256;
const PROBE_H = 320;

/** 地の色からこれだけ離れていたら「塗られた画素」と数える (3 チャネルの差の和)。 */
const PAINTED_MIN_DISTANCE = 12;

/** 塗られた画素が描画領域に占める割合の下限。 */
const PAINTED_MIN_RATIO = 0.02;

function probeCanvas(canvas: HTMLCanvasElement): {
  total: number;
  painted: number;
  dark: number;
  maxDistance: number;
} {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context を取れない");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const [pr, pg, pb] = hexToRgb(ROJI_VIZ_COLOR.kinari);
  let painted = 0;
  let dark = 0;
  let maxDistance = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const distance = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
    if (distance > maxDistance) maxDistance = distance;
    if (distance > PAINTED_MIN_DISTANCE) painted++;
    if (perceivedLuma(r, g, b) < PROFILE_DARK_LUMA_THRESHOLD) dark++;
  }
  return { total: width * height, painted, dark, maxDistance };
}

function ProbeGrid() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {PROBE_ZOOMS.map((z) => (
        <div key={z} style={{ display: "flex", gap: 8 }}>
          {PROBE_SCENES.map((scene) => (
            <div
              key={scene.id}
              data-probe={`${scene.id}@${z}`}
              style={{ width: PROBE_W, height: PROBE_H }}
            >
              <ProfileStagePreview
                label={`${scene.id} 段 ${z}`}
                scene={buildStoryScene(scene.facet, scene.category, z)}
                z={z}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function makeStory(facet: (typeof FACETS)[number], zoom: (typeof ZOOM_LEVELS)[number], viewport: (typeof VIEWPORTS)[number]): Story {
  const category = facet.key === "tea" ? "green" : undefined;
  return {
    args: { label: `${facet.label} — ${zoom.label} (${viewport.key.toUpperCase()})` },
    render: (args) => (
      <VizStoryFrame heading={`${facet.heading} ／ ${zoom.label} ／ ${viewport.key.toUpperCase()}`}>
        {frame(
          viewport.width,
          viewport.height,
          <ProfileStagePreview {...args} scene={buildStoryScene(facet.key, category, zoom.z)} z={zoom.z} />,
        )}
      </VizStoryFrame>
    ),
  };
}

// --- お茶 (緑茶) --------------------------------------------------------
export const TeaMacroPC: Story = makeStory(FACETS[0], ZOOM_LEVELS[0], VIEWPORTS[0]);
export const TeaMacroSP: Story = makeStory(FACETS[0], ZOOM_LEVELS[0], VIEWPORTS[1]);
export const TeaMidPC: Story = makeStory(FACETS[0], ZOOM_LEVELS[1], VIEWPORTS[0]);
export const TeaMidSP: Story = makeStory(FACETS[0], ZOOM_LEVELS[1], VIEWPORTS[1]);
export const TeaMicroPC: Story = makeStory(FACETS[0], ZOOM_LEVELS[2], VIEWPORTS[0]);
export const TeaMicroSP: Story = makeStory(FACETS[0], ZOOM_LEVELS[2], VIEWPORTS[1]);

// --- 読み物 --------------------------------------------------------------
export const ReadingMacroPC: Story = makeStory(FACETS[1], ZOOM_LEVELS[0], VIEWPORTS[0]);
export const ReadingMacroSP: Story = makeStory(FACETS[1], ZOOM_LEVELS[0], VIEWPORTS[1]);
export const ReadingMidPC: Story = makeStory(FACETS[1], ZOOM_LEVELS[1], VIEWPORTS[0]);
export const ReadingMidSP: Story = makeStory(FACETS[1], ZOOM_LEVELS[1], VIEWPORTS[1]);
export const ReadingMicroPC: Story = makeStory(FACETS[1], ZOOM_LEVELS[2], VIEWPORTS[0]);
export const ReadingMicroSP: Story = makeStory(FACETS[1], ZOOM_LEVELS[2], VIEWPORTS[1]);

// --- イベント ------------------------------------------------------------
export const EventMacroPC: Story = makeStory(FACETS[2], ZOOM_LEVELS[0], VIEWPORTS[0]);
export const EventMacroSP: Story = makeStory(FACETS[2], ZOOM_LEVELS[0], VIEWPORTS[1]);
export const EventMidPC: Story = makeStory(FACETS[2], ZOOM_LEVELS[1], VIEWPORTS[0]);
export const EventMidSP: Story = makeStory(FACETS[2], ZOOM_LEVELS[1], VIEWPORTS[1]);
export const EventMicroPC: Story = makeStory(FACETS[2], ZOOM_LEVELS[2], VIEWPORTS[0]);
export const EventMicroSP: Story = makeStory(FACETS[2], ZOOM_LEVELS[2], VIEWPORTS[1]);

/* ------------------------------------------------------------------ *
 * 機械検査 (Setaka 指示の 2 本)
 *
 *   (a) 全段・全面・全分類で、塗られた画素が 0 でない
 *   (b) 輝度 40 未満の画素が描画領域の 0.5% 以下
 *
 * どちらも実 Canvas の画素で数える。純関数側の予備検査は
 * `__tests__/profile-zoom-coverage.test.ts` / `profile-ink-contrast.test.ts`
 * にあり、そちらが先に落ちる作りにしてある。
 *
 * 視覚回帰の対象にはしない (見せるための絵ではなく検査の足場なので、
 * Chromatic の枚数を増やさない)。
 * ------------------------------------------------------------------ */
export const PaintCoverage: Story = {
  args: { label: "機械検査 — 全段・全面・全分類の画素" },
  parameters: { chromatic: { disableSnapshot: true } },
  render: () => (
    <VizStoryFrame heading="機 械 検 査 ／ 塗 ら れ た 画 素 と 暗 さ">
      <ProbeGrid />
    </VizStoryFrame>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    void view;

    const hosts = Array.from(
      canvasElement.querySelectorAll<HTMLElement>("[data-probe]"),
    );
    expect(hosts.length).toBe(PROBE_SCENES.length * PROBE_ZOOMS.length);

    await waitFor(() => {
      for (const host of hosts) {
        const canvas = host.querySelector("canvas");
        expect(canvas, `${host.dataset.probe}: canvas が無い`).not.toBeNull();
        expect((canvas as HTMLCanvasElement).width).toBeGreaterThan(0);
      }
    });

    for (const host of hosts) {
      const where = host.dataset.probe ?? "?";
      const canvas = host.querySelector("canvas") as HTMLCanvasElement;
      const { total, painted, dark, maxDistance } = probeCanvas(canvas);

      /* (a) 塗られた画素が 0 でない。旧実装は読み物・イベントの面の z≥1.4 で
         ちょうど 0 になり、お茶の面は地色から最大 3/765 しか離れなかった。 */
      expect(painted, `${where}: 塗られた画素`).toBeGreaterThan(0);
      expect(
        painted / total,
        `${where}: 塗られた画素の割合 ${(painted / total).toFixed(3)}`,
      ).toBeGreaterThan(PAINTED_MIN_RATIO);
      expect(maxDistance, `${where}: 地色からの最大の隔たり`).toBeGreaterThan(24);

      /* (b) 輝度 40 未満 (= 墨より暗い) の画素は描画領域の 0.5% 以下。
         黒・近黒は面ではなくインクとしてだけ使う、を面積で固定する。 */
      expect(
        dark / total,
        `${where}: 近黒の画素の割合 ${(dark / total).toFixed(4)}`,
      ).toBeLessThanOrEqual(PROFILE_DARK_AREA_MAX_RATIO);
    }
  },
};

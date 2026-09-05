import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import { ProfileStagePreview } from "@/components/viz/profile/profile-stage-preview";
import { buildStoryScene } from "@/lib/profile/story-fixtures";
import type { ProfileFacet } from "@/lib/profile/contract";

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

const ZOOM_LEVELS: Array<{ z: number; label: string }> = [
  { z: 0, label: "×1 (マクロ)" },
  { z: 1, label: "×10 (中間)" },
  { z: 2, label: "×100 (ミクロ)" },
];

const VIEWPORTS: Array<{ key: "pc" | "sp"; width: number; height: number }> = [
  { key: "pc", width: 1024, height: 640 },
  { key: "sp", width: 390, height: 640 },
];

function frame(width: number, height: number, children: React.ReactNode) {
  return (
    <div style={{ width, maxWidth: "100%", height }}>{children}</div>
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

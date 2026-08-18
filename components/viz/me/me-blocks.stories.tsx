import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";

import { CommunityLensBlock } from "./community/community-lens-block";
import { FlavorLensBlock } from "./flavor-lens/flavor-lens-block";
import { FootprintsBlock } from "./footprints/footprints-block";
import { WordGardenBlock } from "./garden/word-garden-block";

/**
 * 「わたしの茶」(`/dev/me`) の図 4 つ。
 *
 * どれも props は代替テキスト (`label`) だけで、中身は `lib/roji/me/*` の
 * ダミーデータが決める。差し替え口をデータ層に閉じてあるので、story から
 * 図の中身を差し込む口は開けない (本番ページと同じ経路で描く)。
 *
 * 4 つとも Canvas を毎フレーム回すので、実際の動き — 点が積もる・語が芽吹く・
 * 気配がゆらぐ — は静止画では分からない。ここで初めて動いて見える。
 */
const meta = {
  title: "Viz/Me",
  component: FootprintsBlock,
  parameters: {
    layout: "fullscreen",
    // 図の面の淡い濃淡を axe が文字扱いで拾うため (他の viz story と同じ理由)。
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
} satisfies Meta<typeof FootprintsBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 一 — 味わいの足あと。飲んだ一杯が味の座標に落ちて積もる。
 * 時間レンズ (この一ヶ月 / 半年 / ぜんぶ) で見える範囲が変わる。
 */
export const Footprints: Story = {
  args: {
    label:
      "飲んだ一杯を味の座標に置いた図。古い杯ほど小さく淡く、新しい杯ほど濃く出ます。",
  },
  render: (args) => (
    <VizStoryFrame heading="一   足 あ と">
      <FootprintsBlock {...args} />
    </VizStoryFrame>
  ),
};

/**
 * 二 — 好みの位置 (手もとのレンズ)。四象限の上に自分の来歴を重ねる。
 * 足あとレンズは既定 ON。
 */
export const FlavorLens: Story = {
  args: { label: "味の四象限に自分の飲んできた一杯を重ねた図。" },
  render: (args) => (
    <VizStoryFrame heading="二   好 み の 位 置">
      <FlavorLensBlock label={args.label} />
    </VizStoryFrame>
  ),
};

/** 二 — 足あとレンズを切った状態。四象限だけが残る。 */
export const FlavorLensWithoutFootprints: Story = {
  args: { label: "味の四象限のみ (自分の来歴を重ねない状態)。" },
  render: (args) => (
    <VizStoryFrame heading="二   好 み の 位 置 (足 あ と 無 し)">
      <FlavorLensBlock label={args.label} defaultFootprints={false} />
    </VizStoryFrame>
  ),
};

/** 三 — ことばの庭。書いてきた言葉が芽吹き、季節ごとに集まる。 */
export const WordGarden: Story = {
  args: { label: "これまでに書いた言葉を、季節ごとの庭に置いた図。" },
  render: (args) => (
    <VizStoryFrame heading="三   こ と ば の 庭">
      <WordGardenBlock {...args} />
    </VizStoryFrame>
  ),
};

/** 四 — みんなの気配。外の人の動きを、数字ではなく気配として置く。 */
export const CommunityLens: Story = {
  args: { label: "同じお茶を飲んでいる人の気配を、濃淡の場として置いた図。" },
  render: (args) => (
    <VizStoryFrame heading="四   み ん な の 気 配">
      <CommunityLensBlock {...args} />
    </VizStoryFrame>
  ),
};

/** 4 つを縦に並べる (`/dev/me` の読む順そのまま)。 */
export const AllSections: Story = {
  args: { label: "わたしの茶" },
  render: () => (
    <VizStoryFrame heading="わ た し の 茶">
      <div className="flex flex-col gap-24">
        <FootprintsBlock label="飲んだ一杯を味の座標に置いた図。" />
        <FlavorLensBlock label="味の四象限に自分の飲んできた一杯を重ねた図。" />
        <WordGardenBlock label="これまでに書いた言葉を、季節ごとの庭に置いた図。" />
        <CommunityLensBlock label="同じお茶を飲んでいる人の気配を、濃淡の場として置いた図。" />
      </div>
    </VizStoryFrame>
  ),
};

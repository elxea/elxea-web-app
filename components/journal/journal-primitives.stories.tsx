import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AuthorByline } from "./author-byline";
import { TimeMarker } from "./time-marker";

/**
 * Journal 本文まわりの小部品 (C1 Round 2)。
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 —
 * AuthorByline 7552:238 / TimeMarker 7552:23574。
 */
const meta = {
  title: "Journal/Primitives",
  component: AuthorByline,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AuthorByline>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 本文冒頭の 1 行クレジット (記事末尾の AuthorProfile とは別部品)。 */
export const Byline: Story = {
  args: { name: "佐藤 圭", role: "elxea / 編集" },
};

/** 肩書きの無い著者。 */
export const BylineNameOnly: Story = {
  args: { name: "佐藤 圭" },
};

/** 章見出し = 時刻。Figma の Ratio variant と 1:1 で対応する。 */
export const TimeMarkers: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <TimeMarker time="6:40" ratio={1.3} />
      <TimeMarker time="12:10" ratio={2.0} />
      <TimeMarker time="21:05" ratio={3.6} />
    </div>
  ),
};

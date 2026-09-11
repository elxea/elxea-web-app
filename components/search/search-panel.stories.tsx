import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InputUnderline, SearchPanel } from "./search-panel";

/**
 * Search / Panel — Figma `Common / Layouts` 7967:1325「開閉・アクション時UI」の
 * PC 検索オーバーレイ側 (7967:42105 / パネル 7967:42151)。
 */
const meta = {
  title: "Search/Panel",
  component: SearchPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const suggestions = [
  { label: "煎茶", href: "/search?q=sencha" },
  { label: "ほうじ茶", href: "/search?q=hojicha" },
  { label: "定期便", href: "/subscription" },
  { label: "ギフト", href: "/search?q=gift" },
];

/** Figma 7967:42151 — 開いた状態。入力 + よく探されるもの 4 件。 */
export const Open: Story = {
  args: {
    suggestions,
    suggestionsLabel: "よく探されるもの:",
    inputProps: { placeholder: "検索", "aria-label": "サイト内を検索" },
  },
};

/** 候補を出さない最小状態。 */
export const InputOnly: Story = {
  args: {
    inputProps: { placeholder: "検索", "aria-label": "サイト内を検索" },
  },
};

/** Figma 6936:126 — 入力部品だけを単体で見る。 */
export const Underline_Input: Story = {
  args: {},
  render: () => (
    <div className="p-8">
      <InputUnderline placeholder="検索" aria-label="サイト内を検索" />
    </div>
  ),
};

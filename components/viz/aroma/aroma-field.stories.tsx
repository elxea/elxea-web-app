import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import {
  TEA_CATEGORY_ORDER,
  TEA_CATEGORY_LABEL,
  type TeaCategory,
} from "@/lib/roji/tea-category";

import { AromaFieldBlock } from "./aroma-field-block";

/**
 * 香りの場 (AromaField)。
 *
 * 味の四象限と作法は共有するが、香りは **点ではなく領域**で置く。領域どうしの
 * 重なりが「香りの通じ合い」で、比較の図には見せない。データは
 * `lib/roji/tea-aroma.ts` が決め、story からは銘柄番号とカテゴリーしか渡さない。
 */
const meta = {
  title: "04 Visualizations/Flavor/AromaField",
  component: AromaFieldBlock,
  parameters: {
    layout: "fullscreen",
    // 図の面の淡い濃淡を axe が文字扱いで拾うため。理由は FlavorMatrix と同じ。
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  argTypes: {
    category: {
      control: "select",
      options: [...TEA_CATEGORY_ORDER],
      description: "六大茶類。場に重なる香りはこのカテゴリーだけに絞られる。",
    },
    menuNumber: { control: "text", description: "銘柄番号 (5 桁)。" },
  },
  decorators: [
    (Story) => (
      <VizStoryFrame heading="A R O M A   F I E L D">
        <Story />
      </VizStoryFrame>
    ),
  ],
} satisfies Meta<typeof AromaFieldBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 品目ページと同じ呼び方。1 つの香りがとくに立った状態。 */
export const Default: Story = {
  args: {
    menuNumber: "10101",
    category: "緑茶",
    label:
      "涼やかさとあたたかさ、立ちのぼる香りと底に残る香りの四象限に、香りの領域を重ねた図。",
  },
};

/** 銘柄番号が無いとき。どの香りも立たないカテゴリー全体の場になる。 */
export const NoHighlight: Story = {
  args: {
    menuNumber: null,
    category: "緑茶",
    label: "香りの領域を重ねた図。",
  },
};

/** 六大茶類の場を並べる。カテゴリーが変わると香りの族の重心ごと動く。 */
export const AllCategories: Story = {
  args: { menuNumber: null, label: "香りの場" },
  render: () => (
    <div className="flex flex-col gap-16">
      {TEA_CATEGORY_ORDER.map((category: TeaCategory) => (
        <div key={category}>
          <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
            {TEA_CATEGORY_LABEL[category]}
          </p>
          <AromaFieldBlock
            menuNumber={null}
            category={category}
            label={`${TEA_CATEGORY_LABEL[category]} の香りの場。`}
          />
        </div>
      ))}
    </div>
  ),
};

/** 火の側 (焙じ・後発酵) と草の側を並べて、場の重心の違いを見る。 */
export const FireAndGrass: Story = {
  args: { menuNumber: null, label: "香りの場" },
  render: () => (
    <div className="flex flex-col gap-16">
      {(["green", "dark"] as const).map((category) => (
        <div key={category}>
          <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
            {TEA_CATEGORY_LABEL[category]}
          </p>
          <AromaFieldBlock
            menuNumber={null}
            category={category}
            label={`${TEA_CATEGORY_LABEL[category]} の香りの場。`}
          />
        </div>
      ))}
    </div>
  ),
};

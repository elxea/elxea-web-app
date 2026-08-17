import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import {
  TEA_CATEGORY_ORDER,
  TEA_CATEGORY_LABEL,
  type TeaCategory,
} from "@/lib/roji/tea-category";

import { FlavorMatrixBlock } from "./flavor-matrix-block";

/**
 * 味の四象限 (FlavorMatrix)。
 *
 * 本番と同じ経路で描く — story が触るのは `FlavorMatrixBlock` の props
 * (銘柄番号とカテゴリー) だけで、点の座標も色も `lib/roji/tea-flavor.ts` が
 * 決める。図の中身を story から差し込む口は開けない (恒久ルール
 * `docs/roji-dataviz-rules.md`: 図に載るのは同一カテゴリーの銘柄のみ)。
 *
 * ## 触って分かること
 *
 * - `menuNumber` を変えると「いま見ている銘柄」の強調が移る (番号が同じなら
 *   何度開いても同じ点が濃くなる = 決定的)
 * - `category` を変えると図ごと入れ替わる。他カテゴリーの点は 1 つも混ざらない
 * - 濃い塊は SVG filter の合成を毎フレーム回しているので、実際の滲みの動きは
 *   静止画では分からない。ここで初めて動いて見える
 */
const meta = {
  title: "04 Visualizations/Flavor/FlavorMatrix",
  component: FlavorMatrixBlock,
  parameters: {
    layout: "fullscreen",
    // 図は Canvas / SVG の面で、地の色 (生成り) は roji のパレットが決める。
    // axe の color-contrast は面の中の淡い線まで文字として拾ってしまい、
    // 図の設計判断 (数字を出さず濃淡で語る) と噛み合わないため図の story では外す。
    // トークンに起因する違反ではない。
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  argTypes: {
    category: {
      control: "select",
      options: [...TEA_CATEGORY_ORDER],
      description: "六大茶類。図に載る銘柄はこのカテゴリーだけに絞られる。",
    },
    menuNumber: {
      control: "text",
      description: "銘柄番号 (5 桁)。先頭 1 桁がカテゴリーの一の矢になる。",
    },
  },
  decorators: [
    (Story) => (
      <VizStoryFrame heading="F L A V O R   M A P">
        <Story />
      </VizStoryFrame>
    ),
  ],
} satisfies Meta<typeof FlavorMatrixBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 品目ページと同じ呼び方。緑茶の 1 銘柄を強調した状態。 */
export const Default: Story = {
  args: {
    menuNumber: "10101",
    category: "緑茶",
    label:
      "甘みと渋み、軽やかさと濃厚さの四象限に銘柄を置いた図。1 つの銘柄がこの中で強く出ています。",
  },
};

/** 銘柄番号が無いとき (一覧・プレビュー)。強調なしのカテゴリー全体図になる。 */
export const NoHighlight: Story = {
  args: {
    menuNumber: null,
    category: "緑茶",
    label: "甘みと渋み、軽やかさと濃厚さの四象限に銘柄を置いた図。",
  },
};

/**
 * 六大茶類を並べる。色はカテゴリーだけが決めるので、6 枚の色の差が
 * そのままカテゴリーの差になる。
 */
export const AllCategories: Story = {
  args: { menuNumber: null, label: "四象限" },
  render: () => (
    <div className="flex flex-col gap-16">
      {TEA_CATEGORY_ORDER.map((category: TeaCategory) => (
        <div key={category}>
          <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
            {TEA_CATEGORY_LABEL[category]}
          </p>
          <FlavorMatrixBlock
            menuNumber={null}
            category={category}
            label={`${TEA_CATEGORY_LABEL[category]} の味の四象限。`}
          />
        </div>
      ))}
    </div>
  ),
};

/**
 * 同じカテゴリーで銘柄番号だけを変える。強調が別の点へ移り、
 * 図そのもの (点の配置) は動かないことが確かめられる。
 */
export const HighlightMovesWithMenuNumber: Story = {
  args: { menuNumber: "10101", label: "四象限" },
  render: () => (
    <div className="flex flex-col gap-16">
      {["10101", "10401", "11301", "11501"].map((menuNumber) => (
        <div key={menuNumber}>
          <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
            {menuNumber}
          </p>
          <FlavorMatrixBlock
            menuNumber={menuNumber}
            category="緑茶"
            label={`銘柄 ${menuNumber} を強調した味の四象限。`}
          />
        </div>
      ))}
    </div>
  ),
};

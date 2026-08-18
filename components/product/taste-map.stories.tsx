import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TasteMap } from "./taste-map";

/** 味×香りマトリクス — Figma PC 8056:1639 / SP 8058:1803。 */
const meta = {
  title: "Product/TasteMap",
  component: TasteMap,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TasteMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    points: [
      { label: "青い草の香り", x: 26.5, y: 20.5 },
      { label: "蒸した栗のような甘み", x: 56.8, y: 35.6, align: "left" },
      { label: "厚い旨み", x: 75, y: 62.9 },
      { label: "二煎目の渋み", x: 25, y: 73.5 },
    ],
    legendLead:
      "図の見方 — 横軸: 味（すっきり ↔ 濃厚）／ 縦軸: 香り（穏やか ↔ 華やか）。点線は淹れ方で動く範囲。",
    legendRows: [
      { term: "旨み", body: "低温・長めに出すほど厚くなる" },
      { term: "渋み", body: "湯温を上げると立ち上がる" },
      { term: "香り", body: "淹れたての立ち香がいちばん強い" },
    ],
  },
};

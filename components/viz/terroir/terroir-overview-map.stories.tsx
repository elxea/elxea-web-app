import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import { TEA_CATEGORY_LABEL } from "@/lib/roji/tea-category";
import { TEA_MENU_NUMBERS } from "@/lib/roji/tea-origins";
import type { TerroirOverviewItem } from "@/lib/roji/tea-terroir-overview";

import { TerroirOverviewBlock } from "./terroir-overview-block";

/**
 * リスト概観のテロワール地図 (TerroirOverviewMap)。
 *
 * 一覧に出ているお茶の産地を 1 枚に置き、**表示中の点が全部収まる尺度に
 * 自動で合わせる**。品目詳細の「土地を読む」が固定尺度なのと対になる図。
 *
 * ## 触って分かること
 *
 * - `items` を絞ると画角が追従する。1 件だけにしても最大ズームまで寄らず、
 *   土地の襞が見える広さで止まる (`OVERVIEW_MIN_SPAN_*`)
 * - 点の色はお茶のカテゴリー。同じ座標でもカテゴリーが違えば別の点になる
 * - 座標が 1 件も引けない集合ではブロックごと出ない (壊れた地図を出さない)
 *
 * WebGL が要る点は `TerroirLensMap` と同じ。
 */
const meta = {
  title: "04 Visualizations/Terroir/OverviewMap",
  component: TerroirOverviewBlock,
  parameters: {
    layout: "fullscreen",
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  decorators: [
    (Story) => (
      <VizStoryFrame heading="O R I G I N S">
        <Story />
      </VizStoryFrame>
    ),
  ],
} satisfies Meta<typeof TerroirOverviewBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

const LABEL =
  "いま一覧に出ているお茶の産地を、その全部が収まる尺度で示した地図。点の色はお茶のカテゴリーです。";

/** 銘柄番号の一覧から `items` を組む (一覧ページと同じ形)。 */
function itemsOf(menuNumbers: readonly string[]): TerroirOverviewItem[] {
  return menuNumbers.map((menuNumber) => ({
    id: menuNumber,
    menuNumber,
    origin: null,
    category: null,
  }));
}

/** 一覧の既定 — 対応表にある銘柄を全部載せた状態。 */
export const AllOrigins: Story = {
  args: { items: itemsOf(TEA_MENU_NUMBERS), label: LABEL },
};

/** カテゴリーで絞った状態 (緑茶のみ)。地図は単色になり、画角も追従する。 */
export const GreenOnly: Story = {
  args: {
    items: itemsOf(TEA_MENU_NUMBERS.filter((n) => n.startsWith("1"))),
    label: LABEL,
  },
};

/** 1 件だけ。0 幅の矩形に寄り切らず、最小の広がりが確保される。 */
export const SinglePin: Story = {
  args: { items: itemsOf(["10401"]), label: LABEL },
};

/**
 * Sanity の自由記述だけで座標を引く経路 (`productNumber` が 5 桁でない個体)。
 * 都道府県の代表点に落ちるので、点は淡く小さく出る。
 */
export const FromPlaceTextOnly: Story = {
  args: {
    items: [
      { id: "a", menuNumber: "ELX-2026-04", origin: "静岡県牧之原市", category: "煎茶" },
      { id: "b", menuNumber: 1, origin: "宮崎県西臼杵郡五ヶ瀬町", category: "釜炒り茶" },
      { id: "c", menuNumber: null, origin: "鹿児島県霧島市", category: "和紅茶" },
    ],
    label: LABEL,
  },
};

/** 座標が 1 件も引けない集合。ブロックごと描かれない (下に何も出ないのが正)。 */
export const NoResolvableOrigin: Story = {
  args: {
    items: [{ id: "x", menuNumber: null, origin: "産地不明", category: null }],
    label: LABEL,
  },
  render: (args) => (
    <div>
      <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
        こ の 下 に 地 図 は 出 な い
      </p>
      <TerroirOverviewBlock {...args} />
    </div>
  ),
};

/** カテゴリーごとの色の対照表 (凡例として読む)。 */
export const ByCategory: Story = {
  args: { items: itemsOf(TEA_MENU_NUMBERS), label: LABEL },
  render: () => (
    <div className="flex flex-col gap-16">
      {/* 銘柄番号の先頭 1 桁がカテゴリー (`CATEGORY_BY_LEADING_DIGIT`)。
          対応表に 1 件も無い桁は地図ごと出ないので、実在する桁だけを並べる。 */}
      {(
        [
          ["1", "green"],
          ["4", "blue"],
          ["5", "black"],
        ] as const
      ).map(([digit, category]) => {
        const items = itemsOf(TEA_MENU_NUMBERS.filter((n) => n.startsWith(digit)));
        if (items.length === 0) return null;
        return (
          <div key={digit}>
            <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
              {TEA_CATEGORY_LABEL[category]}
            </p>
            <TerroirOverviewBlock items={items} label={LABEL} />
          </div>
        );
      })}
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { VizStoryFrame } from "@/components/viz/viz-story-frame";
import { resolveTeaOrigin, resolveTeaOriginPlace } from "@/lib/roji/tea-origins";

import { TerroirLensBlock } from "./terroir-lens-block";

/**
 * 土地を読む (TerroirLensMap) — 5 つのレンズで 1 つの産地を見る地図。
 *
 * ## 見るときの前提
 *
 * - **WebGL が要る**。maplibre-gl が地形を描くので、ソフトウェアレンダラでは
 *   絵が出ない。Chrome / Safari の通常のタブなら問題ない
 * - **標高タイルを外から取る**。初回は数十枚の DEM を読むので、絵が組み上がる
 *   まで数秒かかる。オフラインでは地形が出ない (枠と凡例だけが出る)
 * - 品目ページで最も重い部品なので、本番では画面に近づくまで 1 バイトも
 *   落とさない (`useInViewOnce`)。story でも同じ経路を通る
 *
 * ## 触って分かること
 *
 * 標高 / 地形図 / 気候 / 土 / 茶園 の 5 レンズを切り替えると、同じ土地が
 * 別々の読まれ方をする。茶園の点に触れると土地の言葉が出る (数字は標高だけ)。
 */
const meta = {
  title: "04 Visualizations/Terroir/LensMap",
  component: TerroirLensBlock,
  parameters: {
    layout: "fullscreen",
    // 地図の面 (DEM の濃淡・ハッチング) を axe が文字扱いで拾うため。
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  decorators: [
    (Story) => (
      <VizStoryFrame heading="T E R R O I R">
        <Story />
      </VizStoryFrame>
    ),
  ],
} satisfies Meta<typeof TerroirLensBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 品目ページと同じ copy。銘柄番号から実測座標を引いて渡す。 */
const COPY = {
  elevationUnit: "標 高 {value} m",
  teaLabel: "銘 柄",
  close: "閉じる",
  hint: "点 に 触 れ る と 土 地 の 性 格",
} as const;

/** 銘柄番号から `TerroirLensBlock` の引数を組む (品目ページと同じ手順)。 */
function argsForMenuNumber(menuNumber: string) {
  const origin = resolveTeaOrigin(menuNumber);
  const place = resolveTeaOriginPlace(menuNumber);
  return {
    origin: { lat: origin.lat, lng: origin.lng },
    placeLabel: place,
    label: `${place ?? "産地"} の地形を、標高・地形図・気候・土・茶園の五つのレンズで見る地図。`,
    copy: COPY,
  };
}

/** 静岡・大井川流域 (roji の主産地)。 */
export const Default: Story = {
  args: argsForMenuNumber("10101"),
};

/** 宮崎・五ヶ瀬。山あいの起伏が強く、標高レンズの階調が大きく振れる。 */
export const Gokase: Story = {
  args: argsForMenuNumber("10401"),
};

/** 座標が引けない銘柄。既定の主産地 (川根本町・大井川流域) に落ちる。 */
export const FallbackOrigin: Story = {
  args: {
    origin: { lat: null, lng: null },
    placeLabel: null,
    label: "産地の地形を、標高・地形図・気候・土・茶園の五つのレンズで見る地図。",
    copy: COPY,
  },
};

/**
 * 産地を並べる。同じ 5 レンズでも土地が変われば読み取れるものが変わる
 * (WebGL コンテキストを 3 枚同時に使うので、他より重い)。
 */
export const Origins: Story = {
  args: argsForMenuNumber("10101"),
  render: () => (
    <div className="flex flex-col gap-16">
      {["10101", "10401", "11301"].map((menuNumber) => {
        const args = argsForMenuNumber(menuNumber);
        return (
          <div key={menuNumber}>
            <p className="mb-4 text-sm" style={{ letterSpacing: "0.2em" }}>
              {args.placeLabel ?? menuNumber}
            </p>
            <TerroirLensBlock {...args} />
          </div>
        );
      })}
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  CatalogCard,
  CatalogGrid,
  KindIndex,
  ListPageHead,
  MoreRow,
} from "./catalog-list";

/**
 * Figma【R2: 確定版】共通リストパターン (商品一覧 8061:1781 / 8062:2008、
 * お茶メニュー 8063:2144 / 8063:2372) の骨格部品。
 */
const meta = {
  title: "Catalog/List Pattern",
  component: ListPageHead,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ListPageHead>;

export default meta;
type Story = StoryObj<typeof meta>;

/** PageHead — 英字キッカー + 日本語見出し + リード (Figma 8061:1785)。 */
export const PageHead: Story = {
  args: {
    overline: "ALL PRODUCTS",
    title: "商品一覧",
    lead: "日本各地の茶農家から届いたお茶と茶器。旬のものから日常の一杯まで。",
  },
};

const cards = [
  { title: "さえみどり 煎茶", overline: "八女", meta: "¥1,296" },
  { title: "やぶきた 深蒸し", overline: "静岡", meta: "¥1,080" },
  { title: "焙じ番茶", overline: "京都", meta: "¥864" },
  { title: "かぶせ茶", overline: "三重", meta: "¥1,512" },
  { title: "和紅茶 べにふうき", overline: "鹿児島", meta: "¥1,404" },
  { title: "釜炒り茶", overline: "宮崎", meta: "¥1,188" },
];

/** Grid — SP 2 列 (gap 16/24) / PC 3 列 (gap 32/48)。 */
export const Grid: StoryObj = {
  render: () => (
    <CatalogGrid>
      {cards.map((card) => (
        <CatalogCard key={card.title} href="#" {...card} />
      ))}
    </CatalogGrid>
  ),
};

/** 種類から探す — SP 専用の 2 列テキスト索引 (Figma 8062:2077)。 */
export const KindIndexStory: StoryObj = {
  name: "KindIndex (SP)",
  render: () => (
    <KindIndex
      title="種類から探す"
      entries={[
        { label: "煎茶", count: 8, href: "#" },
        { label: "深蒸し煎茶", count: 4, href: "#" },
        { label: "かぶせ茶", count: 2, href: "#" },
        { label: "ほうじ茶", count: 5, href: "#" },
      ]}
    />
  ),
};

/** もっと見る — 高さ 48 のピル (Figma 8061:2008)。 */
export const More: StoryObj = {
  render: () => <MoreRow href="#" label="さらに 12 件を表示" />,
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { FavoritesBoard } from "@/components/account/favorites-board";
import {
  groupFavorites,
  normalizeFavorites,
  type FavoriteInput,
} from "@/lib/account-favorites";

/**
 * お気に入り一覧 (/ja/account/favorites) の本体。
 *
 * story は「種類別に並ぶ」「0 件の種類も枠が残る」「各カードに解除がある」の 3 点を
 * 目で確かめるためのもの。文言は preview の `NextIntlClientProvider` (ja) から来る。
 * 解除ボタンは実 API (`DELETE /api/user/favorites`) を叩くので、Storybook では
 * 失敗トーストが出る (それが期待動作 — 失敗したらカードが元の位置に戻る)。
 */
const favorites: FavoriteInput[] = [
  {
    id: "a1",
    type: "article",
    targetId: "hiire",
    title: "火入れという時間のかけ方",
    imageUrl: "/hero-day.jpg",
    createdAt: "2026-08-18T02:00:00.000Z",
  },
  {
    id: "a2",
    type: "article",
    targetId: "yame",
    title: "八女、白折の朝",
    imageUrl: "/hero-night.jpg",
    createdAt: "2026-08-11T02:00:00.000Z",
  },
  {
    id: "p1",
    type: "product",
    targetId: "yamakage",
    title: "深蒸し煎茶「やまかげ」",
    imageUrl: "/hero-approach.jpg",
    createdAt: "2026-08-16T02:00:00.000Z",
  },
];

const meta = {
  title: "Account/FavoritesBoard",
  component: FavoritesBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FavoritesBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 商品と読みものが両方ある状態 (種類ごとに節が分かれる)。 */
export const Default: Story = {
  args: { groups: groupFavorites(normalizeFavorites(favorites)) },
};

/** 読みものだけがある状態。商品の節は **消さずに** 空のまま残す。 */
export const OneKindEmpty: Story = {
  args: {
    groups: groupFavorites(
      normalizeFavorites(favorites.filter((favorite) => favorite.type === "article"))
    ),
  },
};

/** 1 件も無い状態。どの種類も枠と「探しに行く」導線だけが残る。 */
export const Empty: Story = {
  args: { groups: groupFavorites([]) },
};

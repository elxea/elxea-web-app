import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

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
  {
    id: "pe1",
    type: "person",
    targetId: "masayuki-kubo",
    title: "久保 雅之",
    imageUrl: "/hero-day.jpg",
    createdAt: "2026-08-19T02:00:00.000Z",
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

/**
 * 人だけがある状態 (F4 で足した 3 つ目の種類)。
 *
 * 人はカードから `/people/{slug}` へ飛び、解除も商品・読みものと同じ。
 * 0 件のときの導線だけは `/people` (存在しない一覧) ではなく読みものを指す。
 */
export const PeopleOnly: Story = {
  args: {
    groups: groupFavorites(
      normalizeFavorites(favorites.filter((favorite) => favorite.type === "person"))
    ),
  },
};

/** その節の見出し脇に出ている件数 (「2件」等)。0 件の節では出ないので null。 */
function kindCount(root: HTMLElement, kind: string): string | null {
  const section = root.querySelector(`[data-slot="favorites-group"][data-kind="${kind}"]`);
  if (!section) throw new Error(`${kind} の節が描かれていない`);
  return section.querySelector("h2 span span")?.textContent ?? null;
}

/**
 * 節の見出し「お気に入り」の脇に出ている合計。
 *
 * マイページ本体の 1 節になったので、見出しはページ見出し (`AccountTitleBlock`)
 * ではなく節見出し (`AccountSectionHeader`) が担う。分類ごとの節も同じ部品を使う
 * ため、**分類の節の中に無い方** (= 最初に現れる、板全体の見出し) を取る。
 */
function totalCount(root: HTMLElement): string {
  const header = Array.from(
    root.querySelectorAll('[data-slot="account-section-header"]')
  ).find((el) => !el.closest('[data-slot="favorites-group"]'));
  if (!header) throw new Error("お気に入りの節見出しが描かれていない");
  return header.querySelector("h2 span span")?.textContent ?? "";
}

/**
 * 解除したら **合計件数もその場で減る** (F14 / 本番実測 2026-08-25)。
 *
 * 起きていたこと: 3 件のうち 1 件を解除するとカードは即消えるのに、上部の合計は
 * 「3件」のまま残り、リロードして初めて「2件」に正っていた。合計だけがページ
 * (server component) 側で一度きり数えられていて、解除の状態と繋がっていなかった。
 *
 * ここで縛るのは「解除の直後」の 1 点だけ。初期表示は壊れていても緑になるので
 * (壊れるのは解除した後だけ)、押した後の合計・節の件数・カード枚数の 3 つが
 * 揃って減ることを見る。
 */
export const RemoveUpdatesCounts: Story = {
  args: { groups: groupFavorites(normalizeFavorites(favorites)) },
  beforeEach: async () => {
    const originalFetch = window.fetch;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      // 解除だけが本題。成功で返し、画面の側の追従を見る。
      if (url.includes("/api/user/favorites") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // 行動ログ等、本題に関係ない送信は握り潰す。
      return new Response("{}", { status: 200 });
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
    };
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("解除する前は 4 件 (読みもの 2 / 商品 1 / 人 1)", async () => {
      await expect(totalCount(canvasElement)).toBe("4件");
      await expect(kindCount(canvasElement, "article")).toBe("2件");
    });

    await step("読みものを 1 件解除する", async () => {
      await userEvent.click(
        canvas.getByRole("button", { name: "「火入れという時間のかけ方」をお気に入りから外す" })
      );
      await waitFor(async () => {
        await expect(canvas.queryByText("火入れという時間のかけ方")).toBeNull();
      });
    });

    await step("合計も節の件数も、リロードを待たずに減る", async () => {
      await waitFor(async () => {
        await expect(totalCount(canvasElement)).toBe("3件");
      });
      await expect(kindCount(canvasElement, "article")).toBe("1件");
      // 他の種類は巻き込まれない。
      await expect(kindCount(canvasElement, "product")).toBe("1件");
      await expect(kindCount(canvasElement, "person")).toBe("1件");
    });
  },
};

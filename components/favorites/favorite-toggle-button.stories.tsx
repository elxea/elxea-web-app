import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { isolateCookies } from "../../.storybook/story-cookies";
import { __resetFavoritesStoreForTest } from "@/lib/favorites/client-store";

import { FavoriteToggleButton } from "./favorite-toggle-button";

/**
 * 種類を問わない保存トグル。ここでは **人** (`/people/[slug]`) の保存を検査する。
 *
 * ## なぜ story で検査するのか
 *
 * この部品の壊れ方は時間の中にある。「一覧の取り込み」「押下」「書き込み」が
 * 非同期に走り、着地の順番がずれたときだけ画面が嘘をつく。unit 側
 * (`__tests__/favorite-toggle-button.test.tsx`) は node で静的に描くので
 * effect が走らず、順番の問題は原理的に見えない。
 *
 * 加えてここでは **どんな要求を投げているか** も見る。人の保存は「種類 = person /
 * 識別子 = 人の slug」で書けていないと、保存できたように見えてマイページに出ない
 * (種類違い) か、別人が保存される (識別子違い) 事故になる。
 *
 * ## 倉庫はモジュール変数なので、story ごとに空にする
 *
 * 登録状態は `lib/favorites/client-store.ts` が**タブに 1 つ**持つ。story は同じ
 * iframe を共有して走るので、前の story が残した状態を引き継ぐと結果が順番に
 * 依存する。`beforeEach` で必ず空にする。
 */
const meta = {
  title: "Favorites/FavoriteToggleButton",
  component: FavoriteToggleButton,
  tags: ["autodocs"],
  args: {
    kind: "person" as const,
    targetId: "masayuki-kubo",
    title: "久保 雅之",
    imageUrl: null,
    labels: {
      add: "この人を保存",
      remove: "保存をやめる",
      saved: "保存済み",
      added: "マイページに保存しました",
      removed: "保存をやめました",
      error: "操作に失敗しました",
      loginRequiredMessage: "保存するにはログインが必要です",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "商品・読みもの・人で共通の保存トグル。種類も見た目も引数で受け取る。状態はタブに 1 つの倉庫から読むので、途中の文言も途中の見た目も無い。",
      },
    },
  },
} satisfies Meta<typeof FavoriteToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 未ログイン。**素の「保存する」のまま**で、押すとログインを促す。
 *
 * 以前ここは「ログインすると保存できます」という別のラベルに差し替わっていた。
 * cookie はブラウザでしか読めないので最初の描画では分からず、後から文字が
 * 差し替わってその場のレイアウトが動いていた。ログインしていない人にとって
 * 押す前に知る必要のない事実なので、押したときに伝える。
 *
 * ## cookie を「無いはず」に頼らない
 *
 * story はブラウザの 1 ページを共有して走るので、別の story が置いた cookie が
 * 残っていることがある。共有の jar を使わず、この iframe だけの入れ物に差し替える
 * (`.storybook/story-cookies.ts`)。
 */
export const LoggedOut: Story = {
  beforeEach: () => {
    __resetFavoritesStoreForTest();
    return isolateCookies();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("button")).toHaveTextContent("この人を保存");
    });
    await expect(canvas.getByRole("button")).toBeEnabled();
  },
};

/** 押下で実際に飛んだ書き込み要求を覚えておく (play から中身を見る)。 */
let lastPostBody: Record<string, unknown> | null = null;

/**
 * **人として保存され、押した結果がそのまま残ること。**
 *
 * 見ているのは 3 つ:
 *
 * 1. 一覧の取り込みが終わる前でも押せて、**途中の文言が出ない**
 *    (以前は「保存の状態を確認しています」に差し替わり、幅が変わっていた)
 * 2. 書き込み要求が `type: "person"` / `targetId: 人の slug` であること
 * 3. 遅れて届いた取り込み結果が、確定した「保存済み」を巻き戻さないこと
 *    (記事の保存ボタンで実際に起きた事故)
 */
export const SavesAsPerson: Story = {
  beforeEach: async () => {
    const originalFetch = window.fetch;

    __resetFavoritesStoreForTest();
    lastPostBody = null;
    let releaseListing: (() => void) | undefined;
    const listingLanded = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });

    // ログイン済みとして扱わせる (部品は cookie だけを見る)。共有の jar を
    // 汚すと、並行して走る他ファイルの「未ログイン」の story を巻き込む。
    const restoreCookies = isolateCookies("shop_auth=1");

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/user/favorites")) {
        if (method === "GET") {
          // 一覧の取り込み / 1 件の確認。押下と書き込みが終わるまで着地させない。
          await listingLanded;
          return new Response(
            url.includes("check=")
              ? JSON.stringify({ favorited: false })
              : JSON.stringify({ favorites: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (method === "POST") {
          lastPostBody = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }

      // 行動ログ等、本題に関係ない送信は握り潰す。
      return new Response("{}", { status: 200 });
    }) as typeof window.fetch;

    (window as unknown as { __releaseListing?: () => void }).__releaseListing =
      releaseListing;

    return () => {
      releaseListing?.();
      window.fetch = originalFetch;
      restoreCookies();
      __resetFavoritesStoreForTest();
    };
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    await step("取り込みが返る前でも押せて、途中の文言は出ない", async () => {
      await expect(button).toBeEnabled();
      await expect(button).toHaveTextContent("この人を保存");
      await expect(button).toHaveAttribute("data-state", "unknown");
      await userEvent.click(button);
    });

    await step("取り込みを着地させると、人として保存され確定する", async () => {
      (window as unknown as { __releaseListing?: () => void }).__releaseListing?.();

      await waitFor(async () => {
        await expect(button).toHaveTextContent("保存済み");
      });
      await expect(lastPostBody).toMatchObject({
        type: "person",
        targetId: "masayuki-kubo",
        title: "久保 雅之",
      });
    });

    await step("遅れていた取り込み結果が着地しても巻き戻らない", async () => {
      // 着地を処理する猶予を与える (採用されるなら、この間に巻き戻る)。
      await new Promise((resolve) => setTimeout(resolve, 80));

      await expect(button).toHaveTextContent("保存済み");
      await expect(button).toHaveAttribute("aria-pressed", "true");
    });
  },
};

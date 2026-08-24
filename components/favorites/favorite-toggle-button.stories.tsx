import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { FavoriteToggleButton } from "./favorite-toggle-button";

/**
 * 種類を問わない保存トグル。ここでは **人** (`/people/[slug]`) の保存を検査する。
 *
 * ## なぜ story で検査するのか
 *
 * この部品の壊れ方は時間の中にある。「マウント時の確認」「押下」「書き込み」が
 * 非同期に走り、着地の順番がずれたときだけ画面が嘘をつく。unit 側
 * (`__tests__/favorite-toggle-button.test.tsx`) は node で静的に描くので
 * effect が走らず、順番の問題は原理的に見えない。
 *
 * 加えてここでは **どんな要求を投げているか** も見る。人の保存は「種類 = person /
 * 識別子 = 人の slug」で書けていないと、保存できたように見えてマイページに出ない
 * (種類違い) か、別人が保存される (識別子違い) 事故になる。要求の中身は静的な
 * 描画では見えないので、実クリックできるここが唯一の検査場所になる。
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
      loading: "保存の状態を確認しています",
      loginRequired: "ログインすると保存できます",
      statusUnknown: "保存の状態を取得できませんでした",
      added: "マイページに保存しました",
      removed: "保存をやめました",
      error: "操作に失敗しました",
      loginRequiredMessage: "保存するにはログインが必要です",
      statusRetry: "保存の状態をもう一度確認しています",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "商品・読みもの・人で共通の保存トグル。種類は引数で受け取る。確認が終わる前でも押せる（押下時に確認してから実行する）。",
      },
    },
  },
} satisfies Meta<typeof FavoriteToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 未ログイン (cookie なし)。押すとログインを促す。 */
export const LoggedOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("button")).toHaveTextContent(
        "ログインすると保存できます"
      );
    });
  },
};

/** 押下で実際に飛んだ書き込み要求を覚えておく (play から中身を見る)。 */
let lastPostBody: Record<string, unknown> | null = null;

/**
 * **人として保存され、押した結果がそのまま残ること。**
 *
 * 見ているのは 2 つ:
 *
 * 1. 書き込み要求が `type: "person"` / `targetId: 人の slug` であること
 *    (ここが違うと、保存できたように見えてマイページの「お気に入りの人」に出ない)
 * 2. 遅れて届いた確認応答が、確定した「保存済み」を巻き戻さないこと
 *    (記事の保存ボタンで実際に起きた事故。通し番号のガードが効いているか)
 */
export const SavesAsPerson: Story = {
  beforeEach: async () => {
    const originalFetch = window.fetch;

    lastPostBody = null;
    let getCount = 0;
    let releaseStaleCheck: (() => void) | undefined;
    const staleCheckLanded = new Promise<void>((resolve) => {
      releaseStaleCheck = resolve;
    });

    // ログイン済みとして扱わせる (部品は cookie だけを見る)。
    document.cookie = "shop_auth=1; path=/";

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/user/favorites")) {
        if (method === "GET") {
          getCount += 1;
          // 1 本目 = マウント時の確認。押下と書き込みが終わるまで着地させない。
          if (getCount === 1) await staleCheckLanded;
          return new Response(JSON.stringify({ favorited: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST") {
          lastPostBody = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }

      // 行動ログ等、本題に関係ない送信は握り潰す。
      return new Response("{}", { status: 200 });
    }) as typeof window.fetch;

    // play が終わったら必ず解放する (保留のままだと後続 story を巻き込む)。
    (window as unknown as { __releaseStaleCheck?: () => void }).__releaseStaleCheck =
      releaseStaleCheck;

    return () => {
      releaseStaleCheck?.();
      window.fetch = originalFetch;
      document.cookie = "shop_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    };
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    await step("確認が返る前でもボタンは押せる", async () => {
      await expect(button).toBeEnabled();
      await expect(button).toHaveAttribute("data-state", "loading");
      await userEvent.click(button);
    });

    await step("人として保存され「保存済み」で確定する", async () => {
      await waitFor(async () => {
        await expect(button).toHaveTextContent("保存済み");
      });
      await expect(lastPostBody).toMatchObject({
        type: "person",
        targetId: "masayuki-kubo",
        title: "久保 雅之",
      });
    });

    await step("遅れていた確認応答が着地しても巻き戻らない", async () => {
      (window as unknown as { __releaseStaleCheck?: () => void }).__releaseStaleCheck?.();
      // 着地を処理する猶予を与える (採用されるなら、この間に巻き戻る)。
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(button).toHaveTextContent("保存済み");
      await expect(button).toHaveAttribute("aria-pressed", "true");
    });
  },
};

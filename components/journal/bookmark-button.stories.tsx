import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { isolateCookies } from "../../.storybook/story-cookies";

import { BookmarkButton } from "./bookmark-button";

/**
 * 記事のブックマークボタン。
 *
 * ## なぜ story で検査するのか（この不具合は静的な描画では捕まらない）
 *
 * この部品の壊れ方は**時間の中にしかない**。「マウント時の確認」「お客さまの押下」
 * 「書き込み」の 3 つが非同期に走り、着地の順番がずれたときだけ画面が嘘をつく。
 * unit 側（`__tests__/bookmark-button-pressable.test.tsx`）は node で静的に描いて
 * 「最初の描画で押せるか」を縛っているが、effect が走らないので**順番の問題は
 * 原理的に見えない**。本物の DOM で本当にクリックし、応答の着地順を操作できる
 * ここが、その検査ができる唯一の場所になる。
 *
 * `StaleCheckDoesNotRollBack` の play は storybook-tests（CI 必須チェック）で毎回
 * 走るので、story であると同時に回帰検査でもある。
 */
const meta = {
  title: "Journal/BookmarkButton",
  component: BookmarkButton,
  tags: ["autodocs"],
  args: {
    articleSlug: "story-article",
    articleTitle: "テスト記事",
    articleImageUrl: null,
    addLabel: "ブックマークに追加",
    removeLabel: "ブックマークから削除",
    savedLabel: "保存済み",
    loadingLabel: "ブックマークの状態を確認しています",
    loginRequiredLabel: "ログインして保存",
    statusUnknownLabel: "状態を取得できませんでした",
    addedMessage: "追加しました",
    removedMessage: "削除しました",
    errorMessage: "失敗しました",
    loginRequiredMessage: "ログインが必要です",
    statusRetryMessage: "もう一度確認しています",
  },
  parameters: {
    docs: {
      description: {
        component:
          "記事のブックマーク。確認が終わる前でも押せる（押下時に確認してから実行する）。押した結果は、遅れて届いた古い確認応答に巻き戻されない。",
      },
    },
  },
} satisfies Meta<typeof BookmarkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 未ログイン（cookie なし）。押すとログインを促す。 */
export const LoggedOut: Story = {
  /* 未ログイン = cookie が無い状態。共有の jar は他のファイルの story が
     「ログイン済み」を置いている最中かもしれないので、この iframe だけの
     空の入れ物に差し替えてから描く (`.storybook/story-cookies.ts`)。 */
  beforeEach: () => isolateCookies(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("button")).toHaveTextContent(
        "ログインして保存"
      );
    });
  },
};

/* ---------------------------------------------------------------------------
 * 遅れて着地する確認応答を作るための仕掛け
 *
 * cookie も fetch の差し替えも **render より前** に済ませる必要がある。部品は
 * マウント直後に cookie を読んで確認 (GET) を投げるので、play (= render 後) で
 * 差し替えても間に合わない — 本物の fetch に出ていったあとになる。よって
 * `beforeEach` で仕込み、play からは解放レバーと回数だけを触る。
 * ------------------------------------------------------------------------- */

/** 1 本目の GET を着地させるレバー。play が任意のタイミングで引く。 */
let releaseStaleCheck: (() => void) | undefined;
let getCount = 0;
let postCount = 0;

/**
 * **遅れて届いた確認応答が、確定済みの登録を巻き戻さないこと。**
 *
 * ## 再現する事故
 *
 * 1. 記事を開く → マウント時の確認 (GET) が飛ぶ。回線が遅く、まだ返ってこない
 * 2. お客さまがボタンを押す → 押下時の確認 → 書き込み (POST) → **「保存済み」で確定**
 * 3. ここで 1 の GET がようやく着地する。中身は**押す前の状態**（＝未登録）
 *
 * 3 の答えをそのまま採用すると、確定したはずの「保存済み」が「追加」に戻る。
 * 画面上は「押したのに勝手に外れた」に見え、しかもサーバ側は登録済みなので、
 * もう一度押すと今度は**登録を解除**してしまう（見た目と実体が逆になる）。
 *
 * ## なぜ真偽値のガードでは足りなかったか
 *
 * 「書き込み中は確認の応答を捨てる」だけでは 3 を止められない。2 の書き込みは
 * 既に**終わっている**ので、フラグは false に戻っており、3 は素通りする。
 * 止めるには「その確認を投げたあとに書き込みが挟まったか」を見る必要があり、
 * 実装は単調増加の通し番号でそれを判定している。
 */
export const StaleCheckDoesNotRollBack: Story = {
  beforeEach: async () => {
    const originalFetch = window.fetch;

    releaseStaleCheck = undefined;
    getCount = 0;
    postCount = 0;

    const staleCheckLanded = new Promise<void>((resolve) => {
      releaseStaleCheck = resolve;
    });

    // ログイン済みとして扱わせる（部品は cookie だけを見る）。共有の jar を
    // 汚すと、並行して走る他ファイルの「未ログイン」の story を巻き込む。
    const restoreCookies = isolateCookies("shop_auth=1");

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/user/favorites")) {
        if (method === "GET") {
          getCount += 1;
          // 1 本目 = マウント時の確認。押下と書き込みが終わるまで着地させない。
          if (getCount === 1) await staleCheckLanded;
          // どちらの GET も「まだ登録されていない」と答える。
          return new Response(JSON.stringify({ favorited: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST") {
          postCount += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }

      // 行動ログ等、本題に関係ない送信は握り潰す。
      return new Response("{}", { status: 200 });
    }) as typeof window.fetch;

    return () => {
      // 保留したままだと fetch が永久に解決せず、後続の story を巻き込む。
      releaseStaleCheck?.();
      window.fetch = originalFetch;
      restoreCookies();
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

    await step("書き込みが完了し「保存済み」で確定する", async () => {
      await waitFor(async () => {
        await expect(button).toHaveTextContent("保存済み");
      });
      await expect(postCount).toBe(1);
    });

    await step("ここで遅れていた確認応答が着地する", async () => {
      releaseStaleCheck?.();
      // 着地を処理する猶予を与える（採用されるなら、この間に巻き戻る）。
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await step("巻き戻らない — 表示は「保存済み」のまま", async () => {
      await expect(button).toHaveTextContent("保存済み");
      await expect(button).toHaveAttribute("aria-pressed", "true");
    });
  },
};

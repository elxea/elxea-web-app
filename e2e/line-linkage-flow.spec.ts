import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * Ring 2 — LINE ログイン / メール連携 / 合体 の受入シナリオ。
 *
 * ## この suite が塞ぐ穴
 *
 * LINE を含む経路は「本物の LINE ログイン画面をブラウザで突破する」方式が成立しない
 * （LINE の開発ガイドラインも自動テストからの大量アクセスを禁じている）。結果として
 * 成功経路が一度も踏まれず、**セッションを壊す変更がフルグリーンのまま通った**ことがある。
 * `LINE_AUTH_BASE_URL` / `LINE_API_BASE_URL`（PR #103）で接続先を偽サーバーに向け、
 * ここで初めて往復まるごとを踏む。
 *
 * ## 外に出ていくものは全部偽物
 *
 * LINE / cx-agent / Shopify Customer Account / Firestore — 4 つとも
 * `playwright-line-linkage.config.ts` がローカルの偽物に差し替える。**本物には接続しない。**
 *
 * ## なぜ「同じ 1 つのブラウザで①→②→③」を 1 テストに畳んでいるのか
 *
 * 合体は「LINE だけで貯めた棚」と「メールの棚」が同じブラウザ・同じ人で出会ったときにしか
 * 起きない。工程を別テストに割ると、各テストが新しい context を持つのでその出会いが作れず、
 * 合体そのものを検証できない。①②は診断のために単独でも回すが、③は 1 本の物語として書く。
 *
 * ## 身元はテストごとに変える
 *
 * 偽 Firestore と偽台帳は dev サーバーのプロセス内で 1 つを共有する。テスト間で状態を消す
 * 口をアプリ側に足すのは裏口になるので作らない。代わりに **テストごとに別の LINE ユーザー /
 * 別の顧客 ID** を使い、互いの棚を踏まないようにする。
 */

const BASE_HOST = process.env.E2E_BASE_HOST!;
const LINE_ORIGIN = process.env.E2E_LINE_ORIGIN!;
const CX_ORIGIN = process.env.E2E_CX_ORIGIN!;
const SHOPIFY_ORIGIN = process.env.E2E_SHOPIFY_ORIGIN!;
const LINE_HIT_LOG = process.env.E2E_LINE_HIT_LOG!;

const FAKE_APEX = ".elxea.test";
const LINE_SESSION_COOKIES = ["line_user", "line_session", "line_auth", "line_uid"] as const;

/** LINE の Messaging userId 形式（U + 32 hex）。これを外すと id_token 検証が正しく落ちる。 */
function lineUserId(seed: string): string {
  const hex = Buffer.from(seed, "utf8").toString("hex").padEnd(32, "0").slice(0, 32);
  return `U${hex}`;
}

/**
 * 偽サーバーの操作口。**テストプロセス（Node）から 127.0.0.1 に直接叩く。**
 * ページ経由にしないのは、偽アペックスの名前解決が Chromium にしか無いのと対称で、
 * 127.0.0.1 は Node からしか素直に叩けないため。
 */
function control(request: APIRequestContext) {
  return {
    /** 「今この端末でログインしている LINE アカウント」を決める。 */
    async setLineUser(user: { userId: string; displayName: string; email?: string }) {
      const res = await request.post(`${LINE_ORIGIN}/__control/line-user`, { data: user });
      expect(res.ok(), "偽 LINE のユーザー切り替えに失敗").toBe(true);
    },
    /** 「今ログインしようとしている Shopify 顧客」を決める。 */
    async setShopifyCustomer(customer: { id: string; email: string }) {
      const res = await request.post(`${SHOPIFY_ORIGIN}/__control/customer`, { data: customer });
      expect(res.ok(), "偽 Shopify の顧客切り替えに失敗").toBe(true);
    },
  };
}

/** 偽 LINE が実際に叩かれた記録。「往復が本当に起きた」ことは外形からは見えない。 */
function lineHits(): { path: string }[] {
  try {
    return readFileSync(LINE_HIT_LOG, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { path: string });
  } catch {
    return [];
  }
}

/** 台帳の中身。連携が「成立した」ことの一次資料。 */
async function readLedger(
  request: APIRequestContext,
): Promise<{ lineUserId: string; shopifyCustomerId: string }[]> {
  const res = await request.get(`${CX_ORIGIN}/__control/ledger`);
  expect(res.ok(), "偽 cx-agent の台帳が読めない").toBe(true);
  const body = (await res.json()) as {
    entries: { lineUserId: string; shopifyCustomerId: string }[];
  };
  return body.entries;
}

/* ------------------------------------------------------------------------- */

/**
 * ① LINE でログインする（**画面のボタンから**）。
 *
 * `/api/line-login/init` を直接叩く近道は取らない。ボタンは authUrl を取ってから
 * 初めて `<a>` になる作りで、そこが壊れると「押せないログインボタン」という一番よくある
 * 壊れ方になる。押せるようになるまで待って、実際に押す。
 */
async function loginWithLine(page: Page): Promise<void> {
  await page.goto("/ja/login");
  const button = page.getByRole("link", { name: "LINE でログイン" });
  await expect(button, "LINE ログインボタンが押せる状態にならない").toBeVisible();
  await button.click();

  /* 偽 LINE の authorize → /api/line-callback → 完了画面、まで一気に転がる。 */
  await page.waitForURL(/\/ja\/login\/complete/);
}

/** ② メールアドレスでログインする（Shopify OAuth の往復）。 */
async function loginWithEmail(page: Page): Promise<void> {
  await page.goto("/ja/login");
  const button = page.getByRole("link", { name: "メールアドレスでログイン" });
  await expect(button).toBeVisible();
  await button.click();

  await page.waitForURL(/\/ja\/account/);
}

/** ③ マイページから LINE を連携する。 */
async function linkLineFromAccount(page: Page): Promise<void> {
  await page.goto("/ja/account");
  /* CTA は init を取ってから `<a>` になる（それまでは無効なボタン）。testid は
   * このためにコンポーネント側が明示的に置いているもの。 */
  const cta = page.getByTestId("line-linkage-cta");
  await expect(cta, "連携 CTA が押せる状態にならない").toBeVisible();
  await cta.click();

  await page.waitForURL(/line_link=/);
}

/** お気に入りを 1 件足す。 */
async function addFavorite(page: Page, favorite: { targetId: string; title: string }) {
  /* 商品ページのハートではなく API を直接叩く。ハート自体は既存 spec の担当で、
   * ここで確かめたいのは「どの棚に入るか / 合体で移るか」という身元の側だから。
   * ページ経由の fetch なので cookie は本物のセッションが載る。 */
  return page.evaluate(async (fav) => {
    const res = await fetch("/api/user/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type: "product", targetId: fav.targetId, title: fav.title }),
    });
    return { status: res.status, body: await res.text() };
  }, favorite);
}

/** 今ログインしている人の棚に見えるお気に入りのタイトル一覧。 */
async function listFavoriteTitles(page: Page): Promise<string[]> {
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/user/favorites?type=product", { credentials: "same-origin" });
    return { status: res.status, body: await res.text() };
  });
  expect(result.status, `お気に入りの取得に失敗: ${result.body}`).toBe(200);
  const parsed = JSON.parse(result.body) as { favorites: { title: string }[] };
  return parsed.favorites.map((f) => f.title);
}

async function sessionCookieNames(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies(`http://${BASE_HOST}`);
  return cookies
    .filter((c) => LINE_SESSION_COOKIES.includes(c.name as never) && c.value !== "")
    .map((c) => c.name)
    .sort();
}

/* ------------------------------------------------------------------------- */

test.describe.serial("LINE ログイン・メール連携・合体", () => {
  test("① LINE でログインし、お気に入りが LINE の棚に入る", async ({
    page,
    context,
    request,
  }) => {
    const user = { userId: lineUserId("step1"), displayName: "ステップ1太郎" };
    await control(request).setLineUser(user);

    const hitsBefore = lineHits().length;
    await loginWithLine(page);

    /* 往復が本当に偽 LINE を通ったことを、外形ではなくサーバー側の記録で確かめる。
     * ここが空なら「callback にそれらしい code を渡しただけ」で、認可・token 交換・
     * profile・verify のどれも踏んでいない。 */
    const paths = lineHits()
      .slice(hitsBefore)
      .map((h) => h.path);
    for (const required of [
      "/oauth2/v2.1/authorize",
      "/oauth2/v2.1/token",
      "/v2/profile",
      "/oauth2/v2.1/verify",
    ]) {
      expect(paths, `偽 LINE の ${required} が呼ばれていない`).toContain(required);
    }

    /* 4 本のセッション cookie がアペックス Domain で届いていること。ここは
     * 「state cookie の掃除がセッションまで消す」という実際に起きた退行の置き場。 */
    expect(await sessionCookieNames(context)).toEqual([...LINE_SESSION_COOKIES].sort());

    await page.goto("/ja/account");
    expect(await page.content()).toContain(user.displayName);

    const added = await addFavorite(page, { targetId: "step1-item", title: "ステップ1の茶" });
    expect(added.status, `お気に入り追加に失敗: ${added.body}`).toBe(200);

    expect(await listFavoriteTitles(page)).toContain("ステップ1の茶");
  });

  test("② メールでログインし、マイページから LINE を連携できる", async ({ page, request }) => {
    const user = { userId: lineUserId("step2"), displayName: "ステップ2太郎" };
    const customer = { id: "9002", email: "step2@example.test" };
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    await loginWithEmail(page);
    /* メールのセッションで立てていること（LINE ではない）。 */
    await expect(page.locator('header a[href*="/api/auth/logout"]').first()).toBeVisible();

    await linkLineFromAccount(page);

    /* 画面に「連携できた」が出る。`error` で戻っていないことをここで固定する。 */
    await expect(page.getByTestId("line-linkage-notice-success")).toBeVisible();
    await expect(page.getByTestId("line-linkage-linked")).toBeVisible();

    /* 連携の正本（cx-agent の台帳）にも載っていること。画面表示だけだと、
     * 台帳に書けていないのに成功と表示する退行が見えない。 */
    const ledger = await readLedger(request);
    expect(
      ledger.find((e) => e.lineUserId === user.userId)?.shopifyCustomerId,
      "台帳にこの LINE と顧客の対応が無い",
    ).toBe(customer.id);
  });

  test("③ LINE で貯めたお気に入りが、メールのアカウントに合体して見える", async ({
    page,
    context,
    request,
  }) => {
    const user = { userId: lineUserId("step3"), displayName: "ステップ3太郎" };
    const customer = { id: "9003", email: "step3@example.test" };
    const title = "合体して見えるべき茶";
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    /* --- ① LINE だけの人として棚に入れる --- */
    await loginWithLine(page);
    const added = await addFavorite(page, { targetId: "step3-item", title });
    expect(added.status, `お気に入り追加に失敗: ${added.body}`).toBe(200);
    expect(await listFavoriteTitles(page)).toContain(title);

    /* --- ② 同じブラウザでメールログイン --- */
    await loginWithEmail(page);

    /* この時点ではまだ連携していない（台帳に対応が無い）ので、合体は起きていない。
     * ここを「もう見えている」ことにしてしまうと、連携を経ずに他人の棚が見える設計を
     * 通してしまう。**見えないこと**を明示的に固定する。 */
    expect(
      await listFavoriteTitles(page),
      "連携前にメールの棚から LINE の棚が見えてはいけない",
    ).not.toContain(title);

    /* メールログインの往復で LINE セッションは畳まれている（同じブラウザに 2 つの
     * 身元が同時に立ったままにしない）。 */
    expect(await sessionCookieNames(context)).toEqual([]);

    /* --- ③ 連携する = 合体が起きる --- */
    await linkLineFromAccount(page);
    await expect(page.getByTestId("line-linkage-linked")).toBeVisible();

    expect(
      await listFavoriteTitles(page),
      "連携したのに LINE で入れたお気に入りが見えない（合体していない）",
    ).toContain(title);

    /* 画面にも出ること。API だけ通って描画側が拾えていない、を分けて見るため。 */
    await page.goto("/ja/account");
    expect(await page.content()).toContain(title);
  });
});

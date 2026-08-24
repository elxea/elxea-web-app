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
const CX_HIT_LOG = process.env.E2E_CX_HIT_LOG!;

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
    /**
     * 偽 cx-agent の `/api/identity/*` を遅らせる（`ms: 0` で解除）。
     *
     * web-app は 3000ms で諦めて「不明」に縮退する。その縮退は今まで
     * **一度もテストで踏まれていなかった**（偽サーバーが即答しかできなかった）。
     */
    async setCxLatency(ms: number) {
      const res = await request.post(`${CX_ORIGIN}/__control/latency`, { data: { ms } });
      expect(res.ok(), "偽 cx-agent の遅延注入に失敗").toBe(true);
    },
  };
}

/** 偽 cx-agent が実際に叩かれた記録。遅延が本当に効いたかはここでしか分からない。 */
function cxHits(): { path: string; delayedMs?: number }[] {
  try {
    return readFileSync(CX_HIT_LOG, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { path: string; delayedMs?: number });
  } catch {
    return [];
  }
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

/** ログアウトする（どちらの身元でも同じ入口）。 */
async function logout(page: Page): Promise<void> {
  await page.goto("/api/auth/logout?locale=ja");
  await page.waitForLoadState("domcontentloaded");
  /* Shopify セッションを持っていた場合は偽 Shopify の logout を経由して戻ってくる。
   * 自サイトに帰ってきていることを確かめてから次へ進む。 */
  await page.waitForURL(new RegExp(`^http://${BASE_HOST.replace(".", "\\.")}/`));
}

/** マイページから LINE 連携を解除する（確認ダイアログまで含めて画面の操作で）。 */
async function unlinkLineFromAccount(page: Page): Promise<void> {
  await page.goto("/ja/account");
  await page.getByTestId("line-unlink-trigger").click();

  /* 確認ダイアログの文言は「解除しても何が残るか」を伝える契約そのもの。
   * 出ていることを確かめてから押す（黙って外れる導線にしない）。 */
  await expect(page.getByTestId("line-unlink-dialog")).toBeVisible();
  await expect(page.getByTestId("line-unlink-keeps")).toBeVisible();

  await page.getByTestId("line-unlink-confirm").click();
  /* 解除が反映されて連携済み表示が消えるまで待つ。 */
  await expect(page.getByTestId("line-linkage-linked")).toHaveCount(0);
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

    /* 逆に LINE セッションは**残っている** (F16)。
     *
     * ここは以前 `toEqual([])` — つまり「メールログインの往復で LINE セッションは
     * 畳まれる」を正としていた。**その期待自体が欠陥だった。** 1 つ上の assertion が
     * 言っているとおり、この時点では台帳に対応が無く合体は起きていない。にもかかわらず
     * cookie 4 本を消すと、お気に入りは `users/line:<id>/` に残ったまま、そこへ戻る
     * 入口だけが失われる。Setaka の実機テストで「LINE の保存情報が消えた」と見えたのは
     * この状態。
     *
     * 掃除してよいのは合体まで到達したときだけで、その分岐は
     * `app/api/auth/callback/route.ts` にある。ここはその**ブラウザ側の受入**:
     * 未連携のままメールで入っても、LINE へ戻る道は残る。
     *
     * 「同じブラウザに 2 つの身元が同時に立つ」ことは問題にならない。棚の解決は
     * `resolveIdentity()` が Shopify セッションを優先するので、いまこのブラウザが
     * 見るのはメールの棚のまま（1 つ上の assertion がそれを見ている）。 */
    expect(
      await sessionCookieNames(context),
      "未連携のままメールで入ったのに LINE セッションが消えている (F16)",
    ).toEqual([...LINE_SESSION_COOKIES].sort());

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

  test("④ 連携後に LINE でログインし直しても、同じ棚が見える", async ({
    page,
    context,
    request,
  }) => {
    const user = { userId: lineUserId("step4"), displayName: "ステップ4太郎" };
    const customer = { id: "9004", email: "step4@example.test" };
    const title = "どちらの入口でも見えるべき茶";
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    /* ①〜③ と同じところまで進める（LINE で貯める → メールで入る → 連携）。 */
    await loginWithLine(page);
    expect((await addFavorite(page, { targetId: "step4-item", title })).status).toBe(200);
    await loginWithEmail(page);
    await linkLineFromAccount(page);
    expect(await listFavoriteTitles(page)).toContain(title);

    /* --- ④ いったん出て、今度は LINE の入口から入る --- */
    await logout(page);
    expect(await sessionCookieNames(context), "ログアウトで LINE 側も畳まれる").toEqual([]);

    await loginWithLine(page);

    /* 連携済みなので、LINE で入っても棚は **メールのアカウントのもの** になる。
     * ここが `line:<uid>` の棚に戻ってしまうと、同じ人なのに入口によって
     * 見えるものが変わる（合体の意味が消える）。 */
    expect(
      await listFavoriteTitles(page),
      "LINE から入ったときに連携先アカウントの棚が見えない",
    ).toContain(title);

    await page.goto("/ja/account");
    expect(await page.content()).toContain(title);
  });

  test("⑤ 解除するとつながりが切れ、もう一度連携すると戻る", async ({ page, request }) => {
    const user = { userId: lineUserId("step5"), displayName: "ステップ5太郎" };
    const customer = { id: "9005", email: "step5@example.test" };
    const title = "解除しても残るべき茶";
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    await loginWithLine(page);
    expect((await addFavorite(page, { targetId: "step5-item", title })).status).toBe(200);
    await loginWithEmail(page);
    await linkLineFromAccount(page);
    expect(await listFavoriteTitles(page)).toContain(title);

    /* --- 解除 --- */
    await unlinkLineFromAccount(page);

    /* 正本（台帳）から消えていること。画面から連携済み表示が消えるだけでは、
     * 「見た目は外れたが台帳には残っている」を見逃す。 */
    expect(
      (await readLedger(request)).find((e) => e.lineUserId === user.userId),
      "解除したのに台帳に連携が残っている",
    ).toBeUndefined();

    /* 解除は「つながりを切る」であって「持ち物を捨てる」ではない。合体で移した
     * お気に入りは、メールのアカウントに残り続ける（確認ダイアログがそう約束している）。 */
    expect(
      await listFavoriteTitles(page),
      "解除でお気に入りまで消えてはいけない",
    ).toContain(title);

    /* --- 再連携 --- */
    await linkLineFromAccount(page);
    await expect(page.getByTestId("line-linkage-linked")).toBeVisible();
    expect(
      (await readLedger(request)).find((e) => e.lineUserId === user.userId)?.shopifyCustomerId,
      "再連携が台帳に載っていない",
    ).toBe(customer.id);
  });

  test("エッジ: 他人に連携済みの LINE は、別のアカウントに繋ぎ直せない", async ({
    page,
    request,
  }) => {
    const shared = { userId: lineUserId("edge-shared"), displayName: "共用端末の人" };
    const first = { id: "9006", email: "edge-first@example.test" };
    const second = { id: "9007", email: "edge-second@example.test" };
    const title = "最初の人の茶";

    /* --- 1 人目: LINE で貯めて、自分のアカウントに連携する --- */
    await control(request).setLineUser(shared);
    await control(request).setShopifyCustomer(first);
    await loginWithLine(page);
    expect((await addFavorite(page, { targetId: "edge-item", title })).status).toBe(200);
    await loginWithEmail(page);
    await linkLineFromAccount(page);
    expect(await listFavoriteTitles(page)).toContain(title);
    await logout(page);

    /* --- 2 人目: 同じ端末・同じ LINE のまま、別のメールアカウントで入る --- */
    await control(request).setShopifyCustomer(second);
    await loginWithEmail(page);

    /* 連携を試みる。cx-agent（正本）が 409 を返し、連携は成立しない。
     * ここが通ってしまうと、共用端末で前の人の棚が次の人に見える。
     *
     * ⚠ 出るのは **conflict** の文言であって error ではない（M-1 / J-4）。
     *   この衝突は「1 LINE = 1 顧客」という決めどおりの結果で、時間をおいても
     *   直らない。かつてはここが error に潰され「時間をおいてもう一度お試し
     *   ください」と案内していた = **永久に成功しない再試行を促していた**。
     *   error が出ないことまで見るのは、丸め直しの再発を捕まえるため。 */
    await linkLineFromAccount(page);
    await expect(page.getByTestId("line-linkage-notice-conflict")).toBeVisible();
    await expect(page.getByTestId("line-linkage-notice-error")).toHaveCount(0);

    expect(
      await listFavoriteTitles(page),
      "他人の LINE を横取り連携して、その人の棚が見えてはいけない",
    ).not.toContain(title);

    /* 台帳は 1 人目のままで動いていないこと。 */
    expect(
      (await readLedger(request)).find((e) => e.lineUserId === shared.userId)?.shopifyCustomerId,
      "台帳の連携先が上書きされている",
    ).toBe(first.id);
  });

  test("エッジ: 解除した直後に LINE で入っても、前のアカウントの棚は見えない", async ({
    page,
    request,
  }) => {
    const user = { userId: lineUserId("edge-fresh"), displayName: "解除直後の人" };
    const customer = { id: "9008", email: "edge-fresh@example.test" };
    const title = "解除後は見えてはいけない茶";
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    await loginWithLine(page);
    expect((await addFavorite(page, { targetId: "edge-fresh-item", title })).status).toBe(200);
    await loginWithEmail(page);
    await linkLineFromAccount(page);
    expect(await listFavoriteTitles(page)).toContain(title);

    await unlinkLineFromAccount(page);
    await logout(page);

    /* 逆引きには 60 秒のプロセス内キャッシュがある。解除で捨てそこねると、その間に
     * LINE 側から入った人に「解除したはずの顧客の棚」が見える（P6/E1 の窓）。
     * **待たずに**入り直すことが、この窓を撃つということ。 */
    await loginWithLine(page);

    expect(
      await listFavoriteTitles(page),
      "解除直後の LINE ログインに、前の連携先の棚が見えている（逆引きキャッシュが残っている）",
    ).not.toContain(title);
  });

  /**
   * エッジ: 台帳の照会が遅すぎるとき、マイページは嘘をつかない（S12 / D-16）。
   *
   * ## なぜこのテストが要るのか
   *
   * web-app は cx-agent への問い合わせに 3000ms の上限を置き、超えたら
   * `linked: null`（不明）へ縮退する。**この縮退の先が今回の症状の安全装置**で、
   * 「未連携です」と言い切らずに「確認できませんでした」と出すことになっている。
   *
   * ところが偽 cx-agent は即答しかできなかったので、3000ms の上限も縮退も
   * **一度も踏まれたことがなかった**（as-is D-16）。「タイムアウト時の挙動」は
   * 設計文書とコメントの中にしか存在しない状態だった。ここで初めて実際に踏む。
   *
   * ## 何を固定するか（現状の縮退挙動）
   *
   * 順引き（メールでログインした人の経路）が timeout したとき:
   *   - 「確認できませんでした」の一文が出る
   *   - 「連携済み」とは言わない
   *   - 画面自体は落ちない（fail-soft）
   * そして遅延を解除すれば、その一文は消える（常時出る飾りではない）。
   *
   * 表示そのものの作り直し（連携 CTA を「準備中」で固めない等）は後の波の仕事で、
   * ここは**今の挙動を動かせない形に留める**のが目的。
   */
  test("エッジ: 台帳の照会が 3 秒を超えても、マイページは「未連携」と言い切らない", async ({
    page,
    request,
  }) => {
    const user = { userId: lineUserId("edge-slow"), displayName: "照会が遅い人" };
    const customer = { id: "9009", email: "edge-slow@example.test" };
    await control(request).setLineUser(user);
    await control(request).setShopifyCustomer(customer);

    await loginWithEmail(page);

    /* 遅延なしのときは「確認できませんでした」が出ない。ここを先に確かめないと、
       このあとの assertion が「常に出ている一文」を見ているだけになりうる。 */
    await page.goto("/ja/account");
    await expect(page.getByTestId("line-linkage-entry")).toBeVisible();
    await expect(page.getByTestId("line-linkage-status-unknown")).toHaveCount(0);

    const hitsBefore = cxHits().length;

    try {
      /* 3000ms の上限より確実に長く。台帳の中身は変えないので、遅延が無ければ
         同じ要求は「未連携」を返す — 変わるのは待てるかどうかだけ。 */
      await control(request).setCxLatency(5_000);
      await page.reload();

      await expect(
        page.getByTestId("line-linkage-status-unknown"),
        "照会が失敗したのに「確認できませんでした」が出ていない",
      ).toBeVisible();
      await expect(
        page.getByTestId("line-linkage-linked"),
        "読めていないのに「連携済み」と表示している",
      ).toHaveCount(0);

      /* 偽サーバー側の記録で「本当に遅らせた」ことを確かめる。画面だけ見ていると、
         偶然この一文が出ている場合と区別が付かない。 */
      await expect
        .poll(
          () =>
            cxHits()
              .slice(hitsBefore)
              .some((h) => (h.delayedMs ?? 0) >= 5_000),
          { message: "偽 cx-agent が遅延を適用していない（timeout 経路を踏んでいない）" },
        )
        .toBe(true);
    } finally {
      /* 遅延を残したまま抜けると、あとに続く spec が「たまに落ちる」形で壊れる。 */
      await control(request).setCxLatency(0);
    }

    /* 読めるようになれば、その一文は消える。 */
    await page.reload();
    await expect(page.getByTestId("line-linkage-status-unknown")).toHaveCount(0);
  });
});

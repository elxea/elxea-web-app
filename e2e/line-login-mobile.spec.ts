/**
 * スマホで「LINEでログイン」を押したとき、LINE アプリへ渡りうる形になっているか。
 *
 * ## この検査が守るもの
 *
 * 自動ログイン（= 電話で LINE アプリが開く唯一の経路）が成立する条件のうち、
 * **こちら側で満たせるのは 2 つだけ**である。
 *
 *   1. 認可 URL に自動ログインを殺すパラメータを載せない
 *      （`prompt` / `disable_auto_login` / `disable_ios_auto_login`）
 *   2. その URL を**ユーザーの実 `<a>` タップ**で開く
 *      （JavaScript リダイレクトや自前 URL からの 302 は Universal Links を発火させない）
 *
 * 1 は単体テスト（`__tests__/line-authorize-url.test.ts`）が全経路で見ている。
 * **2 は単体テストでは見えない** — DOM に本当に `<a href="https://access.line.me/...">`
 * が出ているか、それとも button + `window.location` に「簡略化」されたかは、
 * 実際に描画しないと分からない。ここがその検査である。
 *
 * 2026-03-25〜08-18 に 146 日間残った退行は 1 の側だったが、2 の側は**これまで
 * 一度も検査されていなかった**（`e2e/mobile.spec.ts` に LINE の記述は無い）。
 * ボタンを `<Link>` や `router.push` に置き換える「整理」はいつでも起こりうるので、
 * 機械で止める。
 *
 * ## どこで回すのか
 *
 * `e2e/playwright-line-linkage.config.ts`（偽アペックス `www.elxea.test` + 偽 LINE）。
 * 素の `playwright.config.ts` は `localhost` で回るが、`isTrustedAuthHost()` は
 * 自ホスト apex の配下しか通さないので `/api/line-login/init` が 503 を返し、
 * ボタンは常に「現在ご利用いただけません」になる — **本番が通る分岐を一度も
 * 通らない**ので、そこで回しても何も守れない。
 *
 * 認可先ホストは env で偽サーバーに差し替わる（`LINE_AUTH_BASE_URL`）。よって
 * ホスト名は `access.line.me` 決め打ちにせず、設定された origin と突き合わせる。
 * ホストが本物であることは単体側（`__tests__/line-authorize-url.test.ts` /
 * `line-endpoints.test.ts`）が見ている。
 *
 * ネットワークは LINE へ出さない（認可 URL は踏まず、href を読むだけ）。
 */
import { test, expect } from "@playwright/test";

/**
 * ## 着地点（2026-08-30 追記）
 *
 * 「実 `<a>` タップである」だけでは足りない。タップの**着地先ホスト**が LINE アプリに
 * 結び付いていなければ、OS はアプリを開く候補としてすら扱わない。実測（同日）:
 *
 *   - `access.line.me/.well-known/apple-app-site-association` … 本文 0 バイト
 *   - `access-auto.line.me/.well-known/apple-app-site-association` …
 *     `jp.naver.line` / `paths: ["/dialog/oauth/weblogin", "/oauth2/v2.1/login"]`
 *
 * よって自動ログインが成立しない環境（iPhone の Safari 以外 / アプリ内ブラウザ）だけ、
 * 着地点を受け渡しホストへ切り替える。**対応環境は今日どおり**であることを、同じ
 * ファイルの中で退行検査として並べて固定する。
 */

/** 自動ログインを殺すパラメータ。1 本でも載ったらアプリは開かない。 */
const AUTO_LOGIN_KILLING_PARAMS = [
  "prompt",
  "disable_auto_login",
  "disable_ios_auto_login",
];

/** 認可先の origin。偽 LINE に差し替わっているならそちら。 */
const AUTH_ORIGIN = process.env.E2E_LINE_ORIGIN ?? "https://access.line.me";
const AUTH_LINK = `a[href^="${AUTH_ORIGIN}/oauth2/v2.1/authorize"]`;

/** 受け渡し先の origin。偽サーバーでは別 host 名に差し替わる（config の注記）。 */
const HANDOFF_ORIGIN =
  process.env.E2E_LINE_HANDOFF_ORIGIN ?? "https://access-auto.line.me";
const HANDOFF_LINK = `a[href^="${HANDOFF_ORIGIN}/oauth2/v2.1/login"]`;

test.describe("LINE ログイン（モバイル）", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test("ボタンの実体が access.line.me への素の <a> である", async ({ page }) => {
    await page.goto("/ja/login");

    /* ボタンは mount 後に init を叩いて href を載せる。載るまで待つ。 */
    const lineLink = page.locator(AUTH_LINK);
    await expect(lineLink).toHaveCount(1, { timeout: 15_000 });

    /* `<a>` であること自体が要件（`<button>` + JS 遷移では Universal Link が
       発火しない）。tagName で確かめる。 */
    await expect(lineLink).toBeVisible();
    expect(await lineLink.evaluate((el) => el.tagName)).toBe("A");

    /* target="_blank" や rel の付与も避ける — 別タブへ逃がすと iOS の
       Universal Link の扱いが変わる。 */
    expect(await lineLink.getAttribute("target")).toBeNull();
  });

  test("遷移先 URL が自動ログインの条件を満たしている", async ({ page }) => {
    await page.goto("/ja/login");

    const lineLink = page.locator(AUTH_LINK);
    await expect(lineLink).toHaveCount(1, { timeout: 15_000 });

    const href = await lineLink.getAttribute("href");
    expect(href).toBeTruthy();
    const url = new URL(href!);

    expect(url.origin).toBe(new URL(AUTH_ORIGIN).origin);
    expect(url.pathname).toBe("/oauth2/v2.1/authorize");

    for (const param of AUTO_LOGIN_KILLING_PARAMS) {
      expect(
        url.searchParams.has(param),
        `${param} が付いている。スマホで LINE アプリが開かなくなる。`,
      ).toBe(false);
    }

    // 認可に必要な値は揃っていること（「消したら通った」を防ぐ）
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  /* UA 別の検査は `test.use` で入れ替える。`browser.newContext()` は config の
     `use.baseURL` を引き継がないので、相対 goto が使えなくなる。 */
  test.describe("iPhone の Chrome (CriOS)", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.35 Mobile/15E148 Safari/604.1",
    });

    test("タップ先が LINE アプリに結び付いた URL になっている", async ({ page }) => {
      /* iOS Chrome では LINE の自動ログイン（= LINE の画面が受け渡しホストへ内部で
         遷移する形）が成立しない。だから利用者のタップを、その受け渡しホストへ
         **直接**着地させる。ここが `access.line.me` に戻ると、押した人は必ず
         メール/パスワード/QR 画面で行き止まる（オーナー指摘 2026-08-30 の症状）。 */
      await page.goto("/ja/login");

      const handoff = page.locator(HANDOFF_LINK);
      await expect(handoff).toHaveCount(1, { timeout: 15_000 });
      expect(await handoff.evaluate((el) => el.tagName)).toBe("A");
      expect(await handoff.getAttribute("target")).toBeNull();

      /* 認可エンドポイントへの素の `<a>` は出ていない（両方出すと押し分けになる）。 */
      await expect(page.locator(AUTH_LINK)).toHaveCount(0);

      const url = new URL((await handoff.getAttribute("href"))!);
      expect(url.pathname).toBe("/oauth2/v2.1/login");
      expect(url.searchParams.get("loginChannelId")).toBeTruthy();

      /* 認可要求は returnUri の中にそのまま入っている（1 バイトも失われない）。 */
      const inner = new URL(url.searchParams.get("returnUri")!, AUTH_ORIGIN);
      expect(inner.pathname).toBe("/oauth2/v2.1/authorize");
      expect(inner.searchParams.get("response_type")).toBe("code");
      expect(inner.searchParams.get("state")).toBeTruthy();
      expect(inner.searchParams.get("nonce")).toBeTruthy();
      for (const param of AUTO_LOGIN_KILLING_PARAMS) {
        expect(
          inner.searchParams.has(param),
          `${param} が returnUri の中に付いている。`,
        ).toBe(false);
      }
    });

    test("それでも開かなかったときの逃げ道を押す前に置く", async ({ page }) => {
      /* 受け渡しはアプリ未インストール等で外れうる。外れた先は今日と同じ
         メール/パスワード画面なので、そこからの戻り方を先に見せておく。 */
      await page.goto("/ja/login");

      await expect(page.getByTestId("line-auto-login-notice")).toBeVisible();
    });
  });

  test.describe("iOS Safari", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });

    test("対応環境なので今日どおり認可 URL へ行き、案内も出さない（退行検査）", async ({
      page,
    }) => {
      /* iOS Safari は自動ログインが公式に成立する唯一の外部ブラウザで、今日すでに
         アプリが開いている。受け渡し URL は LINE の内部仕様に寄りかかっているので、
         **動いている環境をそちらへ倒さない**ことを機械で固定する。 */
      await page.goto("/ja/login");

      await expect(page.locator(AUTH_LINK)).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator(HANDOFF_LINK)).toHaveCount(0);
      await expect(page.getByTestId("line-auto-login-notice")).toHaveCount(0);
    });
  });

  test.describe("Android の Chrome", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });

    test("公式に対応しているので今日どおり（退行検査）", async ({ page }) => {
      await page.goto("/ja/login");

      await expect(page.locator(AUTH_LINK)).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator(HANDOFF_LINK)).toHaveCount(0);
      await expect(page.getByTestId("line-auto-login-notice")).toHaveCount(0);
    });
  });
});

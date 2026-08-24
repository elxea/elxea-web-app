/**
 * サイトパスワード gate が **Vercel Preview にも掛かる**ことを固定する。
 *
 * 直した穴 (2026-08-25 環境分離監査 CRITICAL): `checkSitePassword` の先頭に
 * `if (VERCEL_ENV === "preview") return null` があり、Preview デプロイだけが
 * ゲートを素通りしていた。その Preview は Preview スコープに本番級の資格情報を
 * 持つため、「本番はパスワードで閉じているのに、同じ資格情報を持つ Preview は
 * 誰でも開ける」状態になっていた。
 *
 * ここで押さえるのは 2 つの性質で、どちらも回帰の形が違う:
 *
 *   1. Preview でもゲートが**掛かる** — 素通し行が戻ってきたら落ちる。
 *   2. Preview で `SITE_PASSWORD` が**無い**ときは開かない (fail-closed) —
 *      コードだけ直して env を入れ忘れた状態が、無言で元の全公開に戻らない。
 *      `checkSitePassword` の入口は `if (!SITE_PASSWORD) return null` なので、
 *      2 を書いていないと 1 は「env 次第で意味を失う」テストになる。
 *
 * 併せて、本番の fail-open (公開ローンチ時に env を外すとサイトが開く) を
 * 壊していないことも押さえる。これは意図された運用なので、Preview を閉じる
 * 変更が巻き込んでいないことを明示的に確認する必要がある。
 *
 * `middleware.ts` は `SITE_PASSWORD` / `VERCEL_ENV` を **モジュール読み込み時**に
 * 読む。したがって env を書き換えるたびに `vi.resetModules()` してから動的
 * import する。ここを import 文で済ませると全ケースが最初の env を共有する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * i18n 層だけをスタブする。理由は middleware-account-guard.test.ts と同じで、
 * `next-intl/middleware` が node 環境下で `next/server` を解決できないため。
 *
 * これは検証対象を潰さない。サイトパスワードの判定は `intlMiddleware` に
 * 到達する**前**に return するので、リダイレクト / 503 はすべて実物の gate が
 * 生成する。「通した」ケースはその redirect が**無いこと**として観測するので、
 * スタブ側が合格を捏造することはできない。
 */
vi.mock("next-intl/middleware", () => ({
  default: () => (_request: NextRequest) => NextResponse.next(),
}));

const PASSWORD = "test-site-password";

/** `app/api/site-auth/route.ts` / middleware と同じ HMAC-SHA256(key=pw, msg=pw)。 */
async function expectedAuthCookie(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(password);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, keyData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Env = { sitePassword?: string; vercelEnv?: string };

/** env を差し替えたうえで middleware を読み直す。 */
async function loadMiddleware({ sitePassword, vercelEnv }: Env) {
  if (sitePassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = sitePassword;

  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;

  vi.resetModules();
  const mod = await import("@/middleware");
  return mod.default;
}

function request(url: string, cookie?: { name: string; value: string }) {
  const req = new NextRequest(new URL(url));
  if (cookie) req.cookies.set(cookie.name, cookie.value);
  return req;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("site-password gate on Vercel Preview", () => {
  it("preview でもパスワード画面へ送る (素通しの穴が塞がっている)", async () => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "preview",
    });

    const response = await middleware(request("https://elxea-web-abc123.vercel.app/ja"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/password");
  });

  it("preview で正しい site_auth cookie を持っていれば通す", async () => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "preview",
    });

    const response = await middleware(
      request("https://elxea-web-abc123.vercel.app/ja", {
        name: "site_auth",
        value: await expectedAuthCookie(PASSWORD),
      }),
    );

    // 通過 = /password へのリダイレクトが起きない。
    expect(response.headers.get("location")).toBeNull();
  });

  it("preview で誤った site_auth cookie は通さない", async () => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "preview",
    });

    const response = await middleware(
      request("https://elxea-web-abc123.vercel.app/ja", {
        name: "site_auth",
        value: await expectedAuthCookie("some-other-password"),
      }),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/password");
  });

  it("preview で SITE_PASSWORD 未設定なら開かず 503 で閉じる (fail-closed)", async () => {
    const middleware = await loadMiddleware({
      sitePassword: undefined,
      vercelEnv: "preview",
    });

    const response = await middleware(request("https://elxea-web-abc123.vercel.app/ja"));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("preview では /password 自体は 503 の対象でも到達できる (パスワードがあるとき)", async () => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "preview",
    });

    const response = await middleware(request("https://elxea-web-abc123.vercel.app/password"));

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("site-password gate outside preview (回帰させていないこと)", () => {
  it("production でパスワードが設定されていれば従来どおり掛かる", async () => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "production",
    });

    const response = await middleware(request("https://elxea.com/ja"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/password");
  });

  it("production で SITE_PASSWORD を外すとサイトが開く (公開ローンチの運用を壊さない)", async () => {
    const middleware = await loadMiddleware({
      sitePassword: undefined,
      vercelEnv: "production",
    });

    const response = await middleware(request("https://elxea.com/ja"));

    expect(response.status).not.toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  it("ローカル (VERCEL_ENV 未設定) で SITE_PASSWORD が無くても 503 にしない", async () => {
    const middleware = await loadMiddleware({
      sitePassword: undefined,
      vercelEnv: undefined,
    });

    const response = await middleware(request("http://localhost:3000/ja"));

    expect(response.status).not.toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("LINE 連携の入口は preview でも従来どおり例外のまま", () => {
  // LIFF / 純正 Account Link は LINE アプリ内ブラウザから開かれ、パスワード
  // 画面を通せない。本番でも同じく例外なので、「本番と同じゲート」にする以上
  // ここは変えない。変えたら連携フローが preview で回らなくなる。
  it.each([
    "https://elxea-web-abc123.vercel.app/liff/link",
    "https://elxea-web-abc123.vercel.app/ja/liff/link",
    "https://elxea-web-abc123.vercel.app/ja/link",
  ])("%s は preview でもパスワード画面に飛ばさない", async (url) => {
    const middleware = await loadMiddleware({
      sitePassword: PASSWORD,
      vercelEnv: "preview",
    });

    const response = await middleware(request(url));

    const location = response.headers.get("location");
    if (location) {
      expect(new URL(location).pathname).not.toBe("/password");
    }
  });
});

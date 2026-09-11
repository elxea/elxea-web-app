/**
 * M-4 — セッションの寿命を「鍵の寿命」から切り離す (as-is D-1)。
 *
 * ## 何が壊れていたか
 *
 * ログインは 4 つの cookie を書く。そのうち 3 つ (`shop_at` / `shop_exp` /
 * `shop_auth`) に **アクセストークンの寿命** が maxAge として付いていた。
 * ブラウザはその時間で 3 つを捨てる。`getSession()` は 3 つ全部を要求していたので、
 * その瞬間に `null` を返す。**30 日の `shop_rt` は原理的に一度も使われなかった。**
 *
 * 利用者から見た症状は「数時間後に再訪すると無言でログアウトしている」。
 * お気に入りのボタン 4 つが同時に押せなくなるので「保存したものが消えた」とも見える。
 *
 * ## ここで固定すること
 *
 *   1. cookie の寿命は 4 つとも同じ (アクセストークンの寿命を持ち込まない)
 *   2. 生存判定は `shop_rt` ただ 1 つ。`shop_at` / `shop_exp` が無くても生きている
 *   3. アクセストークンが切れていればリフレッシュして続きをやる
 *   4. **リフレッシュ結果は書き戻される**（書き戻さないと、Shopify が毎回返す
 *      新しい refresh token を捨て続けることになる）
 *   5. `/account` の門 (middleware) も同じ判定を使う
 *   6. refresh token まで通らなければ、そのときだけ本当にログアウト
 *
 * 完了条件 (設計書 §5-1 Wave 1 / §5-2 S11):
 *   「アクセストークン失効後の再訪でログインが維持される」
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/shopify/session-cookies";

const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

const refreshAccessTokenMock = vi.fn();
const encryptTokenMock = vi.fn((v: string) => `enc(${v})`);
const decryptTokenMock = vi.fn((v: string) =>
  v.startsWith("enc(") ? v.slice(4, -1) : null,
);

vi.mock("@/lib/shopify/customer", () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
  encryptToken: (v: string) => encryptTokenMock(v),
  decryptToken: (v: string) => decryptTokenMock(v),
  getCustomer: vi.fn(),
  getSubscriptionContracts: vi.fn(),
}));

type SetCall = { name: string; value: string; maxAge?: number };

/**
 * cookie store のふり。`seed` が「いまブラウザが持っている cookie」。
 *
 * @param canWrite false のとき `set()` が投げる。Server Component から
 *   `cookies().set()` を呼んだときの Next の挙動を再現する。
 */
function makeStore(seed: Record<string, string>, canWrite = true) {
  const sets: SetCall[] = [];
  return {
    sets,
    store: {
      get: (name: string) => (name in seed ? { name, value: seed[name] } : undefined),
      has: (name: string) => name in seed,
      set: (name: string, value: string, opts?: { maxAge?: number }) => {
        if (!canWrite) {
          throw new Error(
            "Cookies can only be modified in a Server Action or Route Handler.",
          );
        }
        sets.push({ name, value, maxAge: opts?.maxAge });
      },
      delete: () => {},
    },
  };
}

const LIVE_SESSION = {
  shop_at: "enc(live-access)",
  shop_rt: "enc(the-refresh-token)",
  shop_exp: String(Date.now() + 60 * 60 * 1000),
};

/** アクセストークンの maxAge が過ぎ、ブラウザが 3 つを捨てたあとの状態。 */
const AFTER_ACCESS_TOKEN_EXPIRY = {
  shop_rt: "enc(the-refresh-token)",
};

beforeEach(() => {
  vi.clearAllMocks();
  encryptTokenMock.mockImplementation((v: string) => `enc(${v})`);
  decryptTokenMock.mockImplementation((v: string) =>
    v.startsWith("enc(") ? v.slice(4, -1) : null,
  );
  refreshAccessTokenMock.mockResolvedValue({
    access_token: "fresh-access",
    refresh_token: "rotated-refresh",
    expires_in: 7200,
    id_token: "fresh-id",
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("cookie の寿命はアクセストークンの寿命を持ち込まない", () => {
  it("ログインで書く 4 つは全部同じ寿命 (expires_in を maxAge に使わない)", async () => {
    const { buildSessionCookieWrites } = await import("@/lib/shopify/session-cookies");
    const writes = buildSessionCookieWrites({
      accessToken: "a",
      refreshToken: "r",
      /* Shopify のアクセストークンは短い。これが maxAge に化けていたのが D-1。 */
      expiresIn: 3600,
      encrypt: (v) => v,
      now: 1_000_000,
    });

    for (const [role, write] of Object.entries(writes)) {
      expect(write.maxAge, `${role} の maxAge`).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
      expect(write.maxAge, `${role} に expires_in が漏れている`).not.toBe(3600);
    }
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });

  it("shop_exp の中身はアクセストークンの期限のまま (寿命と期限は別)", async () => {
    const { buildSessionCookieWrites } = await import("@/lib/shopify/session-cookies");
    const writes = buildSessionCookieWrites({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 3600,
      encrypt: (v) => v,
      now: 1_000_000,
    });
    /* cookie 自体は 30 日生きるが、「アクセストークンはいつ切れるか」は
       ここに書いてある。getSession() はこの値を見てリフレッシュを決める。 */
    expect(writes.expiresAt.value).toBe(String(1_000_000 + 3600 * 1000));
  });

  it("shop_auth だけが非 httpOnly (画面の出し分けに JS から読む)", async () => {
    const { buildSessionCookieWrites } = await import("@/lib/shopify/session-cookies");
    const writes = buildSessionCookieWrites({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 3600,
      encrypt: (v) => v,
    });
    expect(writes.accessToken.httpOnly).toBe(true);
    expect(writes.refreshToken.httpOnly).toBe(true);
    expect(writes.expiresAt.httpOnly).toBe(true);
    expect(writes.authFlag.httpOnly).toBe(false);
  });
});

describe("アクセストークン失効後の再訪でログインが維持される (S11)", () => {
  it("shop_rt だけが残っていてもセッションは生きている", async () => {
    /* これが D-1 の核心。以前はこの状態で必ず null が返っていた。 */
    const { store } = makeStore(AFTER_ACCESS_TOKEN_EXPIRY);
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    const session = await getSession();

    expect(session, "shop_at が消えただけでログアウト扱いにしている").not.toBeNull();
    expect(session!.accessToken).toBe("fresh-access");
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("the-refresh-token");
  });

  it("リフレッシュ結果が cookie に書き戻される (回転した refresh token を捨てない)", async () => {
    /* Shopify はリフレッシュのたびに新しい refresh token を返す。書き戻さないと
       次の機会に古いものを送ることになる。以前はここに実装が無く、コメントだけが
       「middleware か次の route handler が更新する」と約束していた。 */
    const { sets, store } = makeStore(AFTER_ACCESS_TOKEN_EXPIRY);
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    await getSession();

    const byName = new Map(sets.map((s) => [s.name, s]));
    expect([...byName.keys()].sort()).toEqual(
      ["shop_at", "shop_auth", "shop_exp", "shop_rt"].sort(),
    );
    expect(byName.get("shop_rt")!.value).toBe("enc(rotated-refresh)");
    expect(byName.get("shop_at")!.value).toBe("enc(fresh-access)");
    for (const [name, write] of byName) {
      expect(write.maxAge, `${name} の書き戻しが短い寿命になっている`).toBe(
        SESSION_COOKIE_MAX_AGE_SECONDS,
      );
    }
  });

  it("shop_exp が壊れていても「期限切れ」に倒してリフレッシュする (推測で使い回さない)", async () => {
    const { store } = makeStore({
      shop_at: "enc(stale-access)",
      shop_rt: "enc(the-refresh-token)",
      shop_exp: "not-a-number",
    });
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    const session = await getSession();

    expect(session!.accessToken).toBe("fresh-access");
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it("Server Component から呼ばれて書き戻せなくてもセッションは返る", async () => {
    /* `cookies().set()` は Server Component では例外を投げる。書けないことと
       ログインが切れていることは別。画面は正しく描けなければならない。 */
    const { store } = makeStore(AFTER_ACCESS_TOKEN_EXPIRY, false);
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session!.accessToken).toBe("fresh-access");
  });

  it("まだ生きているアクセストークンでは余計なリフレッシュをしない", async () => {
    const { sets, store } = makeStore(LIVE_SESSION);
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    const session = await getSession();

    expect(session!.accessToken).toBe("live-access");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(sets).toHaveLength(0);
  });
});

describe("本当にログインが切れているときは切れていると答える", () => {
  it("shop_rt が無ければ null (ここだけが生存判定)", async () => {
    const { store } = makeStore({ shop_at: "enc(live-access)", shop_exp: "1" });
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    expect(await getSession()).toBeNull();
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("shop_rt が復号できなければ null (壊れた値を鍵として使わない)", async () => {
    const { store } = makeStore({ shop_rt: "garbage" });
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    expect(await getSession()).toBeNull();
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("リフレッシュが拒否されたら null (30 日を過ぎた / 失効した)", async () => {
    refreshAccessTokenMock.mockRejectedValue(new Error("Token refresh failed: 400"));
    const { store } = makeStore(AFTER_ACCESS_TOKEN_EXPIRY);
    cookiesMock.mockResolvedValue(store);

    const { getSession } = await import("@/lib/shopify/auth");
    expect(await getSession()).toBeNull();
  });
});

describe("門 (middleware) とサーバが同じ判定を使う", () => {
  it("判定の実体は 1 つで、shop_rt だけを見る", async () => {
    const { hasShopifySessionCookies } = await import("@/lib/auth/cookies");

    /* アクセストークンが消えただけの人を締め出さない (これが D-1 の門側)。 */
    expect(hasShopifySessionCookies((n) => n === "shop_rt")).toBe(true);
    /* refresh token が無ければ、他が揃っていても通さない。 */
    expect(hasShopifySessionCookies((n) => n === "shop_at" || n === "shop_exp")).toBe(
      false,
    );
    expect(hasShopifySessionCookies(() => false)).toBe(false);
  });

  it("lib/shopify/auth.ts の hasSessionCookie は同じ実体を指す (二重実装にしない)", async () => {
    const { hasShopifySessionCookies } = await import("@/lib/auth/cookies");
    const { hasSessionCookie } = await import("@/lib/shopify/auth");
    expect(hasSessionCookie).toBe(hasShopifySessionCookies);
  });

  it("middleware は自前で shop_at を見ていない", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(__dirname, "..", "middleware.ts"), "utf8");

    expect(source).toContain("hasShopifySessionCookies");
    /* `cookies.has("shop_at")` を自前で書くと、サーバ側だけ直しても門が閉まる。 */
    expect(source).not.toMatch(/has\(\s*["']shop_at["']\s*\)/);
  });
});

describe("ログインの書き込みとリフレッシュの書き戻しがずれない", () => {
  it("ログイン経路も共有の定義を使う (route が自前で maxAge を決めない)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "app", "api", "auth", "callback", "route.ts"),
      "utf8",
    );

    expect(source).toContain("buildSessionCookieWrites");
    /* `maxAge: tokens.expires_in` が残っていると、ログインだけ数時間に戻る。 */
    expect(source).not.toMatch(/maxAge:\s*tokens\.expires_in/);
  });
});

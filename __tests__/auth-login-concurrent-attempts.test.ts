/**
 * 2026-08-25「エラーが出たのに、実はログインできている」の再現と固定。
 *
 * ## 何が起きていたか（本番ログの実測・JST）
 *
 *   21:50:10 / 21:51:09  /api/auth/logout   … Shopify 側 SSO ごと落とす
 *   21:51:14.522         /api/auth/login    … ログイン開始が
 *   21:51:15.753         /api/auth/login    … 1.23 秒差で 2 回叩かれている
 *   ── ここから 2 分半、/api/auth/callback へのリクエストが 1 件も無い ──
 *   21:53:45.969         /api/auth/login
 *   21:53:46.961         /api/auth/callback … 992 ミリ秒後に code を持って帰着
 *
 * 利用者はその 2 分半、Shopify のコード入力画面で受け取ったコードを繰り返し入れ、
 * 毎回エラーを見ていた。**その往復が一度もこちらに戻って来ていない**ので、失敗は
 * Shopify の authorize の中で起きていた。一方 21:53:45→46 の 992 ミリ秒は人が
 * ログイン画面を操作できる時間ではなく、`prompt=login` を付けたまま Shopify が
 * 無言で code を返している = そのパラメータは狙いどおり働いていない。
 *
 * ## このファイルが固定する 3 つのこと
 *
 *   1. authorize に `prompt` を載せない（Shopify が受け付ける値は `none` だけ）
 *   2. ログイン開始が複数回走っても、先行する試行が壊れない
 *   3. 往復が失敗しても、**すでにログインが成立していればエラーを出さない**
 *
 * 3 は症状そのもの。1 と 2 を直しても、二重送信・二重の戻りは外から起こせるので、
 * 「成立しているログインをエラーとして見せない」を最後の砦として別に持つ。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  TEST_CLIENT_ID,
  TEST_DISCOVERY_URL,
  makeJwksFetch,
  makeKeypair,
  signIdToken,
  validClaims,
} from "./helpers/shopify-oidc-fixtures";

// --- Mocks ------------------------------------------------------------------

const exchangeTokenMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    exchangeToken: (...args: unknown[]) => exchangeTokenMock(...args),
    getCustomer: vi.fn(async () => null),
    encryptToken: (value: string) => `enc(${value})`,
    decryptToken: (value: string) =>
      /^enc\(.*\)$/.test(value) ? value.replace(/^enc\(|\)$/g, "") : null,
  };
});

vi.mock("@/lib/auth/identity-link", () => ({
  completeLineLinkage: vi.fn(async () => ({ outcome: "merged", merge: null })),
  applyLinkageEstablished: vi.fn(async () => ({ outcome: "merged", merge: null })),
}));

vi.mock("@/lib/email/welcome", () => ({ sendWelcomeEmail: vi.fn() }));

const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET as login } from "@/app/api/auth/login/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { __resetShopifyJwksCacheForTests } from "@/lib/shopify/id-token";
import {
  PENDING_AUTH_COOKIE,
  PENDING_AUTH_MAX,
  addPendingAuth,
  findPendingAuth,
  parsePendingAuths,
  serializePendingAuths,
  type PendingAuth,
} from "@/lib/shopify/oauth-state";
import { ERROR_KEY_MAP } from "@/app/[locale]/login/auth-error-keys";

// --- Helpers ----------------------------------------------------------------

const HOST = "www.elxea.com";
const keypair = makeKeypair();

const SAVED = {
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetShopifyJwksCacheForTests();
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  globalThis.fetch = makeJwksFetch([keypair.jwk]);
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function loginRequest(query = "?locale=ja", cookies: Record<string, string> = {}) {
  const request = new NextRequest(`https://${HOST}/api/auth/login${query}`, {
    headers: { host: HOST, "x-forwarded-proto": "https" },
  });
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  return request;
}

function callbackRequest(query: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(`https://${HOST}/api/auth/callback${query}`, {
    headers: { host: HOST, "x-forwarded-proto": "https" },
  });
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  return request;
}

/** レスポンスが実際に書いた cookie を、名前で引ける形にする。 */
function writtenCookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1));
  }
  return out;
}

/** ログインを 1 回開始し、その試行の state / nonce と、次に送る cookie を返す。 */
async function startLogin(
  carriedCookies: Record<string, string> = {},
  query = "?locale=ja",
) {
  const response = await login(loginRequest(query, carriedCookies));
  const authorizeUrl = new URL(response.headers.get("location")!);
  const written = writtenCookies(response);
  return {
    authorizeUrl,
    state: authorizeUrl.searchParams.get("state")!,
    nonce: authorizeUrl.searchParams.get("nonce")!,
    // ブラウザが次のリクエストで送るのは、書かれた cookie 全部。
    cookies: written,
  };
}

function tokenResponse(idToken: string) {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    id_token: idToken,
  };
}

// --- 1. authorize に prompt を載せない --------------------------------------

describe("Shopify の authorize に prompt を載せない", () => {
  /* Shopify Customer Account API が定義している prompt は `none` だけで、意味も
   * 逆（ログイン画面を出さない）。`prompt=login` はこの endpoint に存在しない値で、
   * セッションが無い状態の往復がそこで落ちていた。 */
  it("GET /api/auth/login は prompt を送らない", async () => {
    const { authorizeUrl } = await startLogin();

    expect(authorizeUrl.searchParams.has("prompt")).toBe(false);
    // 往復を成立させるパラメータは当然そのまま。
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("nonce")).toBeTruthy();
  });

  it("state と nonce は毎回別の値（使い回さない）", async () => {
    const first = await startLogin();
    const second = await startLogin(first.cookies);

    expect(second.state).not.toBe(first.state);
    expect(second.nonce).not.toBe(first.nonce);
    expect(first.nonce).not.toBe(first.state);
  });
});

// --- 2. 進行中の試行を上書きしない ------------------------------------------

describe("ログイン開始が重なっても先行する試行を壊さない", () => {
  it("2 回続けて開始しても、両方の state が引ける", async () => {
    const first = await startLogin();
    const second = await startLogin(first.cookies);

    const pending = parsePendingAuths(second.cookies[PENDING_AUTH_COOKIE]);

    expect(findPendingAuth(pending, first.state)).not.toBeNull();
    expect(findPendingAuth(pending, second.state)).not.toBeNull();
    // 取り違えていないこと（verifier / nonce が試行ごとに別）。
    expect(findPendingAuth(pending, first.state)!.nonce).not.toBe(
      findPendingAuth(pending, second.state)!.nonce,
    );
  });

  it("戻り先も試行ごとに保つ（後から始めた方に上書きされない）", async () => {
    const first = await startLogin({}, "?locale=ja&returnTo=%2Fja%2Flink");
    const second = await startLogin(first.cookies, "?locale=ja");

    const pending = parsePendingAuths(second.cookies[PENDING_AUTH_COOKIE]);
    expect(findPendingAuth(pending, first.state)!.returnTo).toBe("/ja/link");
    expect(findPendingAuth(pending, second.state)!.returnTo).toBeNull();
  });

  it("**先に**始めた方のコードでも、ログインは成立する（本障害の核）", async () => {
    /* 単一 cookie 時代はここが `invalid_state` で落ちていた。2 回目の開始が
     * shop_state / shop_cv / shop_nonce を上書きするため。 */
    const first = await startLogin();
    const second = await startLogin(first.cookies);
    expect(second.state).not.toBe(first.state);

    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims(first.nonce))),
    );

    const response = await callback(
      callbackRequest(`?code=CODE&state=${first.state}`, second.cookies),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/account");
    expect(location.searchParams.get("error")).toBeNull();
    expect(writtenCookies(response).shop_at).toBe("enc(at)");
  });

  it("使い終わった試行だけを捨て、同時進行の別の試行は残す", async () => {
    const first = await startLogin();
    const second = await startLogin(first.cookies);

    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims(first.nonce))),
    );
    const response = await callback(
      callbackRequest(`?code=CODE&state=${first.state}`, second.cookies),
    );

    const remaining = parsePendingAuths(writtenCookies(response)[PENDING_AUTH_COOKIE]);
    // 使った方は消える（code の使い回しを許さない）。
    expect(findPendingAuth(remaining, first.state)).toBeNull();
    // もう一方は生きたまま。掃除で巻き添えにしない。
    expect(findPendingAuth(remaining, second.state)).not.toBeNull();
  });
});

// --- 3. 成立しているログインをエラーにしない --------------------------------

describe("すでにログインが成立していれば、失敗した往復でエラーを出さない", () => {
  const SESSION = { shop_at: "enc(at)", shop_rt: "enc(rt)" };

  it("code の二度目の提示（invalid_grant）でエラー画面を出さない", async () => {
    /* 実際の並び: 1 本目の戻りでログイン成立 → 同じ code を持った 2 本目が
     * Shopify に拒まれる。従来はこの 2 本目のエラーだけが画面に出ていた。 */
    const attempt = await startLogin();
    exchangeTokenMock.mockRejectedValue(new Error("Token exchange failed: 400 invalid_grant"));

    const response = await callback(
      callbackRequest(`?code=USED&state=${attempt.state}`, {
        ...attempt.cookies,
        ...SESSION,
      }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/account");
    expect(location.searchParams.get("error")).toBeNull();
  });

  it("state が引けない戻りでも、セッションがあればエラーにしない", async () => {
    const response = await callback(
      callbackRequest("?code=CODE&state=UNKNOWN", { shop_locale: "ja", ...SESSION }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/account");
    expect(location.searchParams.get("error")).toBeNull();
  });

  it("セッションが無ければ、理由の届く場所にエラーを出す", async () => {
    /* ここを /account に飛ばすと middleware がクエリごと落として /login に送るため、
     * 利用者には理由の無いログイン画面しか出ない。route 自身が nonce 経路について
     * 同じことを説明しているのに、state 経路と catch-all は直っていなかった。 */
    const response = await callback(
      callbackRequest("?code=CODE&state=UNKNOWN", { shop_locale: "ja" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/login");
    expect(location.searchParams.get("error")).toBe("StateMismatch");
    // 文言に訳せるキーであること（訳せないと無言の画面に戻る）。
    expect(ERROR_KEY_MAP.StateMismatch).toBeDefined();
  });

  it("提供元が error= を返したときは、それとして記録して出す", async () => {
    /* 以前は読まれておらず、code が無いという理由だけで state 不一致に畳まれて
     * いた。何を拒まれたのかがログから消えるのが実害。 */
    const response = await callback(
      callbackRequest("?error=login_required&error_description=no+session", {
        shop_locale: "ja",
      }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/login");
    expect(location.searchParams.get("error")).toBe("ProviderRejected");
    expect(ERROR_KEY_MAP.ProviderRejected).toBeDefined();

    const reported = captureMessageMock.mock.calls.at(-1);
    expect(String(reported?.[1]?.extra?.reason)).toContain("login_required");
  });

  it("提供元が返した文字列でログに偽の行を差し込めない", async () => {
    /* `?error=` / `?error_description=` は URL から来る = 誰でも仕込める。
     * `searchParams.get` は %0A を実際の改行に戻すので、素通しするとログに偽の
     * 行を差し込める。**後から原因を追う人が読むのはそのログ**なので汚させない。 */
    await callback(
      callbackRequest(
        `?error=x&error_description=${encodeURIComponent("ok\n[Auth Callback] login succeeded")}`,
        { shop_locale: "ja" },
      ),
    );

    const reason = String(captureMessageMock.mock.calls.at(-1)?.[1]?.extra?.reason);
    expect(reason).not.toContain("\n");
    expect(reason).toContain("ok[Auth Callback] login succeeded");
  });

  it("失敗は必ず記録される（無言で落ちない）", async () => {
    /* 2026-08-25 の調査が長引いた直接の理由が「state 不一致の経路が Vercel の
     * ログにも Sentry にも 1 行も残さない」だったので、記録そのものを固定する。 */
    await callback(callbackRequest("?code=CODE&state=UNKNOWN", { shop_locale: "ja" }));

    expect(captureMessageMock).toHaveBeenCalledWith(
      "Shopify OAuth callback failed",
      expect.objectContaining({ tags: { subsystem: "shopify-oauth" } }),
    );
  });
});

// --- 入れ物そのものの性質 ----------------------------------------------------

describe("進行中ログインの入れ物", () => {
  const entry = (state: string, createdAt: number): PendingAuth => ({
    state,
    verifier: `v-${state}`,
    nonce: `n-${state}`,
    locale: "ja",
    returnTo: null,
    createdAt,
  });

  it("期限切れは読み出しで捨てる", () => {
    const now = 1_000_000_000_000;
    const cookie = serializePendingAuths([
      entry("old", now - 11 * 60 * 1000),
      entry("fresh", now - 60 * 1000),
    ]);

    const parsed = parsePendingAuths(cookie, now);
    expect(parsed.map((e) => e.state)).toEqual(["fresh"]);
  });

  it("上限を超えたら古い方から捨てる（新しい試行が入らない方が困る）", () => {
    const now = 1_000_000_000_000;
    let list: PendingAuth[] = [];
    for (let i = 0; i < PENDING_AUTH_MAX + 2; i += 1) {
      list = addPendingAuth(list, entry(`s${i}`, now), now);
    }

    expect(list).toHaveLength(PENDING_AUTH_MAX);
    expect(findPendingAuth(list, "s0")).toBeNull();
    expect(findPendingAuth(list, `s${PENDING_AUTH_MAX + 1}`)).not.toBeNull();
  });

  it("壊れた cookie はログインを止める理由にしない", () => {
    expect(parsePendingAuths("not-base64url!!")).toEqual([]);
    expect(parsePendingAuths(Buffer.from("{oops").toString("base64url"))).toEqual([]);
    expect(parsePendingAuths(Buffer.from('{"a":1}').toString("base64url"))).toEqual([]);
    expect(parsePendingAuths(undefined)).toEqual([]);
  });
});

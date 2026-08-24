/**
 * F16 — メールログインの callback が、**連携が成立していないのに** LINE セッションを
 * 捨てていた件を固定する。
 *
 * ## 何が割れていたか
 *
 * 合体 (`completeLineLinkage`) は B5 を閉じるときに「連携台帳に行があるときだけ
 * 動く」へ厳しくなった。ところが callback の cookie 掃除は
 * 「`line_uid` cookie が同居している」という**古い条件のまま**残り、
 * `completeLineLinkage` の結果を一切見ずに `clearAuthCookies(response, "line")`
 * を呼んでいた。
 *
 * その結果、LINE だけで使っていた人 (＝台帳に行が無い人) がメールでログインすると:
 *
 *   1. 合体は起きない — お気に入りは `users/line:<id>/` に残ったまま
 *   2. それでも LINE cookie 4 本 (`line_user` / `line_session` / `line_auth` /
 *      `line_uid`) が消える
 *   3. その人は `line:` の棚へ戻る入口を失う → 「保存したものが消えた」
 *
 * ## この検査の要点
 *
 * `completeLineLinkage` の **7 つの outcome を全件** 通す。「not-linked を足した」
 * だけでは、`ledger-unreadable` や `merge-failed` を掃除に倒す実装
 * (`outcome !== "not-linked"` のような否定形の条件) が素通りする。掃除してよいのは
 * `merged` **だけ**であり、その 1 対 6 の非対称を表として固定する。
 *
 * 掃除する側の検査は「消えた名前がある」ではなく `expectedClearedPairs("line")`
 * との**完全一致**で見る。両スコープ (host-only + `.elxea.com`) を出す担保は
 * `auth-cookie-clear-parity.test.ts` が持つが、ここを部分一致にすると
 * 「片スコープだけ出す」実装に戻したときこの経路からは気付けない。
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
import { LINE_SESSION_COOKIES, expectedClearedPairs } from "@/lib/auth/cookies";
import type { LinkageOutcome } from "@/lib/auth/identity-link";

// --- Mocks ------------------------------------------------------------------

const exchangeTokenMock = vi.fn();
const getCustomerMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    exchangeToken: (...args: unknown[]) => exchangeTokenMock(...args),
    getCustomer: (...args: unknown[]) => getCustomerMock(...args),
    encryptToken: (value: string) => `enc(${value})`,
    /* 本物と同じ「復号できなければ空を返す」形にしておく。`enc()` を渡した回
       (下の「復号できなかった」ケース) が本番と同じ経路を通る。 */
    decryptToken: (value: string) => value.replace(/^enc\(|\)$/g, ""),
  };
});

const completeLinkageMock = vi.fn();
vi.mock("@/lib/auth/identity-link", () => ({
  completeLineLinkage: (args: unknown) => completeLinkageMock(args),
}));

vi.mock("@/lib/email/welcome", () => ({ sendWelcomeEmail: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET } from "@/app/api/auth/callback/route";
import { __resetShopifyJwksCacheForTests } from "@/lib/shopify/id-token";

// --- Helpers ----------------------------------------------------------------

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";
const LINE_UID_ENC = "enc(U0123456789abcdef)";
const keypair = makeKeypair();

const HAPPY_COOKIES = {
  shop_cv: "code-verifier",
  shop_state: "STATE",
  shop_nonce: NONCE,
  shop_locale: "ja",
};

function callbackRequest(cookies: Record<string, string>): NextRequest {
  const request = new NextRequest(
    "https://www.elxea.com/api/auth/callback?code=CODE&state=STATE",
    { headers: { host: "www.elxea.com", "x-forwarded-proto": "https" } },
  );
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

/** 署名も nonce も正しい token。どのケースもログイン自体は成立させる。 */
function happyTokenResponse() {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    id_token: signIdToken(keypair, validClaims(NONCE)),
  };
}

type Directive = { name: string; domain: string | undefined; expires: boolean };

function directivesOf(response: Response): Directive[] {
  return response.headers.getSetCookie().map((raw) => {
    const [nameValue, ...attrs] = raw.split(";").map((s) => s.trim());
    const name = nameValue.split("=")[0];
    let domain: string | undefined;
    let expires = false;
    for (const attr of attrs) {
      const [k, v] = attr.split("=");
      const key = k.toLowerCase();
      if (key === "domain") domain = v?.toLowerCase();
      if (key === "max-age" && Number(v) <= 0) expires = true;
      if (key === "expires" && v && new Date(v).getTime() <= Date.now()) expires = true;
    }
    return { name, domain, expires };
  });
}

/** 期限切れにされた LINE cookie の (name, domain) キー。並びは無視する。 */
function expiredLineKeys(response: Response): string[] {
  return [
    ...new Set(
      directivesOf(response)
        .filter(
          (d) => d.expires && (LINE_SESSION_COOKIES as readonly string[]).includes(d.name),
        )
        .map((d) => `${d.name}@${d.domain ?? "(host-only)"}`),
    ),
  ].sort();
}

const EXPECTED_WHEN_CLEARED = [
  ...new Set(
    expectedClearedPairs("line").map((p) => `${p.name}@${p.domain ?? "(host-only)"}`),
  ),
].sort();

/** その outcome を返す `completeLineLinkage` を仕込む。 */
function linkageReturns(outcome: LinkageOutcome) {
  completeLinkageMock.mockResolvedValue({ outcome, merge: null });
}

const SAVED = {
  hosts: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  discovery: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
};

let realFetch: typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  __resetShopifyJwksCacheForTests();
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
  getCustomerMock.mockResolvedValue(null);
  exchangeTokenMock.mockResolvedValue(happyTokenResponse());
  linkageReturns("merged");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  realFetch = globalThis.fetch;
  globalThis.fetch = makeJwksFetch([keypair.jwk]);
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetShopifyJwksCacheForTests();
  globalThis.fetch = realFetch;
  for (const [key, value] of [
    ["LINE_ALLOWED_CALLBACK_HOSTS", SAVED.hosts],
    ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID", SAVED.clientId],
    ["SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL", SAVED.discovery],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------

describe("メールログイン callback の LINE セッション掃除は合体の結果に従う", () => {
  it("合体まで到達したときは、従来どおり両スコープで掃除する", async () => {
    linkageReturns("merged");

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, line_uid: LINE_UID_ENC }));

    /* 部分一致ではなく完全一致。`.elxea.com` 側が欠けた実装に戻したとき、
       この経路からも落ちるようにしておく。 */
    expect(expiredLineKeys(response)).toEqual(EXPECTED_WHEN_CLEARED);
  });

  /* 合体していない 6 通り。**1 つずつ全部**通す。「not-linked だけ弾く」実装は
     ここで残りの 5 件が落ちる。 */
  const PRESERVED: ReadonlyArray<[LinkageOutcome, string]> = [
    ["not-linked", "台帳に行が無い (F16 の直接原因)。棚は line: 側に残っている"],
    ["linked-elsewhere", "その LINE は別の顧客と連携している。棚を触っていない"],
    ["ledger-unreadable", "台帳が読めない。掃除側も推測しない"],
    ["merge-failed", "元が残っている。cookie が次回ログインの再試行の燃料"],
    ["same-key", "引っ越し元と先が同じ。何も起きていない"],
    ["invalid-input", "識別子が空。何も起きていない"],
  ];

  it.each(PRESERVED)("outcome=%s では LINE cookie を 1 本も消さない (%s)", async (outcome) => {
    linkageReturns(outcome);

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, line_uid: LINE_UID_ENC }));

    expect(expiredLineKeys(response)).toEqual([]);
  });

  it("復号できなかった line_uid では、合体を呼ばず cookie も消さない", async () => {
    /* `decryptToken` が空を返す (鍵の入れ替え・壊れた cookie)。何を消してよいか
       判断できていないので、掃除も走らせない。旧実装はこの経路でも消していた。 */
    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, line_uid: "enc()" }));

    expect(completeLinkageMock).not.toHaveBeenCalled();
    expect(expiredLineKeys(response)).toEqual([]);
  });

  it("温存してもメールログイン自体は成立する", async () => {
    /* 「消さない」を「ログインが壊れた」で達成していないことの担保。
       Shopify セッションは通常どおり張られ、行き先も /ja/account のまま。 */
    linkageReturns("not-linked");

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, line_uid: LINE_UID_ENC }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.elxea.com/ja/account");
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("shop_at=");
    expect(setCookie).toContain("shop_cid=");
  });

  it("温存しても PKCE の使い捨て cookie は掃除される", async () => {
    /* 掃除の条件を絞った副作用で、無関係な使い捨て cookie まで残さないこと。 */
    linkageReturns("not-linked");

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, line_uid: LINE_UID_ENC }));

    const setCookie = response.headers.getSetCookie().join("\n");
    for (const name of ["shop_cv", "shop_state", "shop_nonce", "shop_return_to"]) {
      expect(setCookie).toContain(`${name}=;`);
    }
  });

  it("LINE セッションが同居していなければ、合体にも掃除にも進まない", async () => {
    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(completeLinkageMock).not.toHaveBeenCalled();
    expect(expiredLineKeys(response)).toEqual([]);
  });
});

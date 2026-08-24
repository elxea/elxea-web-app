/**
 * F1 — ワンタップ連携で起きたことを、戻ってきた画面で必ず伝える。
 *
 * ## 何が欠けていたか
 *
 * J-1 案A のワンタップは、押した人を Shopify のログインへ送り出し、戻ってきた
 * `/api/auth/callback` で台帳に行を立てる。ところがその戻り先は**何も表示していなかった**。
 * 台帳が 409 で断っても、cx-agent に届かなくても、成功しても、画面はただのマイページに
 * 戻るだけ。押した人から見ると、どれも「押したのに何も起きなかった」と同じ形になる。
 *
 * これは J-1 案A がまさに直そうとしていた体験（設計書 §1-2「押しても定義上 100% 何も
 * 起きない」）を、**別の経路で作り直している**。#128 は他の 3 経路（LIFF / P2 callback /
 * マイページ）に明示表示を入れたが、この 4 本目だけが取り残されていた。
 *
 * ## この検査が固定すること
 *
 * 1. **恒久的な衝突は `error` に潰さない。** 「時間をおいてもう一度」は、何度試しても
 *    成功しない衝突に対しては嘘であり、お客さまを無限の再試行に案内する（#128 が
 *    他経路で直したのと同じ欠陥）。
 * 2. **衝突の向きを取り違えない。** 「このメールに別の LINE が付いている」と
 *    「この LINE に別のメールが付いている」は、**次にやるべきことが逆**。1 語に畳むと
 *    片方の人を必ず間違った操作へ案内する。
 * 3. **押していない人には出さない。** 共用端末に他人の LINE cookie が同居しているだけの
 *    ログインで「連携できませんでした」と出るのは、頼んでいない知らせである。
 * 4. **連携の成否と合体の成否を混ぜない。** 台帳に行が立ったなら連携は完了しており、
 *    そのあとの合体が半端でも「連携できませんでした」ではない。
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
import type { LinkageCompletion, LinkageOutcome } from "@/lib/auth/identity-link";
import type { OneTapLinkResult } from "@/lib/auth/one-tap-link";

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
    /* 封筒（link-intent）も LINE cookie もこの 2 つを通る。本物と同じ
       「復号できなければ空」の形にしておく。 */
    encryptToken: (value: string) => `enc(${value})`,
    decryptToken: (value: string) => value.replace(/^enc\(|\)$/g, ""),
  };
});

const completeLinkageMock = vi.fn();
const applyLinkageMock = vi.fn();
vi.mock("@/lib/auth/identity-link", () => ({
  completeLineLinkage: (args: unknown) => completeLinkageMock(args),
  applyLinkageEstablished: (args: unknown) => applyLinkageMock(args),
}));

vi.mock("@/lib/email/welcome", () => ({ sendWelcomeEmail: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET } from "@/app/api/auth/callback/route";
import { LINK_INTENT_COOKIE, sealLinkIntent } from "@/lib/auth/link-intent";
import { resolveOneTapResult } from "@/lib/auth/one-tap-link";
import { __resetShopifyJwksCacheForTests } from "@/lib/shopify/id-token";

// --- Fixtures ---------------------------------------------------------------

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";
const LINE_USER = "U0123456789abcdef0123456789abcdef";
const keypair = makeKeypair();

const HAPPY_COOKIES = {
  shop_cv: "code-verifier",
  shop_state: "STATE",
  shop_nonce: NONCE,
  shop_locale: "ja",
  line_uid: `enc(${LINE_USER})`,
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

function happyTokenResponse() {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    id_token: signIdToken(keypair, validClaims(NONCE)),
  };
}

/** 戻り先 URL に載った `line_link` の値（無ければ null）。 */
function linkResultOf(response: Response): string | null {
  const location = response.headers.get("location");
  expect(location, "戻り先が無い").toBeTruthy();
  return new URL(location!).searchParams.get("line_link");
}

function completion(outcome: LinkageOutcome): LinkageCompletion {
  return { outcome, merge: null };
}

/**
 * 偽 cx-agent。`/api/identity/link-liff` にだけ答え、それ以外は JWKS へ回す。
 *
 * ホストで判定しないのは `CX_AGENT_BASE_URL` が import 時に確定するため
 * （env をあとから変えても効かない）。パスで見れば環境に依らない。
 */
function fetchWith(linkLiffStatus: number | "throw") {
  const jwks = makeJwksFetch([keypair.jwk]);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/identity/link-liff")) {
      if (linkLiffStatus === "throw") throw new Error("cx-agent unreachable");
      return new Response(JSON.stringify({ ok: linkLiffStatus < 400 }), {
        status: linkLiffStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return jwks(input, init);
  }) as typeof fetch;
}

const SAVED = {
  hosts: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  discovery: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
  syncSecret: process.env.SYNC_API_SECRET,
};

let realFetch: typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  __resetShopifyJwksCacheForTests();
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
  /* 鍵が無いと `establishLinkageFromIntent` は cx-agent を呼ばずに諦める
     （fail-closed）。衝突を検査したいので、合成の鍵を置く。 */
  process.env.SYNC_API_SECRET = "fake-sync-secret";
  getCustomerMock.mockResolvedValue(null);
  exchangeTokenMock.mockResolvedValue(happyTokenResponse());
  completeLinkageMock.mockResolvedValue(completion("not-linked"));
  applyLinkageMock.mockResolvedValue(completion("merged"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  realFetch = globalThis.fetch;
  globalThis.fetch = fetchWith(200);
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetShopifyJwksCacheForTests();
  globalThis.fetch = realFetch;
  for (const [key, value] of [
    ["LINE_ALLOWED_CALLBACK_HOSTS", SAVED.hosts],
    ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID", SAVED.clientId],
    ["SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL", SAVED.discovery],
    ["SYNC_API_SECRET", SAVED.syncSecret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------

describe("ワンタップの結果を 1 語に畳む（純粋な写像）", () => {
  const conflict: OneTapLinkResult = {
    ok: false,
    reason: "conflict",
    detail: "shopify_customer_already_linked",
  };

  it("台帳に書けたら success。合体が半端でも連携は完了している", () => {
    expect(resolveOneTapResult({ ok: true }, completion("merged"))).toBe("success");
    expect(resolveOneTapResult({ ok: true }, completion("merge-failed"))).toBe("success");
  });

  it("409 は error に潰さない（何度試しても直らないので再試行を促さない）", () => {
    expect(resolveOneTapResult(conflict, completion("not-linked"))).toBe("conflict");
  });

  it("台帳が「この LINE は別の顧客のもの」と言ったら、衝突の向きを逆に読む", () => {
    expect(resolveOneTapResult(conflict, completion("linked-elsewhere"))).toBe(
      "line-conflict",
    );
  });

  /* やり直せば直りうるものだけが error。恒久的な衝突と混ぜない。 */
  const RETRYABLE = ["not-configured", "unreachable", "rejected"] as const;
  it.each(RETRYABLE)("reason=%s は error（やり直せば直りうる）", (reason) => {
    expect(
      resolveOneTapResult({ ok: false, reason, detail: "x" }, completion("not-linked")),
    ).toBe("error");
  });
});

describe("ワンタップで戻ってきた画面に、起きたことが載る", () => {
  /** 押した瞬間の封筒。いまの LINE と束縛が取れているものだけが開く。 */
  function intentCookie() {
    return { [LINK_INTENT_COOKIE]: sealLinkIntent(LINE_USER)! };
  }

  it("成立したら success を載せる", async () => {
    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, ...intentCookie() }));
    expect(linkResultOf(response)).toBe("success");
  });

  it("cx-agent が 409 を返したら conflict を載せる（error にしない）", async () => {
    globalThis.fetch = fetchWith(409);
    completeLinkageMock.mockResolvedValue(completion("not-linked"));

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, ...intentCookie() }));

    expect(linkResultOf(response)).toBe("conflict");
  });

  it("その LINE が別の顧客のものなら line-conflict を載せる", async () => {
    globalThis.fetch = fetchWith(409);
    completeLinkageMock.mockResolvedValue(completion("linked-elsewhere"));

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, ...intentCookie() }));

    expect(linkResultOf(response)).toBe("line-conflict");
  });

  it("cx-agent に届かなければ error を載せる（やり直せば直りうる）", async () => {
    globalThis.fetch = fetchWith("throw");

    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, ...intentCookie() }));

    expect(linkResultOf(response)).toBe("error");
  });

  it("押していない人（封筒が無い）には何も載せない", async () => {
    /* 共用端末に他人の LINE cookie が同居しているだけのログイン。頼んでいない
       知らせを出さない、が G1 の体験側の帰結。 */
    const response = await GET(callbackRequest({ ...HAPPY_COOKIES }));

    expect(linkResultOf(response)).toBeNull();
  });

  it("封筒が別の LINE に束縛されていたら、台帳に書かないし何も載せない", async () => {
    const other = "Ufedcba9876543210fedcba9876543210";
    const response = await GET(
      callbackRequest({
        ...HAPPY_COOKIES,
        [LINK_INTENT_COOKIE]: sealLinkIntent(other)!,
      }),
    );

    expect(linkResultOf(response)).toBeNull();
    /* 束縛が外れた封筒で台帳を書いてはならない（B5 の再発）。 */
    expect(applyLinkageMock).not.toHaveBeenCalled();
  });

  it("結果を載せても、ログインの cookie は作り直さない", async () => {
    /* Location だけを差し替える実装であることを固定する。redirect を組み直す
       実装に戻すと、ここまでに載せたセッション cookie が落ちる。 */
    const response = await GET(callbackRequest({ ...HAPPY_COOKIES, ...intentCookie() }));

    const names = response.headers.getSetCookie().map((c) => c.split("=")[0]);
    for (const required of ["shop_at", "shop_rt", "shop_exp", "shop_auth"]) {
      expect(names, `${required} が落ちている`).toContain(required);
    }
  });
});

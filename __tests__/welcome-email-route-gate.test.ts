/**
 * 歓迎メールの門が **`/api/auth/callback` の中で実際に配線されている** ことを固定する。
 *
 * ## なぜ `welcome-email-once.test.ts` だけでは足りないか
 *
 * 隣の `welcome-email-once.test.ts` は門の**部品**（`isFreshRegistration` /
 * `claimWelcomeEmail`）が正しく判定することを固定している。だがそれは
 * 「部品が正しい」以上のことを言わない。**部品を呼ばない route** も、その検査は
 * 全部緑で通る。
 *
 * 実測（2026-08-30・この検査を足す直前）: route の
 * `if (!isFreshRegistration(...)) return;` と `if (!claim.ok) return;` の
 * 2 行を両方消しても、既存の 67 検査は 1 つも落ちなかった。つまり
 * 「ログインのたびに歓迎メールが飛ぶ」という**事故そのものに戻る変更**を、
 * 機械は誰も止められない状態だった。門を足したのに門番がいない。
 *
 * ## この検査が押さえているもの
 *
 * route を本当に実行し（`GET` を呼び）、`sendWelcomeEmail` が呼ばれたか / 呼ばれ
 * なかったかで判定する。送ってよいのは
 *
 *   「注文が無い」 かつ 「creationDate が新しい」 かつ 「claim が下りた」
 *
 * の 3 つが揃った 1 通りだけで、どれか 1 つでも欠けたら送らない。1 対 N の
 * 非対称なので、送らない側を 1 ケースずつ別々に通す。
 *
 * 順序（claim → send）も固定する。印を送信の**後**に付ける実装は、送信成功後に
 * 落ちた回で二重送信になる。取り消せない側に倒れない順序であることは、
 * 「両方呼ばれた」では表現できないので呼び出し順の配列で見る。
 *
 * ## 実送信はしない
 *
 * `sendWelcomeEmail` はモジュールごと差し替えてあり、この検査から外へは 1 通も
 * 出ない。Firestore も同様に `claimWelcomeEmail` / `releaseWelcomeClaim` の層で
 * 止めてある（台帳そのものの挙動は `welcome-email-once.test.ts` の担当）。
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
const getCustomerMock = vi.fn();
const getCustomerCreationDateMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    exchangeToken: (...args: unknown[]) => exchangeTokenMock(...args),
    getCustomer: (...args: unknown[]) => getCustomerMock(...args),
    getCustomerCreationDate: (...args: unknown[]) => getCustomerCreationDateMock(...args),
    encryptToken: (value: string) => `enc(${value})`,
    decryptToken: (value: string) => value.replace(/^enc\(|\)$/g, ""),
  };
});

/* このリクエストには `line_uid` cookie が無いので連携の枝には入らない。
   それでも差し替えておくのは、route が将来無条件に呼ぶ形に変わったとき、
   この検査が台帳へ実アクセスしに行かないようにするため。 */
vi.mock("@/lib/auth/identity-link", () => ({
  completeLineLinkage: async () => ({ outcome: "merged", merge: null }),
  applyLinkageEstablished: async () => ({ outcome: "merged", merge: null }),
}));

/**
 * 「claim してから送る」順序を見るための共有の記録。
 * 呼ばれた事実だけでなく**並び**を残す。
 */
const callOrder: string[] = [];

const sendWelcomeEmailMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("send");
});
vi.mock("@/lib/email/welcome", () => ({
  sendWelcomeEmail: (...args: unknown[]) => sendWelcomeEmailMock(...args),
}));

const claimWelcomeEmailMock = vi.fn();
const releaseWelcomeClaimMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("release");
});
/* `isFreshRegistration` は **本物のまま** 通す。ここをモックすると、新しさの判定を
   route から外した変更をこの検査が見逃す（門番を検査するのに門番を偽物にしない）。 */
vi.mock("@/lib/email/welcome-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/welcome-gate")>(
    "@/lib/email/welcome-gate",
  );
  return {
    ...actual,
    claimWelcomeEmail: (...args: unknown[]) => {
      callOrder.push("claim");
      return claimWelcomeEmailMock(...args);
    },
    releaseWelcomeClaim: (...args: unknown[]) => releaseWelcomeClaimMock(...args),
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET } from "@/app/api/auth/callback/route";
import { __resetShopifyJwksCacheForTests } from "@/lib/shopify/id-token";
import { FRESH_REGISTRATION_WINDOW_MS } from "@/lib/email/welcome-gate";

// --- Helpers ----------------------------------------------------------------

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";
const keypair = makeKeypair();

/** `validClaims` の `sub`（`gid://shopify/Customer/7654321`）から route が取り出す ID。 */
const CUSTOMER_ID = "7654321";

const HAPPY_COOKIES = {
  shop_cv: "code-verifier",
  shop_state: "STATE",
  shop_nonce: NONCE,
  shop_locale: "ja",
};

function callbackRequest(): NextRequest {
  const request = new NextRequest(
    "https://www.elxea.com/api/auth/callback?code=CODE&state=STATE",
    { headers: { host: "www.elxea.com", "x-forwarded-proto": "https" } },
  );
  for (const [name, value] of Object.entries(HAPPY_COOKIES)) {
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

/** 一度も買っていない会員。歓迎メールの判定が最後まで進む形。 */
const NEVER_ORDERED = {
  firstName: "Hanako",
  lastName: "Yamada",
  emailAddress: { emailAddress: "member@example.invalid" },
  orders: { edges: [] as unknown[] },
};

/** `creationDate` が「今から n ミリ秒前」の顧客だと答えさせる。 */
function registeredMsAgo(ms: number) {
  getCustomerCreationDateMock.mockResolvedValue(new Date(Date.now() - ms));
}

/**
 * 歓迎メールは `void (async () => …)()` でリダイレクトと切り離されている。
 * `GET` が返っても中身はまだ走っているので、マクロタスクを数回跨いで
 * 保留中のマイクロタスクを吐き切らせてから検査する。
 */
async function settleBackgroundWork(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** リダイレクトまで到達させたうえで、背後の歓迎メール処理を終わらせる。 */
async function loginAndSettle(): Promise<Response> {
  const response = await GET(callbackRequest());
  await settleBackgroundWork();
  return response;
}

const SAVED = {
  hosts: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  discovery: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
};

let realFetch: typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  __resetShopifyJwksCacheForTests();
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
  /* route は判定の理由を console に残す。検査の出力を埋めないよう黙らせるだけで、
     判定そのものは何も変えていない。 */
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  realFetch = globalThis.fetch;
  globalThis.fetch = makeJwksFetch([keypair.jwk]);
  exchangeTokenMock.mockResolvedValue(happyTokenResponse());
  getCustomerMock.mockResolvedValue(NEVER_ORDERED);
  claimWelcomeEmailMock.mockResolvedValue({ ok: true });
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

describe("/api/auth/callback は歓迎メールを初回登録の 1 通だけに閉じている", () => {
  it("正当な新規登録には 1 通だけ送り、印を送信の前に付ける", async () => {
    registeredMsAgo(3_000);

    await loginAndSettle();

    expect(sendWelcomeEmailMock).toHaveBeenCalledTimes(1);
    /* 「両方呼ばれた」ではなく並びで見る。逆順は二重送信を許す実装。 */
    expect(callOrder).toEqual(["claim", "send"]);
    expect(claimWelcomeEmailMock).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  /* 事故そのもの: 昔登録して一度も買っていない人。注文 0 件は初回の証拠にならない。 */
  it("5 日前に登録した未購入会員には送らず、権利取得すら試みない", async () => {
    registeredMsAgo(5 * 24 * 60 * 60 * 1000);

    const response = await loginAndSettle();

    expect(response.status).toBe(307);
    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
    expect(claimWelcomeEmailMock).not.toHaveBeenCalled();
  });

  it("窓の境界の内側は送り、1 秒でも外なら送らない", async () => {
    registeredMsAgo(FRESH_REGISTRATION_WINDOW_MS - 2_000);
    await loginAndSettle();
    expect(sendWelcomeEmailMock).toHaveBeenCalledTimes(1);

    sendWelcomeEmailMock.mockClear();
    claimWelcomeEmailMock.mockClear();

    registeredMsAgo(FRESH_REGISTRATION_WINDOW_MS + 1_000);
    await loginAndSettle();
    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
  });

  /* 時計のずれや壊れた値で窓が無限に広がらないこと。 */
  it("未来の作成日時は新しさの証拠にならないので送らない", async () => {
    registeredMsAgo(-60_000);

    await loginAndSettle();

    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
  });

  it("作成日時が読めなければ送らない（fail-closed）", async () => {
    getCustomerCreationDateMock.mockResolvedValue(null);

    await loginAndSettle();

    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
  });

  /* 窓の中で何度ログインしても 2 通目を出さない最後の歯。 */
  it("既に送った人（already-sent）には送らない", async () => {
    registeredMsAgo(3_000);
    claimWelcomeEmailMock.mockResolvedValue({ ok: false, reason: "already-sent" });

    await loginAndSettle();

    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
  });

  /* 「もう送ったか」が言えないまま外部送信しない。 */
  it("台帳に届かない（ledger-unavailable）ときは送らない", async () => {
    registeredMsAgo(3_000);
    claimWelcomeEmailMock.mockResolvedValue({
      ok: false,
      reason: "ledger-unavailable",
      detail: "unavailable",
    });

    await loginAndSettle();

    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
  });

  it("注文がある人には、作成日時を見るまでもなく送らない", async () => {
    getCustomerMock.mockResolvedValue({
      ...NEVER_ORDERED,
      orders: { edges: [{}] },
    });
    registeredMsAgo(3_000);

    await loginAndSettle();

    expect(sendWelcomeEmailMock).not.toHaveBeenCalled();
    expect(getCustomerCreationDateMock).not.toHaveBeenCalled();
  });

  /* 送れなかったのに印だけ残ると、その人は永久に受け取れない。 */
  it("送信に失敗したら印を戻す", async () => {
    registeredMsAgo(3_000);
    sendWelcomeEmailMock.mockRejectedValueOnce(new Error("smtp down"));

    await loginAndSettle();

    expect(releaseWelcomeClaimMock).toHaveBeenCalledWith(CUSTOMER_ID);
  });
});

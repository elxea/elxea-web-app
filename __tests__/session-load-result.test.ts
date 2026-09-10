/**
 * セッション読み出しは「未ログイン」と「判定できなかった」を分けて返す
 * (設計憲章 R1 / Wave 0)。
 *
 * ## 直している割れ方
 *
 * `getCustomerFromSession` は `Customer | null`、`getSubscriptionsFromSession` は
 * `SubscriptionContract[]` を返していた。どちらも失敗時は `catch` で `null` / `[]`
 * に倒し、`console.error` を 1 行吐くだけだった。`console.error` は Vercel の
 * ログに落ちるだけで集計もアラートも無いので、**実質的に沈黙**である。
 *
 * その結果、Shopify の一時障害はこう見えていた:
 *
 *   - マイページ            … 「ログインが必要です」(ログイン済みの人を追い返す)
 *   - 定期便ページ          … 「まだご契約はありません」(契約中の人に解約と誤解させる)
 *   - チャット              … ログイン中の顧客が匿名として cx-agent に渡る
 *
 * どれも顧客に**嘘の断定**を見せている。しかも `null` / `[]` は「0 件だった」という
 * 主張なので、呼び出し側にはそれを疑う手掛かりが無い。
 *
 * ## この層が守る契約
 *
 *   1. cookie が無い → `{ ok: true, data: null }` (確定的に未ログイン)
 *   2. リフレッシュが失敗 → `{ ok: false, reason: "upstream-unavailable" }`
 *   3. 顧客取得が失敗 → 同上
 *   4. 失敗は必ず Sentry に上がる (握り潰さない)
 *   5. `ok: false` に `data` を生やさない — 生やすと `result.data ?? []` で
 *      今までどおり握り潰せてしまい、型が何も守らなくなる
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

/* cookie は 1 テストごとに差し替える。`shop_rt` の有無が「未ログインか否か」の
   唯一の判定材料である (lib/shopify/auth.ts の getSession を参照)。 */
let cookies: Record<string, string> = {};
const cookieStore = {
  get: (name: string) =>
    cookies[name] === undefined ? undefined : { name, value: cookies[name] },
  set: vi.fn(),
  delete: vi.fn(),
  has: (name: string) => cookies[name] !== undefined,
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const decryptToken = vi.fn();
const refreshAccessToken = vi.fn();
const getCustomer = vi.fn();
const getSubscriptionContracts = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    decryptToken: (...a: unknown[]) => decryptToken(...a),
    encryptToken: (v: string) => v,
    refreshAccessToken: (...a: unknown[]) => refreshAccessToken(...a),
    getCustomer: (...a: unknown[]) => getCustomer(...a),
    getSubscriptionContracts: (...a: unknown[]) => getSubscriptionContracts(...a),
  };
});

const CUSTOMER = { id: "gid://shopify/Customer/1", emailAddress: null };

async function auth() {
  return import("@/lib/shopify/auth");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  cookies = {};
  decryptToken.mockImplementation((v: string) => `decrypted:${v}`);
});

describe("未ログインは ok:true / data 空 (障害ではない)", () => {
  it("cookie が無ければ customer は { ok: true, data: null }", async () => {
    const { getCustomerFromSession } = await auth();

    await expect(getCustomerFromSession()).resolves.toEqual({
      ok: true,
      data: null,
    });
    // 未ログインは異常ではないので、アラートを鳴らさない。
    expect(captureException).not.toHaveBeenCalled();
  });

  it("cookie が無ければ subscriptions は { ok: true, data: [] }", async () => {
    const { getSubscriptionsFromSession } = await auth();

    await expect(getSubscriptionsFromSession()).resolves.toEqual({
      ok: true,
      data: [],
    });
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("引けなかったときは ok:false（未ログインに化けない）", () => {
  beforeEach(() => {
    /* 生きた refresh token を持っているが access token は無い = リフレッシュ必須。
       この人は**ログイン済み**であって、未ログインではない。 */
    cookies = { shop_rt: "enc-rt" };
  });

  it("リフレッシュが落ちても「未ログイン」と言わない", async () => {
    refreshAccessToken.mockRejectedValue(new Error("shopify token endpoint 503"));
    const { getCustomerFromSession } = await auth();

    const result = await getCustomerFromSession();

    expect(result).toEqual({ ok: false, reason: "upstream-unavailable" });
    /* ここが要点: `data` が無いので、呼び出し側は「顧客がいなかった」と
       読むことができない。 */
    expect(result).not.toHaveProperty("data");
    expect(captureException).toHaveBeenCalled();
  });

  it("顧客取得が落ちても「未ログイン」と言わない", async () => {
    refreshAccessToken.mockResolvedValue({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
    });
    getCustomer.mockRejectedValue(new Error("customer api 500"));
    const { getCustomerFromSession } = await auth();

    const result = await getCustomerFromSession();

    expect(result).toEqual({ ok: false, reason: "upstream-unavailable" });
    expect(captureException).toHaveBeenCalled();
  });

  it("定期便が引けなくても「契約 0 件」と言わない", async () => {
    refreshAccessToken.mockResolvedValue({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
    });
    getSubscriptionContracts.mockRejectedValue(new Error("subscription api 500"));
    const { getSubscriptionsFromSession } = await auth();

    const result = await getSubscriptionsFromSession();

    expect(result).toEqual({ ok: false, reason: "upstream-unavailable" });
    /* `[]` が返っていないこと。ここが `[]` に戻ると、契約中の顧客に
       「まだご契約はありません」と表示する回帰が復活する。 */
    expect(result).not.toHaveProperty("data");
    expect(captureException).toHaveBeenCalled();
  });

  it("refresh token が復号できないのは事故として記録する", async () => {
    decryptToken.mockReturnValue(null);
    const { getCustomerFromSession } = await auth();

    const result = await getCustomerFromSession();

    expect(result).toEqual({ ok: false, reason: "credentials-unreadable" });
    // SESSION_SECRET のローテーション等。黙ってログアウト扱いにしない。
    expect(captureException).toHaveBeenCalled();
  });
});

describe("ログイン中は従来どおり値が返る", () => {
  beforeEach(() => {
    cookies = { shop_rt: "enc-rt" };
    refreshAccessToken.mockResolvedValue({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
    });
  });

  it("customer が取れれば { ok: true, data: Customer }", async () => {
    getCustomer.mockResolvedValue(CUSTOMER);
    const { getCustomerFromSession } = await auth();

    await expect(getCustomerFromSession()).resolves.toEqual({
      ok: true,
      data: CUSTOMER,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("契約が本当に 0 件なら { ok: true, data: [] } (障害と区別できる)", async () => {
    getSubscriptionContracts.mockResolvedValue([]);
    const { getSubscriptionsFromSession } = await auth();

    const result = await getSubscriptionsFromSession();

    expect(result).toEqual({ ok: true, data: [] });
    /* 「本当に 0 件」と「引けなかった」が別の値であること —
       この 2 つを同じ `[]` に潰していたのが元の欠陥である。 */
    expect(result).not.toEqual({ ok: false, reason: "upstream-unavailable" });
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("getSession は互換のまま (呼び出し側を壊さない)", () => {
  it("判定不能でも null を返す — 続行できない経路の挙動は変えていない", async () => {
    cookies = { shop_rt: "enc-rt" };
    refreshAccessToken.mockRejectedValue(new Error("shopify down"));
    const { getSession } = await auth();

    await expect(getSession()).resolves.toBeNull();
  });
});

/**
 * Tests for 本人解決の連携台帳参照（マイページ分裂の修正）と cx-agent への解除要求。
 *
 * ## 直している症状
 *
 * `resolveIdentity` はログイン手段ごとに別の Firestore の棚を選び（Shopify は
 * `users/{shopifyCustomerId}`、LINE は `users/line:{lineUserId}`）、**連携台帳を
 * 一切見ていなかった**。だから連携済みでも「メールでログインしたとき」と
 * 「LINE でログインしたとき」で別のマイページが見えた。
 *
 * この経路が守るべき契約:
 *   1. 連携済みの LINE セッション → **Shopify 顧客の棚**に解決する（分裂しない）。
 *   2. 未連携の LINE セッション → 従来どおり `line:` の棚（挙動を変えない）。
 *   3. 解除された連携 → 台帳がヒットしなくなるので `line:` の棚に戻る。
 *      キャッシュがあっても **60 秒以内**に反映される（生存検証の上限）。
 *   4. 読めなかった（不達 / timeout / 秘密未設定 / 壊れた応答）→ 顧客 ID を
 *      **推測しない**。`line:` の棚に倒す（他人の棚を開けるより安全側）。
 *   5. cx-agent へ渡す LINE userId は **サーバ確定値**（暗号化 cookie の復号結果）。
 *   6. 解除要求（requestCxUnlink）は **fail-CLOSED**。不達・非 2xx・秘密未設定は
 *      すべて失敗として返す（読み取りの fail-soft と混ぜない）。
 *
 * Shopify / Firestore の実体は使わない。cookie と fetch をスタブして観測する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- module mocks（被テスト module の import より前に置く） -----------------

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined,
    has: (name: string) => cookieStore.has(name),
  }),
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/shopify/auth", () => ({
  getSession: () => getSessionMock(),
}));

/** 暗号化 cookie の復号。テストでは "enc:" prefix を剥がすだけの可逆変換にする。 */
vi.mock("@/lib/shopify/customer", () => ({
  decryptToken: (value: string) =>
    typeof value === "string" && value.startsWith("enc:")
      ? value.slice(4)
      : null,
  getCustomer: vi.fn(async () => null),
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

/** 台帳が読めなかったことの**恒久記録**先。実 SDK は動かさず、送った事実だけ観測する。 */
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";

import { resolveIdentity } from "@/lib/firebase/auth-guard";
import {
  fetchLineLinkageStatusForLineUser,
  fetchShopifyCustomerIdForLineUser,
  invalidateReverseLinkage,
  invalidateReverseLinkageForCustomer,
  __clearLinkageCacheForTest,
  LINKAGE_CACHE_TTL_MS,
  UNKNOWN_LINE_LINKAGE,
} from "@/lib/line/linkage-status";
import { requestCxUnlink } from "@/lib/line/unlink";

const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const SHOPIFY_CUSTOMER_ID = "900800400001";
const LINKED_AT = "2026-08-19T21:13:00.000Z";
const SECRET_ENV = "SYNC_API_SECRET";

let fetchMock: ReturnType<typeof vi.fn>;
const originalSecret = process.env[SECRET_ENV];

/** cx-agent の応答をスタブする。 */
function stubUpstream(body: unknown, ok = true, status = 200) {
  fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
}

/** LINE セッションだけがある状態（Shopify セッションは無い）。 */
function givenLineSession() {
  getSessionMock.mockResolvedValue(null);
  cookieStore.set("line_session", "1");
  cookieStore.set("line_uid", `enc:${LINE_USER_ID}`);
  cookieStore.set("line_user", JSON.stringify({ displayName: "テスト" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  __clearLinkageCacheForTest();
  process.env[SECRET_ENV] = "test-sync-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSecret === undefined) delete process.env[SECRET_ENV];
  else process.env[SECRET_ENV] = originalSecret;
});

// ---------------------------------------------------------------------------
// (a) 連携済みの LINE セッションが Shopify の棚に解決される
// ---------------------------------------------------------------------------

describe("resolveIdentity / 連携済みの LINE セッション", () => {
  it("連携済みなら Shopify 顧客の棚に解決する（メールでログインしたときと同じ棚）", async () => {
    givenLineSession();
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    const identity = await resolveIdentity();

    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated) return;
    expect(identity.userKey).toBe(SHOPIFY_CUSTOMER_ID);
    expect(identity.provider).toBe("shopify");
    expect(identity.shopifyCustomerId).toBe(SHOPIFY_CUSTOMER_ID);
    // LINE 由来であることは失わない（どちらで入ったかは残す）。
    expect(identity.lineUserId).toBe(LINE_USER_ID);
  });

  it("cx-agent には逆引きクエリと X-API-Key を送る（サーバ間限定）", async () => {
    givenLineSession();
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    await resolveIdentity();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/identity/linkage-status");
    expect(url).toContain(`line_user_id=${LINE_USER_ID}`);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
      "test-sync-secret",
    );
    // 連携の生存は都度確かめる（古い「連携済み」で他人の棚を開けない）。
    expect(init.cache).toBe("no-store");
  });

  it("送る LINE userId は cookie の生値ではなく復号後のサーバ確定値", async () => {
    givenLineSession();
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    await resolveIdentity();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain("enc:");
  });
});

// ---------------------------------------------------------------------------
// (b) 未連携の LINE セッションは従来どおり
// ---------------------------------------------------------------------------

describe("resolveIdentity / 未連携の LINE セッション", () => {
  it("未連携なら従来どおり line: の棚（既存の挙動を変えない）", async () => {
    givenLineSession();
    stubUpstream({ linked: false, shopify_customer_id: null });

    const identity = await resolveIdentity();

    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated) return;
    expect(identity.userKey).toBe(`line:${LINE_USER_ID}`);
    expect(identity.provider).toBe("line");
    expect(identity.shopifyCustomerId).toBeNull();
  });

  it("Shopify セッションがあるときは台帳を引かない（従来の最短経路のまま）", async () => {
    getSessionMock.mockResolvedValue({ accessToken: "token" });
    cookieStore.set("shop_cid", `enc:${SHOPIFY_CUSTOMER_ID}`);
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    const identity = await resolveIdentity();

    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated) return;
    expect(identity.userKey).toBe(SHOPIFY_CUSTOMER_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ログインしていなければ台帳を引かない（未認証に連携の有無を漏らさない）", async () => {
    getSessionMock.mockResolvedValue(null);
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    const identity = await resolveIdentity();

    expect(identity.authenticated).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) 解除後は 60 秒以内に遮断される
// ---------------------------------------------------------------------------

describe("fetchShopifyCustomerIdForLineUser / 解除の反映（生存検証）", () => {
  it("解除されると台帳がヒットしなくなり、連携先を返さない", async () => {
    stubUpstream({ linked: false, shopify_customer_id: null });
    const resolved = await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);
    expect(resolved).toBe(false);
  });

  it("キャッシュは 60 秒を超えない（解除の反映が遅れる上限）", async () => {
    expect(LINKAGE_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("TTL 内は往復を減らし、TTL を過ぎたら必ず引き直す", async () => {
    const t0 = 1_000_000;
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0)).toBe(
      SHOPIFY_CUSTOMER_ID,
    );
    // TTL 内: cx-agent を再度叩かない。
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1_000)).toBe(
      SHOPIFY_CUSTOMER_ID,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 解除された。TTL 経過後の読み取りは新しい答えを取りに行く。
    stubUpstream({ linked: false, shopify_customer_id: null });
    const afterTtl = await fetchShopifyCustomerIdForLineUser(
      LINE_USER_ID,
      t0 + LINKAGE_CACHE_TTL_MS + 1,
    );
    expect(afterTtl).toBe(false);
  });

  it("キャッシュは無制限に増えない（長寿命プロセスで漏れない）", async () => {
    stubUpstream({ linked: false, shopify_customer_id: null });
    const t0 = 4_000_000;

    // 上限を超える数の別々の LINE userId を引く。
    for (let i = 0; i < 5100; i++) {
      const id = `U${i.toString(16).padStart(32, "0")}`;
      await fetchShopifyCustomerIdForLineUser(id, t0);
    }

    // 正しさは変わらない（捨てられた人は次回引き直すだけ）。
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0)).toBe(false);
  });

  it("解除は 60 秒以内に本人解決へ効く（TTL 上限での遮断）", async () => {
    const t0 = 2_000_000;
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    stubUpstream({ linked: false, shopify_customer_id: null });
    const at60s = await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 60_000);
    expect(at60s).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 読めなかったときは推測しない
// ---------------------------------------------------------------------------

describe("fetchShopifyCustomerIdForLineUser / 読めなかったとき", () => {
  it("cx-agent が非 2xx → null（未連携とも連携済みとも言わない）", async () => {
    stubUpstream({}, false, 500);
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID)).toBeNull();
  });

  it("不達 / timeout → null（例外を投げない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID)).toBeNull();
  });

  it("linked=true なのに顧客 ID が無い壊れた応答 → null（棚を推測しない）", async () => {
    stubUpstream({ linked: true, shopify_customer_id: null });
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID)).toBeNull();
  });

  it("SYNC_API_SECRET 未設定 → null。無駄打ちもしない（設定漏れ≠未連携）", async () => {
    delete process.env[SECRET_ENV];
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });

    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("「読めない」はキャッシュしない（復旧後すぐ正しい棚に戻れる）", async () => {
    const t0 = 3_000_000;
    stubUpstream({}, false, 503);
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0)).toBeNull();

    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });
    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1)).toBe(
      SHOPIFY_CUSTOMER_ID,
    );
  });

  it("読めないときの resolveIdentity は line: の棚に倒す（他人の棚を開けない）", async () => {
    givenLineSession();
    stubUpstream({}, false, 500);

    const identity = await resolveIdentity();
    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated) return;
    expect(identity.userKey).toBe(`line:${LINE_USER_ID}`);
    expect(identity.provider).toBe("line");
  });
});

// ---------------------------------------------------------------------------
// (c') 読めなかったことが**記録に残る**（F5: 検知の穴）
//
// 読めないときに安全側へ倒すこと自体は上で固定済み。問題はその倒れ方が
// **完全に静か**だったこと。cx-agent が落ちれば全員が「連携済みなのに未連携の棚」
// に落ちるのに、痕跡は console.warn だけ。本番の Vercel ログ保持は 1 時間しかなく、
// 監視 cron が遅れれば痕跡ごと消える。恒久記録は Sentry 側に持たせる。
// ---------------------------------------------------------------------------

describe("読めなかったことを Sentry に残す", () => {
  const captured = () => vi.mocked(Sentry.captureMessage).mock.calls;

  /** 直近の captureMessage に載った reason タグ。 */
  const lastReason = () => {
    const calls = captured();
    const last = calls.at(-1);
    return (last?.[1] as { tags?: { reason?: string } } | undefined)?.tags
      ?.reason;
  };

  it("非 2xx → reason=upstream-status で残る", async () => {
    stubUpstream({}, false, 401);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(captured()).toHaveLength(1);
    expect(lastReason()).toBe("upstream-status");
  });

  it("不達 / timeout → reason=unreachable で残る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(lastReason()).toBe("unreachable");
  });

  it("linked=true なのに顧客 ID が無い → reason=linked-without-customer-id で残る", async () => {
    stubUpstream({ linked: true, shopify_customer_id: null });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(lastReason()).toBe("linked-without-customer-id");
  });

  it("SYNC_API_SECRET 未設定 → reason=secret-missing で残る", async () => {
    delete process.env[SECRET_ENV];
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(lastReason()).toBe("secret-missing");
  });

  it("LINE userId も顧客 ID も載せない（最小開示）", async () => {
    stubUpstream({}, false, 500);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    const serialized = JSON.stringify(captured());
    expect(serialized).not.toContain(LINE_USER_ID);
    expect(serialized).not.toContain(SHOPIFY_CUSTOMER_ID);
    expect(serialized).not.toContain("test-sync-secret");
  });

  it("subsystem タグで identity-link の他の記録と同じ束に入る", async () => {
    stubUpstream({}, false, 500);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    const options = captured()[0]?.[1] as {
      level?: string;
      tags?: { subsystem?: string };
    };
    expect(options.tags?.subsystem).toBe("identity-link");
    expect(options.level).toBe("warning");
  });

  it("障害中に鳴らし続けない（同じ理由は 60 秒に 1 回まで）", async () => {
    /* 逆引きは SSR の広い範囲から呼ばれる。素通しだと 1 画面ごとにイベントが出て
       Sentry の割り当てを焼き切り、**肝心なときに他の異常が届かなくなる**。
       知りたいのは「読めない状態が続いている」ことであって回数ではない。 */
    const t0 = 5_000_000;
    stubUpstream({}, false, 500);

    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1_000);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 59_000);
    expect(captured()).toHaveLength(1);

    // 間隔を越えれば「まだ続いている」がもう一度残る（沈黙させない）。
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 60_001);
    expect(captured()).toHaveLength(2);
  });

  it("理由が違えば間引かれない（切り分けの材料を落とさない）", async () => {
    const t0 = 6_000_000;
    stubUpstream({}, false, 500);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1);

    expect(captured()).toHaveLength(2);
    expect(lastReason()).toBe("unreachable");
  });

  it("読めたときは何も残さない（正常時に鳴る監視にしない）", async () => {
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    stubUpstream({ linked: false });
    __clearLinkageCacheForTest();
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(captured()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (d) 解除要求は fail-CLOSED
// ---------------------------------------------------------------------------

describe("requestCxUnlink / 解除要求", () => {
  it("cx-agent に POST し、サーバ確定 customerId を body に載せる", async () => {
    stubUpstream({ success: true, cleared_count: 2 });

    const result = await requestCxUnlink(SHOPIFY_CUSTOMER_ID);

    expect(result).toEqual({ ok: true, clearedCount: 2 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/identity/unlink");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
      "test-sync-secret",
    );
    /* 対象を名指ししないときは line_user_id を載せない（= その顧客の連携をすべて外す）。
       マイページには LINE を選ぶ UI が無いので、これが意図どおり。 */
    expect(JSON.parse(init.body as string)).toEqual({
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
  });

  it("対象の LINE が分かるときは名指しする（世帯共有で家族の連携を巻き添えにしない・P8）", async () => {
    stubUpstream({ success: true, cleared_count: 1 });

    const result = await requestCxUnlink(SHOPIFY_CUSTOMER_ID, LINE_USER_ID);

    expect(result).toEqual({ ok: true, clearedCount: 1 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
      line_user_id: LINE_USER_ID,
    });
  });

  it("非 2xx → 失敗（成功に丸めない）", async () => {
    stubUpstream({ error: "boom" }, false, 500);
    expect(await requestCxUnlink(SHOPIFY_CUSTOMER_ID)).toEqual({
      ok: false,
      reason: "upstream_error",
    });
  });

  it("不達 → 失敗（読み取りの fail-soft と混ぜない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await requestCxUnlink(SHOPIFY_CUSTOMER_ID)).toEqual({
      ok: false,
      reason: "upstream_error",
    });
  });

  it("SYNC_API_SECRET 未設定 → not_configured。無駄打ちしない", async () => {
    delete process.env[SECRET_ENV];
    stubUpstream({ success: true, cleared_count: 1 });

    expect(await requestCxUnlink(SHOPIFY_CUSTOMER_ID)).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleared_count が無い応答でも 0 件成功として扱う（型崩れで落ちない）", async () => {
    stubUpstream({ success: true });
    expect(await requestCxUnlink(SHOPIFY_CUSTOMER_ID)).toEqual({
      ok: true,
      clearedCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// (e) LINE セッション本人の連携状態（マイページの解除導線 / A 案・2026-08-22）
//
// LINE で入っている人にも「連携済み」と解除ボタンを出すには、顧客 ID を持たないまま
// 連携状態を知る必要がある。逆引きは linked / linkedAt / shopify_customer_id を
// 一度に返すので、**顧客 ID の引き方と状態の引き方で HTTP を 2 回叩かない**。
// ---------------------------------------------------------------------------

describe("fetchLineLinkageStatusForLineUser（LINE セッションの連携状態）", () => {
  it("連携済み → linked=true と連携日を返す", async () => {
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID),
    ).resolves.toEqual({ linked: true, linkedAt: LINKED_AT });
  });

  it("未連携 → linked=false（不明に化けさせない）", async () => {
    stubUpstream({ linked: false, shopify_customer_id: null });

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID),
    ).resolves.toEqual({ linked: false, linkedAt: null });
  });

  it("読めない → 不明（未連携と言い切らない）", async () => {
    stubUpstream({}, false, 500);

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID),
    ).resolves.toEqual(UNKNOWN_LINE_LINKAGE);
  });

  it("連携日が壊れていても連携の有無は落とさない", async () => {
    stubUpstream({
      linked: true,
      linkedAt: 12345,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID),
    ).resolves.toEqual({ linked: true, linkedAt: null });
  });

  it("顧客 ID の引き方と状態の引き方でキャッシュを共有する（往復を増やさない）", async () => {
    const t0 = 5_000_000;
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });

    expect(await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0)).toBe(
      SHOPIFY_CUSTOMER_ID,
    );
    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID, t0 + 1_000),
    ).resolves.toEqual({ linked: true, linkedAt: LINKED_AT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateReverseLinkage（解除直後の見え方）", () => {
  it("捨てたら次の読み取りで台帳を引き直す（解除後に「連携済み」が残らない）", async () => {
    const t0 = 6_000_000;
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    // 解除された。TTL 内でもキャッシュを捨てれば即座に反映される。
    invalidateReverseLinkage(LINE_USER_ID);
    stubUpstream({ linked: false, shopify_customer_id: null });

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID, t0 + 1_000),
    ).resolves.toEqual({ linked: false, linkedAt: null });
  });

  it("他人のキャッシュは捨てない（巻き添えで往復を増やさない）", async () => {
    const t0 = 7_000_000;
    const OTHER_LINE_USER_ID = "Ufedcba9876543210fedcba9876543210";
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(OTHER_LINE_USER_ID, t0);

    invalidateReverseLinkage(LINE_USER_ID);

    expect(
      await fetchShopifyCustomerIdForLineUser(OTHER_LINE_USER_ID, t0 + 1_000),
    ).toBe(SHOPIFY_CUSTOMER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (g) メールセッションからの解除でも逆引きキャッシュが消える（P6 / E1）
//
//     LINE userId が分からないまま解除すると、キャッシュに「連携済み」が最大
//     60 秒残る。その窓の中でこの人が LINE 側から画面を開くと、解除したはずの
//     顧客の棚が見える。cx-agent に生 ID を返させずに窓を閉じられることを固定する。
// ---------------------------------------------------------------------------

describe("invalidateReverseLinkageForCustomer（顧客 ID だけで捨てる）", () => {
  it("その顧客に紐付いていたキャッシュを捨てる（次の読み取りで台帳を引き直す）", async () => {
    const t0 = 8_000_000;
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    // メールセッションから解除。外した LINE userId は分からない。
    invalidateReverseLinkageForCustomer(SHOPIFY_CUSTOMER_ID);
    stubUpstream({ linked: false, shopify_customer_id: null });

    expect(
      await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1_000),
    ).toBe(false);
  });

  it("GID で渡しても数値 ID のキャッシュに当たる（形の違いで取り逃がさない）", async () => {
    const t0 = 8_100_000;
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    invalidateReverseLinkageForCustomer(
      `gid://shopify/Customer/${SHOPIFY_CUSTOMER_ID}`,
    );
    stubUpstream({ linked: false, shopify_customer_id: null });

    expect(
      await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1_000),
    ).toBe(false);
  });

  it("別の顧客のキャッシュは捨てない（巻き添えで往復を増やさない）", async () => {
    const t0 = 8_200_000;
    const OTHER_LINE_USER_ID = "Ufedcba9876543210fedcba9876543210";
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(OTHER_LINE_USER_ID, t0);

    invalidateReverseLinkageForCustomer("999999999999");

    expect(
      await fetchShopifyCustomerIdForLineUser(OTHER_LINE_USER_ID, t0 + 1_000),
    ).toBe(SHOPIFY_CUSTOMER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("空文字では何も捨てない（誤爆でキャッシュを全消ししない）", async () => {
    const t0 = 8_300_000;
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0);

    invalidateReverseLinkageForCustomer("");

    expect(
      await fetchShopifyCustomerIdForLineUser(LINE_USER_ID, t0 + 1_000),
    ).toBe(SHOPIFY_CUSTOMER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (h) ブロック中でも本人解決は顧客の棚のまま（cx-agent P4 の web 側の受け）
//
//     cx-agent が `linked: true, unfollowed: true` を返すようになった。Web 側は
//     「届くかどうか」で棚を選ばない — 選んだら、ブロックしただけの人が空の
//     `line:` 棚に落ちる（お気に入りも行動ログも消えたように見える）。
// ---------------------------------------------------------------------------

describe("resolveIdentity / LINE をブロック中の連携済みユーザー（P4）", () => {
  it("unfollowed=true でも Shopify 顧客の棚に解決する", async () => {
    givenLineSession();
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      unfollowed: true,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });

    const identity = await resolveIdentity();

    expect(identity.authenticated).toBe(true);
    if (!identity.authenticated) return;
    expect(identity.userKey).toBe(SHOPIFY_CUSTOMER_ID);
    expect(identity.provider).toBe("shopify");
  });

  it("マイページの連携状態も「連携済み」のまま（解除と混同しない）", async () => {
    stubUpstream({
      linked: true,
      linkedAt: LINKED_AT,
      unfollowed: true,
      shopify_customer_id: SHOPIFY_CUSTOMER_ID,
    });

    await expect(
      fetchLineLinkageStatusForLineUser(LINE_USER_ID, 8_400_000),
    ).resolves.toEqual({ linked: true, linkedAt: LINKED_AT });
  });
});

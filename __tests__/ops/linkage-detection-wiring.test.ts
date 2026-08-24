/**
 * 連携台帳の読み取り失敗が「出力 → 取得 → 判定」の 3 段を通り抜けることを固定する。
 *
 * ## なぜ別ファイルで、しかもアプリ本体を動かすのか
 *
 * `line-log-monitor.test.ts` は監視の判定を固定するが、入力の文字列は**人が
 * 書き写したもの**。書き写しは書き写しの正しさしか証明しない。アプリ側の
 * console.warn を 1 語変えれば、監視は何も拾わなくなるのに両方のテストは緑のまま
 * 通る。監視が静かに死ぬのはいつもこの形。
 *
 * そこでここでは**本物の `lib/line/linkage-status.ts` /
 * `lib/auth/identity-link.ts` を失敗する状況で走らせ、実際に出た文字列をそのまま
 * 監視に食わせる**。転記が無いので、どちらかの側を触れば必ずここが落ちる。
 *
 * ## 塞いでいる穴 (2026-08-24)
 *
 * 変更前は、下の 5 つの壊れ方が**監視で 1 件も拾えなかった**。連携の読み取りは
 * LINE 系 route ではなく **SSR ページの描画中** (`resolveIdentity` 経由) と
 * `/api/auth/callback` から走るので、`requestPath` が
 * `WATCHED_PATH_PREFIXES` に当たらず、パターンを見る前に落ちていた。
 * cx-agent が落ちれば全員が「連携済みなのに未連携の棚」に倒れる
 * (＝お気に入りが消えたように見える) のに、監視は緑のままだった。
 *
 * ## 3 段のうちここで見ているもの
 *
 *   1. 出力 … アプリが何を書くか            … このテストが実行して捕まえる
 *   2. 取得 … `vercel logs --query line` を通るか … 文字列に "line" を含むか見る
 *   3. 判定 … `matchLogEntry` が拾うか       … 捕まえた文字列を渡して確かめる
 *
 * 2 が要るのは、ログ取得を `--query line` で絞っているため
 * (`scripts/ops/monitor-line-prod.mjs` の LOG_PASSES)。取得段階で落ちる行は、
 * どんなに良いパターンを書いても永遠に届かない。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- module mocks（被テスト module の import より前に置く） -----------------

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
}));
vi.mock("@/lib/shopify/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/shopify/customer", () => ({
  decryptToken: (v: string) => v,
  getCustomer: vi.fn(async () => null),
}));
vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminFirestore: () => ({}) }));
vi.mock("@/lib/auth/identity-merge", () => ({
  mergeLineIdentityIntoShopify: vi.fn(async () => ({})),
}));

import { completeLineLinkage } from "@/lib/auth/identity-link";
import {
  fetchShopifyCustomerIdForLineUser,
  __clearLinkageCacheForTest,
} from "@/lib/line/linkage-status";

import { matchLogEntry } from "../../scripts/ops/lib/line-log-monitor.mjs";

const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const SHOPIFY_CUSTOMER_ID = "900800400001";

/** 実行中に出た console.warn を溜める。 */
let emitted: string[] = [];
let originalWarn: typeof console.warn;

beforeEach(() => {
  emitted = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    emitted.push(args.map((a) => String(a)).join(" "));
  };
  __clearLinkageCacheForTest();
  process.env.SYNC_API_SECRET = "test-sync-secret";
});

afterEach(() => {
  console.warn = originalWarn;
  vi.unstubAllGlobals();
});

/** cx-agent の応答をスタブする。 */
function stubUpstream(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

/**
 * 出た 1 行が「取得」と「判定」の両方を通ることを確かめる。
 *
 * @param requestPath その処理が実際に走っている route。既定は SSR のマイページ
 *   （＝変更前に取りこぼしていた条件そのもの）。
 */
function expectDetected(message: string, requestPath = "/ja/account") {
  // 2) 取得: `vercel logs --query line` に引っかかること。
  expect(message.toLowerCase()).toContain("line");

  // 3) 判定: 監視が拾うこと。
  const finding = matchLogEntry({
    id: "wiring-check",
    timestamp: Date.now(),
    level: "warning",
    message,
    requestPath,
    responseStatusCode: 200,
    environment: "production",
  });

  expect(finding, `監視が拾わなかった: ${message}`).not.toBeNull();
  expect(finding!.id).toBe("linkage-read-failed");
  expect(finding!.severity).toBe("error");
}

describe("逆引きが読めなかったとき、実際に出る行が監視に届く", () => {
  it("cx-agent が非 2xx を返した (鍵のずれ・障害)", async () => {
    stubUpstream({}, false, 401);
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(emitted).toHaveLength(1);
    expectDetected(emitted[0]);
  });

  it("cx-agent に届かなかった (不達 / timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted due to timeout");
      }),
    );
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(emitted).toHaveLength(1);
    expectDetected(emitted[0]);
  });

  it("SYNC_API_SECRET が消えた (デプロイ / 環境の事故)", async () => {
    delete process.env.SYNC_API_SECRET;
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(emitted).toHaveLength(1);
    expectDetected(emitted[0]);
  });

  it("応答が壊れていた (linked=true なのに顧客 ID が無い)", async () => {
    stubUpstream({ linked: true, shopify_customer_id: null });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(emitted).toHaveLength(1);
    expectDetected(emitted[0]);
  });

  it("読めたときは何も出ない (正常時に鳴る監視にしない)", async () => {
    stubUpstream({ linked: true, shopify_customer_id: SHOPIFY_CUSTOMER_ID });
    await fetchShopifyCustomerIdForLineUser(LINE_USER_ID);

    expect(emitted).toEqual([]);
  });
});

describe("台帳が読めず合体を見送ったとき、その行が監視に届く", () => {
  it("メールログイン経路 (source=auth-callback)", async () => {
    stubUpstream({}, false, 503);

    const { outcome } = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      source: "auth-callback",
    });
    expect(outcome).toBe("ledger-unreadable");

    const ledgerLine = emitted.find((m) => m.includes("[identity-link]"));
    expect(ledgerLine, "ledger unreadable の行が出ていない").toBeDefined();

    /* この経路の route は `/api/auth/callback`。LINE 系の接頭辞に当たらないので、
       path 縛りの免除が効いていなければここで落ちる。
       "line" を含むかも見る — `[identity-link]` だけでは `--query line` に
       引っかからず、取得段階で消える。 */
    expectDetected(ledgerLine!, "/api/auth/callback");
  });

  it("連携ボタン経路 (source=line-link-callback)", async () => {
    stubUpstream({}, false, 503);

    await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: SHOPIFY_CUSTOMER_ID,
      source: "line-link-callback",
    });

    const ledgerLine = emitted.find((m) => m.includes("[identity-link]"));
    expectDetected(ledgerLine!, "/api/user/line-link/callback");
  });
});

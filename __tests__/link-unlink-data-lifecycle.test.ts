/**
 * LINE × メール連携の「データの合体・分離」を、状態遷移の一本の筋として固定する。
 *
 * ## なぜ既存テストでは足りないか
 *
 * 既存の 3 本は、それぞれ 1 枚の部品を正しく検証している。
 *   - `identity-merge.test.ts`             … 合体そのもの（消す前に必ず写す）
 *   - `identity-linkage-resolution.test.ts` … どの棚に解決するか（3 値の倒し方）
 *   - `line-unlink-route.test.ts`          … 解除 route の契約（成功偽装をしない）
 *
 * どれも部品単位なので、**部品どうしの繋ぎ目に空く穴**が誰の担当でもない。実際の
 * お客さまが踏むのは繋ぎ目のほうで、「連携したらお気に入りが消えた」「解除したら
 * 全部無くなった」はどれも 1 つの部品のバグではなく、
 *
 *   「台帳の連携（cx-agent の行）」と「Firestore の合体（棚の引っ越し）」が
 *    **別々のトリガーで動き、互いを呼ばない**
 *
 * という構成の帰結として出てくる。本ファイルはそこを撃つ。
 *
 * ## 何をシミュレートするか
 *
 * 本物を 2 つ、偽物を 2 つ組み合わせた統合テスト。
 *   - 本物: `resolveIdentity`（棚の選択）と `mergeLineIdentityIntoShopify`（合体）
 *   - 偽物: Firestore（インメモリ）と cx-agent 連携台帳（インメモリ + fetch スタブ）
 *
 * 台帳の偽物は cx-agent の外形契約だけを真似る（`GET /api/identity/linkage-status`
 * の 2 モードと、`shopify_customer_id` を立てる / null に戻す書き込み）。cx-agent
 * 内部の SQL は本ファイルの対象外。
 *
 * ## 読み方（重要）
 *
 * ここに並ぶ `it` の多くは **望ましい仕様ではなく、現状の挙動**を書き留めている。
 * 名前に `[現状]` が付くものがそれで、期待値の直後にその挙動が誰にどう見えるかを
 * 書いてある。修正が入ったらこの期待値は落ちる — それが狙いで、落ちた時点で
 * 「意図して変えた」と分かるようにするためのピン留めである。挙動を変える PR は
 * このファイルの該当 `it` を書き換えることが、変更の申告そのものになる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

// --- module mocks（被テスト module の import より前に置く） -----------------

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

/** cookie のインメモリ実体。`givenLineSession` / `givenShopifySession` が積む。 */
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
    typeof value === "string" && value.startsWith("enc:") ? value.slice(4) : null,
  getCustomer: vi.fn(async () => null),
}));

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

/** 合体は既定引数で `getAdminFirestore()` を引く。テスト用の偽 Firestore を返す。 */
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => currentDb(),
}));

import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { mergeLineIdentityIntoShopify } from "@/lib/auth/identity-merge";
import {
  __clearLinkageCacheForTest,
  invalidateReverseLinkage,
  LINKAGE_CACHE_TTL_MS,
} from "@/lib/line/linkage-status";
import {
  behaviorLogCol,
  conversationsCol,
  eventRegistrationsCol,
  favoritesCol,
  followsCol,
  ordersCol,
} from "@/lib/firebase/collections";

const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const LINE_KEY = `line:${LINE_USER_ID}`;
const CUSTOMER_A = "900800400001";
const CUSTOMER_B = "900800400002";

// ---------------------------------------------------------------------------
// 偽 Firestore（`identity-merge.test.ts` の作りを踏襲し、任意コレクションを足せる形に）
// ---------------------------------------------------------------------------

type DocData = Record<string, unknown>;

function createFakeFirestore() {
  const store = new Map<string, Map<string, DocData>>();
  let counter = 0;

  const colOf = (path: string) => {
    let col = store.get(path);
    if (!col) {
      col = new Map();
      store.set(path, col);
    }
    return col;
  };

  function makeQuery(path: string, clauses: [string, unknown][], limit: number | null) {
    return {
      where(field: string, _op: string, value: unknown) {
        return makeQuery(path, [...clauses, [field, value] as [string, unknown]], limit);
      },
      limit(n: number) {
        return makeQuery(path, clauses, n);
      },
      async get() {
        let entries = [...colOf(path).entries()];
        for (const [field, value] of clauses) {
          entries = entries.filter(([, data]) => data[field] === value);
        }
        if (limit !== null) entries = entries.slice(0, limit);
        return {
          empty: entries.length === 0,
          docs: entries.map(([id, data]) => ({
            id,
            data: () => ({ ...data }),
            ref: {
              async delete() {
                colOf(path).delete(id);
              },
            },
          })),
        };
      },
      async add(data: DocData) {
        const id = `added-${++counter}`;
        colOf(path).set(id, { ...data });
        return { id };
      },
    };
  }

  const db = {
    collection: (path: string) => makeQuery(path, [], null),
  } as unknown as Firestore;

  return {
    db,
    /** その棚に今いくつ入っているか。中身（PII）ではなく件数で語る。 */
    count: (path: string) => store.get(path)?.size ?? 0,
    /** 棚の中身（テスト内の同定用。実データではない固定文字列のみ）。 */
    contents: (path: string) => [...(store.get(path)?.values() ?? [])],
    /** 「その画面に立ったときに書き込まれるもの」を模す直書き。 */
    seed: (path: string, data: DocData) => {
      colOf(path).set(`seed-${++counter}`, { ...data });
    },
  };
}

let fs: ReturnType<typeof createFakeFirestore>;
const currentDb = () => fs.db;

// ---------------------------------------------------------------------------
// 偽 cx-agent 連携台帳
// ---------------------------------------------------------------------------

/**
 * cx-agent `customer_linkages` の外形だけを真似る。
 *
 * web-app 側が依存している契約は 3 つしかない。
 *   1. `linked: true` は「`shopify_customer_id` が入っていて、かつ生きている行」
 *   2. 解除は `shopify_customer_id` を **null に戻す**（行は消えない）
 *   3. 逆引き（`line_user_id=`）と順引き（`shopify_customer_id=`）が同じ行を見る
 *
 * cx-agent 内部の SQL・カラム構成は本テストの対象外。ここで固定するのは
 * 「web-app がこの応答を受け取ったときに、どの棚を選び、データがどう動くか」だけ。
 */
function createFakeLedger() {
  type Row = {
    shopifyCustomerId: string | null;
    linkedAt: string;
    /** LINE の友だち解除（ブロック）を検知した時刻。立つと配信・連携判定から外れる。 */
    unfollowedAt: string | null;
  };
  /** line_user_id -> 行。1 LINE ユーザ = 1 行（line_user_id は UNIQUE）。 */
  const rows = new Map<string, Row>();
  /** cx-agent が読めない状況（不達・500）を作るためのスイッチ。 */
  let unreachable = false;

  return {
    /**
     * 連携を張る（`POST /api/identity/link-liff` 相当）。
     *
     * upsert の onConflict は `line_user_id` なので、**既に別の顧客と連携していても
     * 比較も警告もなく上書きされる**。ここを忠実に真似ないと D2 / G3 が嘘になる。
     */
    link(lineUserId: string, shopifyCustomerId: string) {
      const existing = rows.get(lineUserId);
      rows.set(lineUserId, {
        shopifyCustomerId,
        linkedAt: "2026-08-22T00:00:00.000Z",
        unfollowedAt: existing?.unfollowedAt ?? null,
      });
    },
    /**
     * 解除（`POST /api/identity/unlink` 相当・`line_user_id` 省略時）。
     *
     * その顧客に紐づく **すべての** LINE 連携を外す。1 顧客に複数 LINE が
     * ぶら下がる構成（世帯共有）が許されているため、件数は 1 とは限らない。
     */
    unlinkByCustomer(shopifyCustomerId: string) {
      let cleared = 0;
      for (const [lineUserId, row] of rows) {
        if (row.shopifyCustomerId === shopifyCustomerId) {
          rows.set(lineUserId, { ...row, shopifyCustomerId: null });
          cleared += 1;
        }
      }
      return cleared;
    },
    /** LINE 公式アカウントをブロックされた（unfollow webhook 相当）。 */
    markUnfollowed(lineUserId: string) {
      const row = rows.get(lineUserId);
      if (row) rows.set(lineUserId, { ...row, unfollowedAt: "2026-08-22T01:00:00.000Z" });
    },
    /** その顧客に今ぶら下がっている生きた連携の数。 */
    liveLinkCount(shopifyCustomerId: string) {
      return [...rows.values()].filter(
        (r) => r.shopifyCustomerId === shopifyCustomerId && !r.unfollowedAt,
      ).length;
    },
    setUnreachable(value: boolean) {
      unreachable = value;
    },
    /** `GET /api/identity/linkage-status` を模した fetch スタブ。 */
    install() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          if (unreachable) throw new Error("cx-agent unreachable");
          const url = new URL(input);
          const byLine = url.searchParams.get("line_user_id");
          const byCustomer = url.searchParams.get("shopify_customer_id");

          /* どちらのモードも `unfollowed_at IS NULL` を必ず条件に入れる
             （cx-agent 側のクエリと同じ）。ブロックされた人は「連携なし」に見える。 */
          const row = byLine
            ? (() => {
                const r = rows.get(byLine);
                return r && !r.unfollowedAt ? r : undefined;
              })()
            : [...rows.values()].find(
                (r) => r.shopifyCustomerId === byCustomer && !r.unfollowedAt,
              );

          const linked = Boolean(row?.shopifyCustomerId);
          return {
            ok: true,
            status: 200,
            json: async () =>
              linked
                ? {
                    linked: true,
                    linkedAt: row!.linkedAt,
                    shopify_customer_id: row!.shopifyCustomerId,
                  }
                : { linked: false, linkedAt: null },
          };
        }),
      );
    },
  };
}

let ledger: ReturnType<typeof createFakeLedger>;

// ---------------------------------------------------------------------------
// 模擬セッション
// ---------------------------------------------------------------------------

/** LINE だけでログインしている状態。 */
function givenLineSession() {
  getSessionMock.mockResolvedValue(null);
  cookieStore.clear();
  cookieStore.set("line_session", "1");
  cookieStore.set("line_uid", `enc:${LINE_USER_ID}`);
}

/** メールアドレス（Shopify）でログインしている状態。 */
function givenShopifySession(customerId: string) {
  getSessionMock.mockResolvedValue({ accessToken: "at" });
  cookieStore.clear();
  cookieStore.set("shop_cid", `enc:${customerId}`);
}

/**
 * 「今このセッションが読み書きする棚」。
 *
 * 画面・API route はどれも `resolveIdentity().userKey` を通して棚を選ぶので、
 * ここが本テストにおける「お客さまに見えているマイページ」の同義語になる。
 */
async function currentShelf(): Promise<string> {
  const identity = await resolveIdentity();
  if (!identity.authenticated) throw new Error("not authenticated");
  return identity.userKey;
}

/** そのセッションから見えるお気に入りの件数（＝マイページに並ぶ数）。 */
async function visibleFavorites(): Promise<number> {
  return fs.count(favoritesCol(await currentShelf()));
}

const A_FAVORITE = { type: "product", targetId: "gid://shopify/Product/1" };
const ANOTHER_FAVORITE = { type: "product", targetId: "gid://shopify/Product/2" };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  __clearLinkageCacheForTest();
  process.env.SYNC_API_SECRET = "test-sync-secret";
  fs = createFakeFirestore();
  ledger = createFakeLedger();
  ledger.install();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  warnSpy.mockRestore();
});

// ===========================================================================
// A. 状態ごとに、どの棚を読むか
// ===========================================================================

describe("A. 状態 → 棚（userKey）", () => {
  it("A1: 未連携のメールセッションは自分の顧客番号の棚", async () => {
    givenShopifySession(CUSTOMER_A);
    expect(await currentShelf()).toBe(CUSTOMER_A);
  });

  it("A2: 未連携の LINE セッションは line: の棚", async () => {
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
  });

  it("A3: 連携済みでも、メールセッションの棚は変わらない", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenShopifySession(CUSTOMER_A);
    expect(await currentShelf()).toBe(CUSTOMER_A);
  });

  it("A4: 連携済みの LINE セッションはメール側と同じ棚に解決する（分裂しない）", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);
  });

  it("A5: 解除後のメールセッションの棚も変わらない", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.unlinkByCustomer(CUSTOMER_A);
    givenShopifySession(CUSTOMER_A);
    expect(await currentShelf()).toBe(CUSTOMER_A);
  });

  it("A6: 解除後の LINE セッションは line: の棚に戻る", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.unlinkByCustomer(CUSTOMER_A);
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
  });

  it("A7: 台帳が読めないときは顧客 ID を推測せず line: の棚に倒す", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.setUnreachable(true);
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
  });
});

// ===========================================================================
// B. 連携したとき、line: 棚のデータはどうなるか
// ===========================================================================

describe("B. 連携時のデータの行方", () => {
  it("B1: メールでログインし直す経路なら、お気に入り・フォロー・イベントは顧客の棚へ移る", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    fs.seed(followsCol(LINE_KEY), { farmerSlug: "yamada-farm" });
    fs.seed(eventRegistrationsCol(LINE_KEY), { eventSlug: "marche-2026-08" });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);

    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(followsCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(eventRegistrationsCol(CUSTOMER_A))).toBe(1);
    // 元の棚は空になる（引っ越しであって複製ではない）。
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
  });

  it("B2 [現状]: 行動ログ・会話履歴・注文は合体の対象外で line: 棚に取り残される", async () => {
    fs.seed(behaviorLogCol(LINE_KEY), { event: "view", targetId: "p1" });
    fs.seed(conversationsCol(LINE_KEY), { role: "user" });
    fs.seed(ordersCol(LINE_KEY), { orderId: "1001" });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);

    /* 合体が触るのは favorites / follows / eventRegistrations の 3 つだけ
       （lib/auth/identity-merge.ts）。残り 3 つは line: 棚に残る。連携後は
       LINE セッションも顧客の棚に解決するので、この 3 つは **どのログイン手段
       からも読めない**状態になる。 */
    expect(fs.count(behaviorLogCol(LINE_KEY))).toBe(1);
    expect(fs.count(conversationsCol(LINE_KEY))).toBe(1);
    expect(fs.count(ordersCol(LINE_KEY))).toBe(1);
    expect(fs.count(behaviorLogCol(CUSTOMER_A))).toBe(0);
    expect(fs.count(conversationsCol(CUSTOMER_A))).toBe(0);
    expect(fs.count(ordersCol(CUSTOMER_A))).toBe(0);
  });

  it("B3 [現状]: マイページの「LINE 連携」ボタン経由では合体が起きず、お気に入りが消えたように見える", async () => {
    // LINE だけで使っていた頃に貯めたお気に入り。
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);

    /* Web 連携導線（/api/user/line-link/init → LINE 認可 → /callback）は、
       cx-agent に台帳の行を作るだけで `mergeLineIdentityIntoShopify` を呼ばない
       （app/api/user/line-link/callback/route.ts に merge の呼び出しが無い）。 */
    ledger.link(LINE_USER_ID, CUSTOMER_A);

    // メールセッション: 顧客の棚。合体していないので 0 件。
    givenShopifySession(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(0);

    // LINE セッション: 連携済みなので同じく顧客の棚に解決する。やはり 0 件。
    __clearLinkageCacheForTest();
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(0);

    // データ自体は残っているが、どちらのセッションからも到達できない。
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);
  });

  it("B4 [現状]: 合体しても台帳の連携は張られないので、次に LINE だけで入ると空の棚に戻る", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);

    /* Shopify OAuth の帰り道で合体だけが走る
       （app/api/auth/callback/route.ts:208）。台帳には何も書かない。 */
    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);

    givenShopifySession(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);

    // 後日 LINE だけでログインし直すと、台帳に連携が無いので line: の棚。
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(0);
  });

  it("B5 [現状]: 合体は台帳の同意を見ず、cookie が同居しているだけで発火する", async () => {
    /* auth callback は「line_uid cookie がある」だけを条件に合体する。台帳に
       その LINE と顧客 A の連携があるかは見ない。共用端末で前の人の LINE
       セッションが残っていると、その人のお気に入りが次の人の棚へ移る。 */
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);

    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_B);

    expect(fs.count(favoritesCol(CUSTOMER_B))).toBe(1);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
  });
});

// ===========================================================================
// C. 解除したとき、データはどちらに残るか
// ===========================================================================

describe("C. 解除時のデータの行方", () => {
  it("C1: 連携中に増えたデータは顧客の棚に残り、メールセッションからは解除後も見える", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    // 連携中に LINE から追加 → 顧客の棚に書かれる。
    expect(await currentShelf()).toBe(CUSTOMER_A);
    fs.seed(favoritesCol(await currentShelf()), A_FAVORITE);

    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();

    givenShopifySession(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);
  });

  it("C2 [現状]: 解除すると LINE 側は空になる（分離＝按分ではなく、全部メール側に残る）", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    fs.seed(favoritesCol(await currentShelf()), A_FAVORITE);

    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();

    /* 解除に「按分」も「複製」も無い。連携中に LINE から入れたお気に入りも
       顧客の棚に残るため、LINE セッションからは 0 件になる。 */
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(0);
  });

  it("C3 [現状]: 合体で空になった line: 棚は、解除しても復活しない", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();

    givenLineSession();
    expect(await visibleFavorites()).toBe(0);
  });

  it("C4: 合体されずに取り残されていたデータは、解除後にまた見えるようになる", async () => {
    /* B3 の経路（合体なしの連携）で置き去りになったデータは line: 棚にあるので、
       解除で棚が戻ると再び見える。救済ではあるが、連携中は消えて見えていた。 */
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    expect(await visibleFavorites()).toBe(0);

    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await visibleFavorites()).toBe(1);
  });
});

// ===========================================================================
// D. 再連携
// ===========================================================================

describe("D. 再連携", () => {
  it("D1: 同じメールアドレスに再連携すると、預けていたデータがそのまま戻る", async () => {
    fs.seed(favoritesCol(CUSTOMER_A), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();

    givenLineSession();
    expect(await visibleFavorites()).toBe(0);

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await visibleFavorites()).toBe(1);
  });

  it("D2 [現状]: 別のメールアドレスに再連携すると、LINE から見える中身がまるごと入れ替わる", async () => {
    fs.seed(favoritesCol(CUSTOMER_A), A_FAVORITE);
    fs.seed(favoritesCol(CUSTOMER_B), ANOTHER_FAVORITE);
    fs.seed(favoritesCol(CUSTOMER_B), { type: "product", targetId: "gid://shopify/Product/3" });

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    expect(await visibleFavorites()).toBe(1);

    ledger.unlinkByCustomer(CUSTOMER_A);
    ledger.link(LINE_USER_ID, CUSTOMER_B);
    __clearLinkageCacheForTest();

    // 旧アカウントのデータは旧アカウントに残り、LINE 側には一切引き継がれない。
    expect(await visibleFavorites()).toBe(2);
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
  });

  it("D3 [現状]: 両方の棚に中身があるとき、再連携は合体させず顧客の棚だけを見せる", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    fs.seed(favoritesCol(CUSTOMER_A), ANOTHER_FAVORITE);

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();

    /* 合体が走らないので合計 2 件にはならない。line: 側の 1 件は見えないまま
       置き去りになる（B3 と同じ根で、再連携でも解消しない）。 */
    expect(await visibleFavorites()).toBe(1);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);
  });
});

// ===========================================================================
// E. キャッシュ 60 秒の窓
// ===========================================================================

describe("E. 逆引きキャッシュ（最大 60 秒）の窓", () => {
  it("E1 [現状]: メールセッションから解除しても、LINE セッションは最大 60 秒 顧客の棚を読み書きし続ける", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A); // ここでキャッシュに載る

    /* 解除の Shopify セッション経路（app/api/user/line-link/route.ts:117）は
       `invalidateReverseLinkage` を呼ばない（呼ぶのは LINE セッション経路
       だけ・同 155 行）。台帳は外れているのにキャッシュは残る。 */
    ledger.unlinkByCustomer(CUSTOMER_A);

    vi.advanceTimersByTime(LINKAGE_CACHE_TTL_MS - 1);
    expect(await currentShelf()).toBe(CUSTOMER_A);

    // この窓の中で書いたものは、解除済みなのに顧客の棚に入る。
    fs.seed(favoritesCol(await currentShelf()), A_FAVORITE);

    vi.advanceTimersByTime(2);
    expect(await currentShelf()).toBe(LINE_KEY);
    // 窓の中で書いた 1 件は LINE 側からは見えないまま。
    expect(await visibleFavorites()).toBe(0);
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
  });

  it("E2: LINE セッションから解除した場合はキャッシュが捨てられ、次の読み取りで即座に戻る", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);

    ledger.unlinkByCustomer(CUSTOMER_A);
    invalidateReverseLinkage(LINE_USER_ID); // route が成功時に呼ぶもの

    expect(await currentShelf()).toBe(LINE_KEY);
  });

  it("E3 [現状]: 連携した直後も最大 60 秒は line: 棚に書き続け、その分は永久に取り残される", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));

    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY); // 「未連携」がキャッシュに載る

    /* 連携成立。どの連携経路も逆引きキャッシュを捨てない
       （invalidateReverseLinkage の呼び出しは解除経路にしか無い）。 */
    ledger.link(LINE_USER_ID, CUSTOMER_A);

    vi.advanceTimersByTime(LINKAGE_CACHE_TTL_MS - 1);
    expect(await currentShelf()).toBe(LINE_KEY);
    fs.seed(favoritesCol(await currentShelf()), A_FAVORITE); // line: 棚に着地

    vi.advanceTimersByTime(2);
    expect(await currentShelf()).toBe(CUSTOMER_A);

    /* 合体は連携の瞬間にしか走らない（しかも Web 連携経路では走らない）ので、
       窓の中で書かれたこの 1 件を後から拾う経路は存在しない。 */
    expect(await visibleFavorites()).toBe(0);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);
  });

  it("E4: 台帳が読めなかったときはキャッシュに載せない（復旧が遅れない）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.setUnreachable(true);
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);

    ledger.setUnreachable(false);
    // TTL を待たずに正しい棚へ戻る。
    vi.advanceTimersByTime(1);
    expect(await currentShelf()).toBe(CUSTOMER_A);
  });
});

// ===========================================================================
// F. 往復（連携 → 解除 → 再連携）を通しで
// ===========================================================================

describe("F. 往復シナリオ", () => {
  it("F1 [現状]: LINE で貯める → 連携 → 解除 → 再連携 を一周すると、最初の分だけが失われる", async () => {
    // 1) LINE だけで使っていた頃
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    expect(await visibleFavorites()).toBe(1);

    // 2) マイページから連携（Web 導線＝合体なし）
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(0); // ここで「消えた」ように見える

    // 3) 連携中に新しく追加
    fs.seed(favoritesCol(CUSTOMER_A), ANOTHER_FAVORITE);
    expect(await visibleFavorites()).toBe(1);

    // 4) 解除
    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(1); // 1) の分がここで戻る

    // 5) 再連携
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await visibleFavorites()).toBe(1); // 3) の分だけが見える

    // 通算 2 件あるのに、どの状態でも同時に 2 件は見えない。
    expect(fs.count(favoritesCol(LINE_KEY)) + fs.count(favoritesCol(CUSTOMER_A))).toBe(2);
  });

  it("F2: 合体は何度繰り返しても増殖しない（同じ内容を二重に作らない）", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE); // 同じものがまた現れた場合
    await mergeLineIdentityIntoShopify(LINE_USER_ID, CUSTOMER_A);

    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
  });
});

// ===========================================================================
// G. 解除ボタン以外で連携が切れる / 付け替わる経路
// ===========================================================================

describe("G. 解除操作以外で棚が動く経路", () => {
  it("G1 [現状]: LINE 公式アカウントをブロックすると、解除していないのに棚が line: に戻る", async () => {
    /* 連携判定のクエリは両モードとも `unfollowed_at IS NULL` を条件に持つ。
       ブロック検知でその列が立つと、行は `shopify_customer_id` を保持したまま
       「連携なし」として扱われる。しかも列を戻す経路はどこにも無い。 */
    fs.seed(favoritesCol(CUSTOMER_A), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);

    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);

    ledger.markUnfollowed(LINE_USER_ID);
    __clearLinkageCacheForTest();

    // ブロックを解除して友だちに戻しても、この判定は元に戻らない。
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(0);
  });

  it("G2 [現状]: 1 つのメールアドレスに 2 つの LINE がぶら下がるとき、片方の解除で両方が外れる", async () => {
    const OTHER_LINE_USER_ID = "Ufedcba9876543210fedcba9876543210";
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.link(OTHER_LINE_USER_ID, CUSTOMER_A);
    expect(ledger.liveLinkCount(CUSTOMER_A)).toBe(2);

    /* マイページの解除は `line_user_id` を送らないので、cx-agent は
       その顧客の連携を全部外す。もう一方の人には何の通知も無い。 */
    expect(ledger.unlinkByCustomer(CUSTOMER_A)).toBe(2);
    expect(ledger.liveLinkCount(CUSTOMER_A)).toBe(0);

    __clearLinkageCacheForTest();
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
  });

  it("G3 [現状]: 同じ LINE を別のメールアドレスに連携し直すと、前の連携が黙って消える", async () => {
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    expect(ledger.liveLinkCount(CUSTOMER_A)).toBe(1);

    /* upsert の衝突キーは line_user_id ひとつ。既存の連携先と比較せず上書きする
       ので、顧客 A 側は解除操作をしていないのに未連携になる。 */
    ledger.link(LINE_USER_ID, CUSTOMER_B);

    expect(ledger.liveLinkCount(CUSTOMER_A)).toBe(0);
    expect(ledger.liveLinkCount(CUSTOMER_B)).toBe(1);

    __clearLinkageCacheForTest();
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_B);
  });
});

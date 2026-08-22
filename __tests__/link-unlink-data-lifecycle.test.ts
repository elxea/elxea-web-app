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
  userDoc,
} from "@/lib/firebase/collections";
import { completeLineLinkage } from "@/lib/auth/identity-link";
import { createFakeFirestore } from "./helpers/fake-firestore";

const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const LINE_KEY = `line:${LINE_USER_ID}`;
const CUSTOMER_A = "900800400001";
const CUSTOMER_B = "900800400002";

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
  /** 実際の連携経路（連携ボタン / LIFF / メールログイン）が通る 1 か所。 */
  const linkAndMerge = (customerId: string) =>
    completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: customerId,
      source: "line-link-callback",
    });

  it("B1: 連携が成立すると、お気に入り・フォロー・イベントは顧客の棚へ移る", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    fs.seed(followsCol(LINE_KEY), { farmerSlug: "yamada-farm" });
    fs.seed(eventRegistrationsCol(LINE_KEY), { eventSlug: "marche-2026-08" });

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    const { outcome } = await linkAndMerge(CUSTOMER_A);

    expect(outcome).toBe("merged");
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(followsCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(eventRegistrationsCol(CUSTOMER_A))).toBe(1);
    // 元の棚は空になる（引っ越しであって複製ではない）。
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
  });

  it("B2: 行動ログ・会話履歴・注文も一緒に運ばれる（置き去りにしない）", async () => {
    /* かつて合体は favorites / follows / eventRegistrations の 3 つしか触らず、
       あとから `COLLECTIONS` に足された行動ログ・会話履歴・注文ミラーは
       `line:` 棚に取り残されていた。連携後は LINE セッションも顧客の棚に解決する
       ので、その 3 つは **どのログイン手段からも読めない**場所に消えていた。
       いまは運ぶ荷物を `USER_SUBCOLLECTIONS` から導出するので、同じ落とし方は
       できない（足して strategy を書かなければ型エラーになる）。 */
    fs.seed(behaviorLogCol(LINE_KEY), { action: "view_content", channel: "line" });
    fs.seed(conversationsCol(LINE_KEY), { role: "user", content: "こんにちは" });
    fs.seed(ordersCol(LINE_KEY), { orderNumber: "1001" });

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await linkAndMerge(CUSTOMER_A);

    expect(fs.count(behaviorLogCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(conversationsCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(ordersCol(CUSTOMER_A))).toBe(1);
    expect(fs.count(behaviorLogCol(LINE_KEY))).toBe(0);
    expect(fs.count(conversationsCol(LINE_KEY))).toBe(0);
    expect(fs.count(ordersCol(LINE_KEY))).toBe(0);
  });

  it("B2b: ログ系はドキュメント ID を保って運ぶ（同じ内容の 2 件目を消さない）", async () => {
    /* 行動ログは追記オンリーで、同じ内容の 2 件目が正当に存在する（同じ記事を
       もう一度読んだ）。内容で重複判定するとその 2 件目が「重複」として消える
       ので、ID を保って運ぶ。ID を保つこと自体が再実行の冪等性にもなる。 */
    const sameEvent = { action: "view_content", channel: "line", contentId: "a1" };
    fs.seed(behaviorLogCol(LINE_KEY), sameEvent, "evt-1");
    fs.seed(behaviorLogCol(LINE_KEY), sameEvent, "evt-2");

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await linkAndMerge(CUSTOMER_A);

    expect(fs.count(behaviorLogCol(CUSTOMER_A))).toBe(2);
    expect(fs.ids(behaviorLogCol(CUSTOMER_A)).sort()).toEqual(["evt-1", "evt-2"]);
  });

  it("B2c: 注文が両方の棚にあるとき、顧客の棚の中身を LINE 側で上書きしない", async () => {
    /* 注文ミラーはドキュメント ID が注文 ID。同じ ID が両側にあるのは再実行の
       痕跡でしかなく、そこで LINE 側を書き戻すと、前回の実行後に顧客の棚で
       更新された内容を巻き戻すことになる。衝突は常に既存（顧客の棚）優先。 */
    fs.seed(ordersCol(LINE_KEY), { orderNumber: "1001", stale: true }, "order-1001");
    fs.seed(ordersCol(CUSTOMER_A), { orderNumber: "1001", stale: false }, "order-1001");

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await linkAndMerge(CUSTOMER_A);

    expect(fs.contents(ordersCol(CUSTOMER_A))).toEqual([
      { orderNumber: "1001", stale: false },
    ]);
    expect(fs.count(ordersCol(LINE_KEY))).toBe(0);
  });

  it("B2d: ユーザードキュメント本体も畳む。欠けているフィールドだけを足す", async () => {
    /* ペルソナ・嗜好プロファイルは両側で育つ。顧客の棚のほうが本命の記録なので、
       LINE 側の値で塗り替えず、**引っ越し先に無いフィールドだけ**を足す。 */
    fs.seed(
      "users",
      { persona: "line-side", tasteProfile: "only-on-line" },
      LINE_KEY,
    );
    fs.seed("users", { persona: "customer-side" }, CUSTOMER_A);

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await linkAndMerge(CUSTOMER_A);

    const merged = fs.docData(userDoc(CUSTOMER_A)) as Record<string, unknown>;
    expect(merged.persona).toBe("customer-side"); // 既存が勝つ
    expect(merged.tasteProfile).toBe("only-on-line"); // 欠けていた分だけ足される
    /* 合体と同じ流れで LINE の写しも置かれる（P9・2026-08-22）。これが無いと
       解除の応答が写しだけを見て「連携していませんでした」と嘘をつく。 */
    expect(merged.lineUserId).toBe(LINE_USER_ID);
    expect(fs.docData(userDoc(LINE_KEY))).toBeUndefined();
  });

  it("B3: マイページの「LINE 連携」ボタン経由でも合体が起き、お気に入りは消えない", async () => {
    // LINE だけで使っていた頃に貯めたお気に入り。
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);

    /* Web 連携導線（/api/user/line-link/init → LINE 認可 → /callback）は、
       かつて cx-agent に台帳の行を作るだけで合体を呼ばなかった。連携した瞬間に
       解決先の棚だけが変わり、中身は置き去りになるので「連携したらお気に入りが
       消えた」に見えていた。いまは同じ route が台帳成立と合体を対で行う。 */
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await linkAndMerge(CUSTOMER_A);

    // メールセッション: 顧客の棚。合体済みなので見える。
    givenShopifySession(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);

    // LINE セッション: 連携済みなので同じ棚に解決する。同じものが見える。
    __clearLinkageCacheForTest();
    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);

    // 到達できない場所に残っているデータは無い。
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
  });

  it("B4: 台帳に連携が無ければ合体しない（「合体したのに未連携」を作れない）", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);

    /* かつてメールログインの帰り道は `line_uid` cookie の存在だけで合体し、
       台帳には何も書かなかった。その結果「データは顧客の棚に移ったのに台帳は
       未連携」という状態が作れ、次に LINE だけで入ると空の棚に戻った。
       いまは合体が台帳の成立を前提にするので、この状態はどの経路からも作れない。 */
    const { outcome } = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "auth-callback",
    });

    expect(outcome).toBe("not-linked");
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(0);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);

    // 後日 LINE だけでログインしても、自分の棚に自分の中身がある。
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(1);
  });

  it("B5: cookie が同居しているだけでは合体しない（共用端末で持ち去られない）", async () => {
    /* 共用端末に前の人の LINE セッションが残ったまま次の人がメールでログインする
       と、以前はその人のお気に入りが次の人の棚へ移っていた。合体は cookie の
       同居ではなく台帳の本人一致で発火する。 */
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A); // この LINE の持ち主は顧客 A

    const { outcome } = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_B, // ログインしたのは別人
      source: "auth-callback",
    });

    expect(outcome).toBe("linked-elsewhere");
    expect(fs.count(favoritesCol(CUSTOMER_B))).toBe(0);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);
  });

  it("B6: 台帳が読めないときは合体しない（推測で棚を動かさない）", async () => {
    /* 合体は元を消す操作なので、間違えたときに戻せない。読めないときに
       「たぶん連携済み」へ倒す価値は無い。次の機会に再試行すればよい。 */
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    ledger.setUnreachable(true);

    const { outcome } = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "auth-callback",
    });

    expect(outcome).toBe("ledger-unreadable");
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(1);
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(0);

    // 台帳が戻れば、次のログインで拾われる（取りこぼしの再試行）。
    ledger.setUnreachable(false);
    __clearLinkageCacheForTest();
    const retry = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "auth-callback",
    });
    expect(retry.outcome).toBe("merged");
    expect(fs.count(favoritesCol(CUSTOMER_A))).toBe(1);
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
    /* 連携時に運んだものは顧客の棚のものになる。解除は「連携が無い状態にする」
       操作であって、引っ越しの巻き戻しではない（C2 と同じ規則）。 */
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "line-link-callback",
    });
    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();

    givenLineSession();
    expect(await visibleFavorites()).toBe(0);
  });

  it("C4: 合体しきれず取り残されたデータは、解除後にまた見えるようになる", async () => {
    /* 合体は「引っ越し先で読み戻せたものだけ元を消す」ので、必須フィールドが
       欠けた壊れたドキュメントは line: 棚に残る（消してしまうより残すほうが安全）。
       それは解除で棚が戻ると再び見える。

       本番にはこの形の置き去りが既に存在する（本 PR より前の、連携時に合体が
       走らなかった時期の分）。**その救済移行は本 PR の対象外**で、コード側の
       規則としてここで固定するのは「取り残しは消えていない」ことだけ。 */
    const BROKEN_FAVORITE = { type: "product" }; // targetId が無い = 運べない
    fs.seed(favoritesCol(LINE_KEY), BROKEN_FAVORITE);
    ledger.link(LINE_USER_ID, CUSTOMER_A);

    const { merge } = await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "line-link-callback",
    });
    expect(merge?.retained).toBe(1);

    givenLineSession();
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(0); // 連携中は見えない

    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await visibleFavorites()).toBe(1); // 消えてはいない
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

  it("D3: 両方の棚に中身があるとき、再連携で合流して両方見える", async () => {
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    fs.seed(favoritesCol(CUSTOMER_A), ANOTHER_FAVORITE);

    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "line-link-callback",
    });
    givenLineSession();

    // 合体が走るので合計 2 件。line: 側に置き去りは残らない。
    expect(await visibleFavorites()).toBe(2);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
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

  it("E3: 連携が成立した瞬間からキャッシュは捨てられ、次の読み取りで顧客の棚になる", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));

    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY); // 「未連携」がキャッシュに載る

    /* かつては、どの連携経路も逆引きキャッシュを捨てなかった
       （`invalidateReverseLinkage` の呼び出しは解除経路にしか無かった）。
       そのため連携後も最大 60 秒は `line:` 棚に書き続け、しかも合体は連携の
       瞬間にしか走らないので、その窓の中で書かれた分を後から拾う経路が無かった。
       いまは連携成立の経路が必ずキャッシュを捨てる。 */
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await completeLineLinkage({
      lineUserId: LINE_USER_ID,
      shopifyCustomerId: CUSTOMER_A,
      source: "line-link-callback",
    });

    // TTL を待たずに、直後の読み取りが顧客の棚を返す（窓が開かない）。
    expect(await currentShelf()).toBe(CUSTOMER_A);
    fs.seed(favoritesCol(await currentShelf()), A_FAVORITE);

    vi.advanceTimersByTime(LINKAGE_CACHE_TTL_MS + 1);
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1);
    expect(fs.count(favoritesCol(LINE_KEY))).toBe(0);
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
  it("F1: LINE で貯める → 連携 → 解除 → 再連携 を一周しても、何も失われない", async () => {
    const link = (customerId: string) =>
      completeLineLinkage({
        lineUserId: LINE_USER_ID,
        shopifyCustomerId: customerId,
        source: "line-link-callback",
      });

    // 1) LINE だけで使っていた頃
    givenLineSession();
    expect(await currentShelf()).toBe(LINE_KEY);
    fs.seed(favoritesCol(LINE_KEY), A_FAVORITE);
    expect(await visibleFavorites()).toBe(1);

    // 2) マイページから連携。台帳成立と合体が対で走る
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await link(CUSTOMER_A);
    expect(await currentShelf()).toBe(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(1); // 消えたように見えない

    // 3) 連携中に新しく追加
    fs.seed(favoritesCol(CUSTOMER_A), ANOTHER_FAVORITE);
    expect(await visibleFavorites()).toBe(2);

    // 4) 解除。連携中に貯めた分は顧客の棚に残る（C2 の規則）
    ledger.unlinkByCustomer(CUSTOMER_A);
    __clearLinkageCacheForTest();
    expect(await currentShelf()).toBe(LINE_KEY);
    expect(await visibleFavorites()).toBe(0);

    // 5) 再連携すると、通算 2 件がまとめて戻る
    ledger.link(LINE_USER_ID, CUSTOMER_A);
    await link(CUSTOMER_A);
    expect(await visibleFavorites()).toBe(2);

    // 通算 2 件が、どの状態でも 1 か所にまとまっている。
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

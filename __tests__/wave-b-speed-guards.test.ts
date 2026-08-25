/**
 * 体感速度改修 (W-B) が壊れたときに落ちる回帰テスト。
 *
 * 速度改修は「見た目が変わらないのに、動きの順番と鍵の作り方だけが変わる」種類の
 * 変更なので、壊れても画面には出にくい。QA が挙げた 3 つの壊し方を、それぞれ
 * 1 件以上のテストが直接捕まえるように置いてある (2026-08-26 QA ループ 2/5)。
 *
 *   (a) マイページの入口判定から LINE セッションを外す
 *   (b) 履歴の作り置きの鍵から「ログイン状態 / 誰の履歴か」を外す
 *   (c) ジャーナルの「実在しないカテゴリは絞り込みなしに倒す」を壊す
 *
 * どのテストも「変異を入れると実際に落ちるか」を手で確認してから入れている。
 */
import { describe, expect, it, beforeEach } from "vitest";

import { canRenderAccountShell } from "@/lib/account-capabilities";
import {
  HISTORY_CACHE_PREFIX,
  clearAllHistoryCache,
  fingerprintIdentity,
  historyCacheKey,
  isSignedInFromCookie,
  readCachedHistory,
  writeCachedHistory,
} from "@/lib/chat/history-cache";
import {
  canUseSpeculativeBundle,
  resolveActiveCategory,
} from "@/lib/journal/active-category";

/* -------------------------------------------------------------------------- */
/* (a) マイページの入口判定                                                     */
/* -------------------------------------------------------------------------- */

describe("マイページの骨格を出してよいかの判定", () => {
  /**
   * これが本命。`hasLineSession` を条件から外すと、この 1 件が落ちる。
   *
   * LINE だけでログインしている人は `shop_at` / `shop_rt` を構造上持たないので、
   * Shopify の cookie だけで判定すると middleware は通すのに画面だけ
   * 「ログインが必要です」に落ちる。
   */
  it("LINE だけでログインしている人にも骨格を出す", () => {
    expect(
      canRenderAccountShell({
        hasShopifySession: false,
        hasLineSession: true,
        previewSeed: false,
      }),
    ).toBe(true);
  });

  it("メールでログインしている人にも骨格を出す", () => {
    expect(
      canRenderAccountShell({
        hasShopifySession: true,
        hasLineSession: false,
        previewSeed: false,
      }),
    ).toBe(true);
  });

  it("どの経路でも入っていなければ骨格を出さない", () => {
    expect(
      canRenderAccountShell({
        hasShopifySession: false,
        hasLineSession: false,
        previewSeed: false,
      }),
    ).toBe(false);
  });

  it("計測用の見本表示は cookie が無くても骨格を出す", () => {
    expect(
      canRenderAccountShell({
        hasShopifySession: false,
        hasLineSession: false,
        previewSeed: true,
      }),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* (b) 履歴の作り置きの鍵                                                       */
/* -------------------------------------------------------------------------- */

describe("チャット履歴の作り置きの鍵", () => {
  const base = { sessionId: "s-1", signedIn: true, customerId: "gid://shopify/Customer/1" };

  /**
   * 共用端末の取り違えを直接捕まえる本命 (QA 指摘 2026-08-26)。
   * 鍵から顧客の指紋を外すと、この 1 件が落ちる。
   */
  it("同じ会話 ID・同じログイン状態でも、人が違えば鍵が違う", () => {
    const a = historyCacheKey({ ...base, customerId: "gid://shopify/Customer/AAA" });
    const b = historyCacheKey({ ...base, customerId: "gid://shopify/Customer/BBB" });
    expect(a).not.toBe(b);
  });

  /** 鍵からログイン状態を外すと、この 1 件が落ちる。 */
  it("同じ会話 ID でも、ログイン前後で鍵が違う", () => {
    const anon = historyCacheKey({ sessionId: "s-1", signedIn: false, customerId: null });
    const auth = historyCacheKey({ sessionId: "s-1", signedIn: true, customerId: null });
    expect(anon).not.toBe(auth);
  });

  it("会話 ID が違えば鍵が違う", () => {
    expect(historyCacheKey({ ...base, sessionId: "s-1" })).not.toBe(
      historyCacheKey({ ...base, sessionId: "s-2" }),
    );
  });

  it("同じ人・同じ会話なら鍵は安定している", () => {
    expect(historyCacheKey(base)).toBe(historyCacheKey({ ...base }));
  });

  it("顧客 ID を鍵にそのまま書かない (指紋にする)", () => {
    const key = historyCacheKey(base);
    expect(key).not.toContain("gid://shopify/Customer/1");
    expect(key).toContain(fingerprintIdentity(base.customerId));
  });

  it("鍵は全消しできるよう共通の接頭辞を持つ", () => {
    expect(historyCacheKey(base).startsWith(HISTORY_CACHE_PREFIX)).toBe(true);
  });
});

describe("ログイン状態の cookie 判定", () => {
  it("shop_auth=1 があれば真", () => {
    expect(isSignedInFromCookie("a=b; shop_auth=1; c=d")).toBe(true);
  });

  it("cookie が無ければ偽", () => {
    expect(isSignedInFromCookie("")).toBe(false);
    expect(isSignedInFromCookie(undefined)).toBe(false);
  });

  /** 部分一致 (`includes`) に戻すと、この 2 件が落ちる。 */
  it("名前が違う cookie を取り違えない", () => {
    expect(isSignedInFromCookie("xshop_auth=1")).toBe(false);
  });

  it("値が違う cookie を取り違えない", () => {
    expect(isSignedInFromCookie("shop_auth=10")).toBe(false);
    expect(isSignedInFromCookie("shop_auth=0")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 作り置きの読み書きと全消し                                                    */
/* -------------------------------------------------------------------------- */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe("作り置きの読み書き", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  const alice = { sessionId: "s-1", signedIn: true, customerId: "A" };
  const bob = { sessionId: "s-1", signedIn: true, customerId: "B" };

  it("書いた本人は読める", () => {
    writeCachedHistory(storage, alice, { messages: ["a"] });
    expect(readCachedHistory(storage, alice)).toEqual({ messages: ["a"] });
  });

  /** 共用端末の取り違えを、鍵ではなく振る舞いの側から押さえる。 */
  it("別人は同じ会話 ID でも読めない", () => {
    writeCachedHistory(storage, alice, { messages: ["a"] });
    expect(readCachedHistory(storage, bob)).toBeNull();
  });

  it("期限を過ぎたものは読まない", () => {
    const t0 = 1_000_000;
    writeCachedHistory(storage, alice, { messages: ["a"] }, t0);
    expect(readCachedHistory(storage, alice, t0 + 4 * 60 * 1000)).not.toBeNull();
    expect(readCachedHistory(storage, alice, t0 + 6 * 60 * 1000)).toBeNull();
  });

  it("壊れた中身は読まない", () => {
    storage.setItem(historyCacheKey(alice), "{ not json");
    expect(readCachedHistory(storage, alice)).toBeNull();
  });

  /** ログイン状態が変わったときに、前の人の分まで確実に消えること。 */
  it("全消しは人・会話をまたいで全部消す", () => {
    writeCachedHistory(storage, alice, { messages: ["a"] });
    writeCachedHistory(storage, bob, { messages: ["b"] });
    writeCachedHistory(storage, { sessionId: "s-2", signedIn: false, customerId: null }, {
      messages: ["c"],
    });
    storage.setItem("unrelated-key", "keep me");

    clearAllHistoryCache(storage);

    expect(readCachedHistory(storage, alice)).toBeNull();
    expect(readCachedHistory(storage, bob)).toBeNull();
    expect(storage.getItem("unrelated-key")).toBe("keep me");
  });
});

/* -------------------------------------------------------------------------- */
/* (c) ジャーナルのカテゴリ確定と先読みの使い回し                                 */
/* -------------------------------------------------------------------------- */

describe("ジャーナル一覧の絞り込みの確定", () => {
  const slugs = ["tea", "people"];

  it("指定が無ければ絞り込みなし", () => {
    expect(resolveActiveCategory(undefined, slugs)).toBe("all");
  });

  it("実在するカテゴリはそのまま効く", () => {
    expect(resolveActiveCategory("tea", slugs)).toBe("tea");
  });

  /** フォールバックを壊すと、この 1 件が落ちる。 */
  it("実在しないカテゴリは絞り込みなしに倒す", () => {
    expect(resolveActiveCategory("no-such-category", slugs)).toBe("all");
  });

  it("先読みは指定が当たったときだけ使う", () => {
    expect(canUseSpeculativeBundle("tea", "tea")).toBe(true);
    expect(canUseSpeculativeBundle(undefined, "all")).toBe(true);
  });

  /**
   * 外れたのに先読みを使い回すと、綴り違いの `?category=` で 0 件表示になる。
   * ここが本命で、`canUseSpeculativeBundle` を常に true にすると落ちる。
   */
  it("指定が外れたら先読みを使わず引き直す", () => {
    const requested = "no-such-category";
    const active = resolveActiveCategory(requested, slugs);
    expect(active).toBe("all");
    expect(canUseSpeculativeBundle(requested, active)).toBe(false);
  });
});

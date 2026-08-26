/**
 * お気に入りの倉庫 (`lib/favorites/client-store.ts`) の実挙動。
 *
 * ## 何を直しているか (Setaka 実機指摘 2026-08-25)
 *
 * 保存ボタンが 1 個ずつ `?check=` を叩いていたので、**ページを開くたび・ボタンの
 * 数だけ**往復が出て、その間ボタンは「確認しています」に化けていた。倉庫はその
 * 往復を「1 タブに 1 回」へ畳み、ページを移っても取り直さない (`sessionStorage`)。
 *
 * ここで縛る契約:
 *   1. 取り込みは 1 タブ 1 回。ボタンが何個載っていても往復は増えない。
 *   2. 取り込んだ結果はタブに残り、**次のページでは往復ゼロ**で状態が確定する。
 *   3. 読めなかったときは `error` に倒す。**「登録なし」に化けさせない** (G3)。
 *   4. 押下は楽観更新。失敗したら押す前に戻す。
 *   5. 状態が分かっていないまま押されたら、**書き込む前に実体を確かめる** (G4)。
 *   6. 書き込みの最中に取り込みが着地しても、確定した値を巻き戻さない。
 *   7. ログインの入口が変わったら持ち越しを捨てる (人違いのまま使い回さない)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* 倉庫は「ブラウザで動く」ことを `typeof window` で判定し、読み込み時に
   持ち越しを反映する。よって **import より前に** 偽のブラウザを用意する。 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

type Store = typeof import("@/lib/favorites/client-store");

const g = globalThis as unknown as {
  window?: unknown;
  document?: { cookie: string };
  sessionStorage?: MemoryStorage;
};

let sessionStorage: MemoryStorage;

function setCookies(value: string): void {
  (g.document as { cookie: string }).cookie = value;
}

/** 偽ブラウザを立て直して倉庫を読み込む (モジュール状態を毎回まっさらにする)。 */
async function loadStore(cookie = "shop_auth=1"): Promise<Store> {
  sessionStorage = new MemoryStorage();
  g.document = { cookie };
  g.sessionStorage = sessionStorage;
  g.window = { sessionStorage, document: g.document };
  vi.resetModules();
  return (await import("@/lib/favorites/client-store")) as Store;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete g.window;
  delete g.document;
  delete g.sessionStorage;
});

function listing(favorites: Array<{ type: string; targetId: string }>) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ favorites }),
  })) as unknown as typeof fetch;
}

describe("取り込みは 1 タブ 1 回", () => {
  it("何度呼んでも一覧の取得は 1 回だけ (ボタンの数で往復が増えない)", async () => {
    const store = await loadStore();
    const fetchMock = listing([{ type: "product", targetId: "sencha" }]);
    globalThis.fetch = fetchMock;

    store.ensureFavoritesHydrated();
    store.ensureFavoritesHydrated();
    store.ensureFavoritesHydrated();
    await vi.waitFor(() =>
      expect(store.getFavoritesSnapshot().phase).toBe("ready"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("saved");
  });

  it("取り込んだ結果はタブに残り、次のページでは往復ゼロで確定する", async () => {
    const first = await loadStore();
    globalThis.fetch = listing([{ type: "article", targetId: "roji-01" }]);
    first.ensureFavoritesHydrated();
    await vi.waitFor(() => expect(first.getFavoritesSnapshot().phase).toBe("ready"));

    /* ページ遷移 = モジュールを読み直す。sessionStorage はそのまま引き継ぐ。 */
    const carried = sessionStorage;
    g.sessionStorage = carried;
    g.window = { sessionStorage: carried, document: g.document };
    vi.resetModules();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const next = (await import("@/lib/favorites/client-store")) as Store;

    // 1 枚目の描画の時点で、往復を 1 度もせずに確定している。
    expect(next.getFavoritesSnapshot().phase).toBe("ready");
    expect(
      next.readFavoriteState(next.getFavoritesSnapshot(), "article", "roji-01"),
    ).toBe("saved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ログインの入口が変わったら持ち越しを捨てる (人違いのまま使い回さない)", async () => {
    const first = await loadStore("shop_auth=1");
    globalThis.fetch = listing([{ type: "product", targetId: "sencha" }]);
    first.ensureFavoritesHydrated();
    await vi.waitFor(() => expect(first.getFavoritesSnapshot().phase).toBe("ready"));

    const carried = sessionStorage;
    g.document = { cookie: "line_auth=1" };
    g.sessionStorage = carried;
    g.window = { sessionStorage: carried, document: g.document };
    vi.resetModules();
    const next = (await import("@/lib/favorites/client-store")) as Store;

    expect(next.getFavoritesSnapshot().phase).toBe("cold");
  });
});

describe("読めなかったことを「登録なし」に化けさせない", () => {
  it("失敗したら error に倒す (G3)", async () => {
    const store = await loadStore();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    store.ensureFavoritesHydrated();
    await vi.waitFor(() => expect(store.getFavoritesSnapshot().phase).toBe("error"));

    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("unknown");
  });

  it("未ログインなら往復せず「登録なし」で確定してよい", async () => {
    const store = await loadStore("");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    store.ensureFavoritesHydrated();

    expect(store.getFavoritesSnapshot().phase).toBe("signed-out");
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("unsaved");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("押されたとき", () => {
  it("状態が分かっていなければ、書き込む前に実体を確かめる (G4)", async () => {
    const store = await loadStore();

    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("check=")) {
        return { ok: true, status: 200, json: async () => ({ favorited: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    // 倉庫は cold のまま押された。実体は「登録済み」なので、押下は **解除** になる。
    const outcome = await store.toggleFavorite({
      kind: "product",
      targetId: "sencha",
      title: "煎茶",
      imageUrl: null,
    });

    expect(outcome).toBe("removed");
    expect(calls[0].url).toContain("check=sencha");
    expect(calls[1].method).toBe("DELETE");
  });

  it("失敗したら押す前の状態に戻す", async () => {
    const store = await loadStore();
    globalThis.fetch = listing([]);
    store.ensureFavoritesHydrated();
    await vi.waitFor(() => expect(store.getFavoritesSnapshot().phase).toBe("ready"));

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const outcome = await store.toggleFavorite({
      kind: "product",
      targetId: "sencha",
      title: "煎茶",
      imageUrl: null,
    });

    expect(outcome).toBe("failed");
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("unsaved");
  });

  it("一覧がまだ届かなくても、自分が保存した結果はその場でボタンに出る", async () => {
    /* 監査 P1-2 の残り。cold のまま押して保存できたのに、`readFavoriteState` が
       phase を見て `unknown` を返していたため、ボタンは「保存する」のままだった。
       本番実測 (一覧を 10 秒遅らせた条件) でラベルの反映が 7,493ms 遅れていた。 */
    const store = await loadStore();

    let releaseListing: (() => void) | undefined;
    const listingLanded = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && !url.includes("check=")) {
        await listingLanded; // 一覧はまだ届かない
        return { ok: true, status: 200, json: async () => ({ favorites: [] }) };
      }
      if (url.includes("check=")) {
        return { ok: true, status: 200, json: async () => ({ favorited: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    store.ensureFavoritesHydrated();

    // 押す前は「まだ分からない」(登録なしと言い切らない・G3)
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("unknown");

    const outcome = await store.toggleFavorite({
      kind: "product",
      targetId: "sencha",
      title: "煎茶",
      imageUrl: null,
    });
    expect(outcome).toBe("added");

    // 一覧はまだ届いていないが、自分の書き込みは確定している
    expect(store.getFavoritesSnapshot().phase).not.toBe("ready");
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("saved");

    // 押していないものは「まだ分からない」のまま (全部を saved に化けさせない)
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "matcha"),
    ).toBe("unknown");

    releaseListing?.();
  });

  it("保存に失敗したら、ボタンも押す前に戻る (cold のまま押した場合)", async () => {
    const store = await loadStore();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("check=")) {
        return { ok: true, status: 200, json: async () => ({ favorited: false }) };
      }
      if (method === "POST") return { ok: false, status: 500, json: async () => ({}) };
      return new Promise(() => {}); // 一覧は永久に届かない
    }) as unknown as typeof fetch;

    store.ensureFavoritesHydrated();

    const outcome = await store.toggleFavorite({
      kind: "product",
      targetId: "sencha",
      title: "煎茶",
      imageUrl: null,
    });

    expect(outcome).toBe("failed");
    /* 失敗したので「押す前」に戻す。実体は未登録と分かっているので `unsaved`。 */
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("unsaved");
  });

  it("書き込みの最中に取り込みが着地しても、確定した値を巻き戻さない", async () => {
    const store = await loadStore();

    let releaseListing: (() => void) | undefined;
    const listingLanded = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && !url.includes("check=")) {
        await listingLanded;
        // 取り込み結果は「何も登録されていない」= 書き込み前の世界。
        return { ok: true, status: 200, json: async () => ({ favorites: [] }) };
      }
      if (url.includes("check=")) {
        return { ok: true, status: 200, json: async () => ({ favorited: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    store.ensureFavoritesHydrated();

    const outcome = await store.toggleFavorite({
      kind: "product",
      targetId: "sencha",
      title: "煎茶",
      imageUrl: null,
    });
    expect(outcome).toBe("added");

    // ここで古い一覧が着地する。採用されると「保存済み」が巻き戻る。
    releaseListing?.();
    await vi.waitFor(() => expect(store.getFavoritesSnapshot().phase).toBe("ready"));

    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
    ).toBe("saved");
  });
});

describe("サーバが知っている一覧を初期値に渡せる (往復ゼロ)", () => {
  it("seed した時点で ready になり、取り込みを待たない", async () => {
    const store = await loadStore();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    store.seedFavoriteKeys(["person:masayuki-kubo"]);

    expect(store.getFavoritesSnapshot().phase).toBe("ready");
    expect(
      store.readFavoriteState(store.getFavoritesSnapshot(), "person", "masayuki-kubo"),
    ).toBe("saved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* `ensureFavoritesHydrated` が「もう確定しているか」を見ていなかったので、
     seed した画面に保存ボタンが載っているだけで一覧を 1 本余計に叩いていた
     (QA 指摘 2026-08-25)。ボタンは必ず mount で呼ぶので、往復が必ず 1 本出る。 */
  it("seed 済みの画面では、保存ボタンが載っていても一覧を取りに行かない", async () => {
    const store = await loadStore();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    store.seedFavoriteKeys(["person:masayuki-kubo"]);
    /* 画面上の保存ボタンが mount した = この呼び出しが起きる。 */
    store.ensureFavoritesHydrated();
    store.ensureFavoritesHydrated();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getFavoritesSnapshot().phase).toBe("ready");
  });
});

describe("1 回目の取り込みが失敗しても、そのタブで取り直せる", () => {
  /* 失敗を `hydrating` に握ったままにしていたので、`if (hydrating) return` が
     効き続けて **タブを閉じるまで二度と取り直せなかった** (QA 指摘 2026-08-25)。
     通信が戻っても `error` のままで、保存ボタンは押すたびに 1 件確認の往復が
     要る状態で固定される。 */
  it("間を置いたあとの呼び出しで取り直し、ready まで回復する", async () => {
    vi.useFakeTimers();
    try {
      const store = await loadStore();

      globalThis.fetch = vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch;

      store.ensureFavoritesHydrated();
      await vi.waitFor(() => expect(store.getFavoritesSnapshot().phase).toBe("error"));

      /* 通信は戻った。だが「失敗した直後」はまだ取りに行かない
         (1 画面のボタンの数だけ再試行が飛ぶのを防ぐため)。 */
      const recovered = listing([{ type: "product", targetId: "sencha" }]);
      globalThis.fetch = recovered;
      store.ensureFavoritesHydrated();
      expect(recovered).not.toHaveBeenCalled();

      /* 間隔 (10 秒) を越えたら 1 回だけ取り直す。 */
      vi.setSystemTime(Date.now() + 11_000);
      store.ensureFavoritesHydrated();
      await vi.waitFor(() => expect(store.getFavoritesSnapshot().phase).toBe("ready"));

      expect(recovered).toHaveBeenCalledTimes(1);
      expect(
        store.readFavoriteState(store.getFavoritesSnapshot(), "product", "sencha"),
      ).toBe("saved");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * F16 — 連携すると同じお気に入りが 2 件並ぶ。
 *
 * ## 実機で起きたこと (2026-08-25)
 *
 * LINE 側とメール側の両方で使っていた人が連携したあと、マイページの
 * 「お気に入りの読みもの」に同じ記事が 2 件、「お気に入りの人」に同じ人が 2 件
 * 並んだ。本番の棚を読むと、重複した 3 組はいずれも **`createdAt` がミリ秒まで
 * 一致**していた。同じ 1 件が 2 度書かれた痕跡であり、「利用者が 2 回押した」では
 * 説明できない。
 *
 * ## 原因
 *
 * 保存も合体も「同じものが在るか問い合わせ、無ければ `add()` で書く」だった。
 * この 2 手のあいだに割り込まれると、両方が「まだ無い」を見て両方が書く。合体の
 * 入口は 3 経路 (メールログインの取りこぼし再試行 / ワンタップ / LIFF) あり、
 * 救済スクリプトもあるので、2 つが重なるのは想定内の出来事だった。
 *
 * ## ここで固定する性質
 *
 *   I1. 合体が **2 つ同時に走っても** 引っ越し先は 1 件 (原理的な再発防止)
 *   I2. 保存が **2 回同時に来ても** 棚は 1 件
 *   I3. 旧採番 (自動 ID) の 1 件が既に在るとき、合体は増やさない
 *   I4. 既に重複している棚は、読んだときに片付く (既存データの是正)
 *   I5. 解除は一致するものを**全部**消す (片割れが残って復活しない)
 *   I6. 画面用の正規化は、棚が直っていなくても重複を出さない (最後の砦)
 *
 * 偽 Firestore は本物と同じく `await` ごとに他方へ実行を譲るので、I1/I2 は
 * 「2 つが同時に問い合わせて、2 つとも書く」という本番と同じ割り込みを踏む。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const fakeDb = { current: null as ReturnType<typeof createFakeFirestore> | null };

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => {
    if (!fakeDb.current) {
      throw new Error("real Firestore must not be used in this test");
    }
    return fakeDb.current.db;
  },
}));

import {
  favoriteDocId,
  normalizeFavorites,
  partitionFavoriteDuplicates,
  type FavoriteKind,
} from "@/lib/account-favorites";
import { mergeLineIdentityIntoShopify } from "@/lib/auth/identity-merge";
import { favoritesCol } from "@/lib/firebase/collections";
import {
  addFavorite,
  getFavorites,
  removeFavorite,
} from "@/lib/firebase/server-actions";
import { createFakeFirestore, type Seed } from "./helpers/fake-firestore";

const LINE_USER_ID = "U0123456789";
const LINE_KEY = `line:${LINE_USER_ID}`;
const SHOPIFY_ID = "7654321";

const ARTICLE = {
  type: "article",
  targetId: "tea-time-as-luxury-slow-life-practice",
  title: "お茶の時間という贅沢",
  imageUrl: null,
} satisfies { type: FavoriteKind; targetId: string; title: string; imageUrl: string | null };

const PERSON = {
  type: "person",
  targetId: "setaka-on",
  title: "お気に入りの人",
  imageUrl: null,
} satisfies { type: FavoriteKind; targetId: string; title: string; imageUrl: string | null };

function useFake(seed: Seed = {}) {
  fakeDb.current = createFakeFirestore(seed);
  return fakeDb.current;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fakeDb.current = null;
  vi.restoreAllMocks();
});

describe("F16 — 連携時のお気に入り重複", () => {
  it("I1: 合体が 2 つ同時に走っても、引っ越し先は 1 件のまま", async () => {
    const fake = useFake({
      [favoritesCol(LINE_KEY)]: [
        { ...ARTICLE, createdAt: new Date("2026-08-25T06:50:52.642Z") },
        { ...PERSON, createdAt: new Date("2026-08-25T06:51:39.289Z") },
      ],
    });

    /* 本番で起きた形そのもの: 連携の入口が 2 つ、ほぼ同時に合体を呼ぶ。 */
    await Promise.all([
      mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db),
      mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db),
    ]);

    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(2);
    expect(fake.ids(favoritesCol(SHOPIFY_ID)).sort()).toEqual(
      [
        favoriteDocId("article", ARTICLE.targetId),
        favoriteDocId("person", PERSON.targetId),
      ].sort(),
    );
    // 元の棚は空になっている (運び終わった)。
    expect(fake.count(favoritesCol(LINE_KEY))).toBe(0);
  });

  it("I2: 同じお気に入りの保存が 2 回同時に来ても、棚は 1 件", async () => {
    const fake = useFake();

    await Promise.all([
      addFavorite(SHOPIFY_ID, ARTICLE),
      addFavorite(SHOPIFY_ID, ARTICLE),
    ]);

    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(1);
    expect(fake.ids(favoritesCol(SHOPIFY_ID))).toEqual([
      favoriteDocId("article", ARTICLE.targetId),
    ]);
  });

  it("I3: 旧採番の 1 件が既にあるとき、合体はもう 1 件を作らない", async () => {
    const fake = useFake({
      // 自動 ID 時代に顧客の棚へ入っていた 1 件。
      [favoritesCol(SHOPIFY_ID)]: [
        { ...ARTICLE, createdAt: new Date("2026-08-20T00:00:00.000Z") },
      ],
      [favoritesCol(LINE_KEY)]: [
        { ...ARTICLE, createdAt: new Date("2026-08-25T06:50:52.642Z") },
      ],
    });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db);

    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(1);
    expect(fake.count(favoritesCol(LINE_KEY))).toBe(0);
  });

  it("I4: 既に重複している棚は、読んだときに 1 件へ片付く (冪等)", async () => {
    const createdAt = new Date("2026-08-25T06:50:52.642Z");
    const fake = useFake({
      [favoritesCol(SHOPIFY_ID)]: [
        { ...ARTICLE, createdAt },
        { ...ARTICLE, createdAt },
        { ...PERSON, createdAt: new Date("2026-08-25T06:51:39.289Z") },
      ],
    });
    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(3);

    const first = await getFavorites(SHOPIFY_ID);
    expect(first).toHaveLength(2);
    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(2);

    // 2 回目は消すものが無い (冪等)。
    const second = await getFavorites(SHOPIFY_ID);
    expect(second).toHaveLength(2);
    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(2);
  });

  it("I7: 旧採番の 1 件しか無い棚は、保存し直したときに新採番へ移る", async () => {
    /* QA 指摘 3 の回帰。以前は `already_exists` を返して**そのまま**にしていたので、
       旧採番が 1 件だけの棚は永久に旧採番のまま残った。読み出し側の片付けが効くのは
       「重複しているとき」だけなので、1 件だけの棚は誰も直さない。つまり
       `doc(favoriteDocId(...)).set()` を前提にした F16 の再発防止の外に居続ける。 */
    const createdAt = new Date("2026-08-20T00:00:00.000Z");
    const fake = useFake({
      [favoritesCol(SHOPIFY_ID)]: [{ ...ARTICLE, createdAt }],
    });
    expect(fake.ids(favoritesCol(SHOPIFY_ID))).toEqual(["seed-1"]);

    const result = await addFavorite(SHOPIFY_ID, ARTICLE);

    expect(result).toMatchObject({ success: true, action: "already_exists" });
    // 棚は 1 件のまま。ただし ID が内容から決まる形になっている。
    expect(fake.ids(favoritesCol(SHOPIFY_ID))).toEqual([
      favoriteDocId(ARTICLE.type, ARTICLE.targetId),
    ]);

    // 保存日は最初の 1 件のものを引き継ぐ (移動で今日に化けさせない)。
    const stored = fake.contents(favoritesCol(SHOPIFY_ID));
    expect(stored).toHaveLength(1);
    expect((stored[0] as { createdAt: Date }).createdAt).toEqual(createdAt);
  });

  it("I7b: 旧採番と新採番が両方あるときは、新採番を残して旧採番を消す", async () => {
    const docId = favoriteDocId(ARTICLE.type, ARTICLE.targetId);
    const fake = useFake({
      [favoritesCol(SHOPIFY_ID)]: [
        { ...ARTICLE, createdAt: new Date("2026-08-20T00:00:00.000Z") },
      ],
    });
    // 新採番の 1 件を後から置く (本命)。
    fake.seed(
      favoritesCol(SHOPIFY_ID),
      { ...ARTICLE, createdAt: new Date("2026-08-24T00:00:00.000Z") },
      docId,
    );
    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(2);

    await addFavorite(SHOPIFY_ID, ARTICLE);

    expect(fake.ids(favoritesCol(SHOPIFY_ID))).toEqual([docId]);
  });

  it("I7c: 移行に失敗しても保存済みの答えは変わらない (利用者に失敗を見せない)", async () => {
    fakeDb.current = createFakeFirestore(
      {
        [favoritesCol(SHOPIFY_ID)]: [
          { ...ARTICLE, createdAt: new Date("2026-08-20T00:00:00.000Z") },
        ],
      },
      {
        beforeDelete: () => {
          throw new Error("delete rejected");
        },
      },
    );

    const result = await addFavorite(SHOPIFY_ID, ARTICLE);

    expect(result).toMatchObject({ success: true, action: "already_exists" });
    /* 消せなかったぶんは重複として残るが、読み出し側の片付けが次に拾う。 */
    const rows = await getFavorites(SHOPIFY_ID);
    expect(rows).toHaveLength(1);
  });

  it("I4b: 種類や対象が読めない行は、重複と判定して消さない", () => {
    const rows = [
      { id: "a", type: "article", targetId: "x", createdAt: "2026-01-01" },
      { id: "b", type: undefined, targetId: undefined, createdAt: null },
      { id: "c", type: "article", targetId: "x", createdAt: "2026-01-02" },
    ];

    const { kept, duplicates } = partitionFavoriteDuplicates(rows);

    expect(duplicates.map((row) => row.id)).toEqual(["c"]);
    expect(kept.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("I5: 解除は一致するものを全部消す", async () => {
    const createdAt = new Date("2026-08-25T06:50:52.642Z");
    const fake = useFake({
      [favoritesCol(SHOPIFY_ID)]: [
        { ...ARTICLE, createdAt },
        { ...ARTICLE, createdAt },
      ],
    });

    const result = await removeFavorite(SHOPIFY_ID, "article", ARTICLE.targetId);

    expect(result).toMatchObject({ success: true, action: "removed" });
    expect(fake.count(favoritesCol(SHOPIFY_ID))).toBe(0);
  });

  it("I6: 画面用の正規化は、棚が直っていなくても同じカードを 2 枚出さない", () => {
    const entries = normalizeFavorites([
      { id: "1", type: "article", targetId: "x", title: "記事", createdAt: "2026-01-02" },
      { id: "2", type: "article", targetId: "x", title: "記事", createdAt: "2026-01-02" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("1");
  });

  it("ドキュメント ID は内容から一意に決まり、`/` を含む対象でも壊れない", () => {
    expect(favoriteDocId("article", "tea-time")).toBe("article~tea-time");
    // `/` は Firestore のドキュメント ID に使えない。退避しても 1 対 1 のまま。
    expect(favoriteDocId("product", "a/b")).not.toContain("/");
    expect(favoriteDocId("product", "a/b")).not.toBe(
      favoriteDocId("product", "a%2Fb"),
    );
  });
});

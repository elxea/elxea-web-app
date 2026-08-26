/**
 * 連携の合体を「速さ」と「途中で切れたとき」の 2 面から固定する。
 *
 * ## 何が起きていたか（2026-08-25 本番）
 *
 * メールでログイン済みの人がマイページから LINE 連携すると、LINE の認可を
 * 承認したあと **真っ白な画面が 20 秒**続いてからマイページに着いた。連携も
 * データの合体も成功しているのに、待たされる。普通のお客さまは離脱する。
 *
 * Vercel の request log の実測は次のとおりで、**コールドスタートではない**:
 *
 *   GET /api/user/line-link/callback  307
 *   requestDurationMs = 20300 / functionDurationMs = 20129
 *   region = iad1 / functionStartType = hot / coldStartDurationMs = -1
 *
 * 原因は往復の置き方だった。Firestore は `asia-northeast1`（実測）、関数は
 * `iad1`。1 往復 170〜200ms かかるのに、合体は
 *
 *   - サブコレクション 6 つを直列に
 *   - その中でドキュメントを 1 件ずつ直列に
 *   - 1 件につき 4 往復（存在確認 → 書く → 読み戻す → 消す）
 *
 * 回していた。`6 + 4n + α` 往復が全部直列に並べば、荷物のある人ほど線形に
 * 遅くなる。
 *
 * ## このファイルが固定すること
 *
 *   L1. 合体は往復を並行に開く（直列に戻したら落ちる）
 *   L2. 荷物が増えても待ち時間は線形に伸びない
 *   L3. 並行にしたせいで**引っ越し先に重複が生まれない**（直列時代は 1 件目の
 *       コピーが 2 件目の存在確認から見えたので、そこに守りが要らなかった）
 *   A1. 途中で切れてもデータは消えない（4 段の順序は緩んでいない）
 *   A2. 途中で切れた続きは、次の機会に再実行すれば必ず埋まる（冪等・再開可能）
 *
 * L1/L2 は「速さ」のテストなので壁時計に触れるが、**閾値は実測の桁から遠く
 * 離して**置く（直列なら確実に超え、並行なら確実に下回る幅）。CI の揺れで
 * 落ちるテストは、いずれ無視されて意味を失うため。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => {
    throw new Error("real Firestore must not be used in this test");
  },
}));

import { mergeLineIdentityIntoShopify } from "@/lib/auth/identity-merge";
import { behaviorLogCol, favoritesCol } from "@/lib/firebase/collections";
import { createFakeFirestore, type DocData } from "./helpers/fake-firestore";

const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const LINE_KEY = `line:${LINE_USER_ID}`;
const SHOPIFY_ID = "7654321";

/** n 件のお気に入り（それぞれ別の商品 = 別の dedupe キー）。 */
function favorites(n: number): DocData[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "product",
    targetId: `gid://shopify/Product/${i + 1}`,
  }));
}

/** n 件の行動ログ（ID を保って運ぶ側）。 */
function behaviorLogs(n: number): DocData[] {
  return Array.from({ length: n }, (_, i) => ({
    event: "viewed",
    at: new Date(1_700_000_000_000 + i * 1_000),
  }));
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.clearAllMocks();
});

// --- L1/L2: 往復は並行に開く -------------------------------------------------

describe("合体は Firestore への往復を並行に開く", () => {
  it("L1: 30 件を運ぶあいだ、往復は 1 本ずつではなく同時に開いている", async () => {
    const { db, stats } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: favorites(30),
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);
    expect(result.collections.favorites.copied).toBe(30);

    /* 直列だった頃はここが必ず 1 になる（1 往復が終わるまで次を開かないため）。
       この 1 行が 20 秒の白画面そのものを指している。 */
    expect(stats.maxInFlight).toBeGreaterThan(1);
  });

  it("L1: サブコレクション同士も並行に走る（6 つを順番に待たない）", async () => {
    const { db, stats } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: favorites(1),
      [behaviorLogCol(LINE_KEY)]: behaviorLogs(1),
    });

    await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    /* 荷物が各コレクション 1 件でも、6 つのコレクションの「一覧取得」だけは
       必ず並行に開ける。直列に戻すと 1 になる。 */
    expect(stats.maxInFlight).toBeGreaterThan(1);
  });

  it("L2: 荷物が 8 倍になっても、直列に並ぶ往復の段数は 8 倍にならない", async () => {
    /* 本番の待ち時間は往復の**総数**ではなく「直列に並んだ段数」で決まる
       （1 往復 170〜200ms が素直に積み上がる）。よって段数を数える。

       ## 壁時計をやめた理由（QA 指摘 2026-08-25）

       ここは以前 `Date.now()` の差分で測っていた。偽物の遅延は実タイマーな
       ので、機械が他の作業で混んでいると測定値が桁で揺れる — 判定が変更の
       中身ではなく「そのとき機械が空いていたか」で決まる。落ちる理由が変更と
       無関係なテストは、いずれ無視されて意味を失う（`vitest.config.ts` の
       testTimeout の但し書きと同じ話）。段数なら同じコードで必ず同じ数が出る。
       閾値の意味（直列への逆戻りだけを捕まえる）は 1 つも緩めていない。 */
    const run = async (count: number) => {
      const { db, stats } = createFakeFirestore({
        [favoritesCol(LINE_KEY)]: favorites(count),
      });
      const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);
      expect(result.collections.favorites.copied).toBe(count);
      return stats.waves;
    };

    const small = await run(5);
    const large = await run(40);

    /* 直列なら large / small はほぼ 8（1 件 = 4 往復がそのまま 4 段）。
       並行なら 1 波の上限（24 件）を跨ぐぶんだけ増えて 2 倍前後に収まる。
       4 倍を境にすれば、直列への逆戻りだけを確実に捕まえられる。 */
    expect(large).toBeLessThan(small * 4);
  });
});

// --- L3: 並行化で新しく開いた穴を塞いである ----------------------------------

describe("並行に運んでも引っ越し先に重複を作らない", () => {
  it("L3: 同じお気に入りが source に 3 件あっても、引っ越し先は 1 件だけ", async () => {
    const duplicate = { type: "product", targetId: "gid://shopify/Product/42" };
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [
        { ...duplicate },
        { ...duplicate },
        { ...duplicate },
      ],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    /* 直列だった頃は 1 件目のコピーが 2 件目の存在確認から見えたので黙って
       1 件になった。並行だと 3 件が同時に「まだ無い」を見るので、dispatch 前に
       畳んでおかないと 3 件書かれる。 */
    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([duplicate]);
    // source は 3 件とも片付く（1 件が copied、残り 2 件が deduped）。
    expect(contents(favoritesCol(LINE_KEY))).toEqual([]);
    expect(result.collections.favorites).toMatchObject({ copied: 1, deduped: 2, failed: 0 });
  });

  it("L3: 引っ越し先に既にある分は書き足さない（冪等）", async () => {
    const existing = { type: "product", targetId: "gid://shopify/Product/7" };
    const { db, contents } = createFakeFirestore({
      [favoritesCol(LINE_KEY)]: [{ ...existing }, { ...existing }],
      [favoritesCol(SHOPIFY_ID)]: [{ ...existing }],
    });

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(SHOPIFY_ID))).toEqual([existing]);
    expect(contents(favoritesCol(LINE_KEY))).toEqual([]);
    expect(result.collections.favorites).toMatchObject({ copied: 0, deduped: 2 });
  });
});

// --- A1/A2: 途中で切れても壊れない -------------------------------------------

describe("合体が途中で切れても、お客さまのデータは失われない", () => {
  it("A1: 書き込みが落ちている間は、source を 1 件も消さない", async () => {
    /* 「コピーは ack されたのに着地していない」= 読み戻せない状態。
       ack を根拠に消していたら、ここでデータが消える。 */
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: favorites(10) },
      { dropWrite: () => true },
    );

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    expect(contents(favoritesCol(LINE_KEY))).toHaveLength(10);
    expect(contents(favoritesCol(SHOPIFY_ID))).toHaveLength(0);
    expect(result.collections.favorites.failed).toBe(10);
    expect(result.complete).toBe(false);
  });

  it("A1: 途中で Firestore が落ちても、運び終えた分と残った分の合計は減らない", async () => {
    /* 5 件目の書き込みから先を全部落とす = 「合体の最中にプロセスが死んだ」の
       近似。運べた分は引っ越し先に、運べなかった分は元の場所に、必ずどちらかに
       いる（どこにも無い = 消えた、が起きない）ことを見る。 */
    let writes = 0;
    const { db, contents } = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: favorites(12) },
      {
        beforeWrite: (path) => {
          if (!path.startsWith(favoritesCol(SHOPIFY_ID))) return;
          writes += 1;
          if (writes > 4) throw new Error("firestore went away mid-merge");
        },
      },
    );

    const result = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, db);

    const moved = contents(favoritesCol(SHOPIFY_ID)).length;
    const retained = contents(favoritesCol(LINE_KEY)).length;
    expect(moved).toBeGreaterThan(0);
    expect(retained).toBeGreaterThan(0);
    // 12 件はどこにも消えていない。
    expect(moved + retained).toBe(12);
    expect(result.complete).toBe(false);
  });

  it("A2: 切れた続きは、もう一度走らせれば必ず埋まる（再開可能）", async () => {
    let writes = 0;
    let broken = true;
    const fake = createFakeFirestore(
      { [favoritesCol(LINE_KEY)]: favorites(12) },
      {
        beforeWrite: (path) => {
          if (!broken) return;
          if (!path.startsWith(favoritesCol(SHOPIFY_ID))) return;
          writes += 1;
          if (writes > 4) throw new Error("firestore went away mid-merge");
        },
      },
    );

    const first = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db);
    expect(first.complete).toBe(false);

    /* 次のメールログイン（`completeLineLinkage` の取りこぼし再試行）に相当。
       これが「途中離脱しても最終的に壊れたままにならない」の根拠。 */
    broken = false;
    const second = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db);

    expect(second.complete).toBe(true);
    expect(fake.contents(favoritesCol(LINE_KEY))).toEqual([]);
    // 重複を作らずに 12 件ちょうど。再実行が二重コピーにならないこと。
    expect(fake.contents(favoritesCol(SHOPIFY_ID))).toHaveLength(12);
  });

  it("A2: 行動ログ（ID を保つ側）も、再実行で重複せず埋まる", async () => {
    let deletes = 0;
    let broken = true;
    const fake = createFakeFirestore(
      { [behaviorLogCol(LINE_KEY)]: behaviorLogs(10) },
      {
        beforeDelete: (path) => {
          if (!broken) return;
          if (!path.startsWith(behaviorLogCol(LINE_KEY))) return;
          deletes += 1;
          /* コピーは着地したのに source の削除だけ落ちた状態。再実行時に
             「引っ越し先に同じ ID がある」を重複扱いして消せるかを見る。 */
          if (deletes > 3) throw new Error("delete failed mid-merge");
        },
      },
    );

    const first = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db);
    /* 消し損ねた残骸は残るが、中身は全部引っ越し先に着地している。だから
       `complete`（= 運べなかったものがあるか）は true で、残骸は専用の欄で
       数える (QA 指摘 2 / 以前は同じ 1 件を copied と failed に二重計上して
       いたので、ここが false になっていた)。 */
    expect(first.complete).toBe(true);
    expect(first.totals.staleSourceRetained).toBeGreaterThan(0);
    expect(fake.contents(behaviorLogCol(LINE_KEY)).length).toBeGreaterThan(0);

    broken = false;
    const second = await mergeLineIdentityIntoShopify(LINE_USER_ID, SHOPIFY_ID, fake.db);

    expect(second.complete).toBe(true);
    expect(fake.contents(behaviorLogCol(LINE_KEY))).toEqual([]);
    expect(fake.contents(behaviorLogCol(SHOPIFY_ID))).toHaveLength(10);
  });
});

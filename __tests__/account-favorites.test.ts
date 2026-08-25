import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FAVORITES_KIND_LIMIT,
  FAVORITE_KINDS,
  FAVORITE_KIND_META,
  countFavorites,
  favoriteHref,
  groupFavorites,
  indexOfFavorite,
  insertFavoriteIntoGroups,
  normalizeFavorites,
  removeFavoriteFromGroups,
  type FavoriteEntry,
  type FavoriteInput,
} from "@/lib/account-favorites";

/**
 * お気に入りの種類分け・解除の状態遷移の単体テスト。
 *
 * 守りたいこと (Setaka 要望 2026-08-25 に対応):
 *   - 種類別に分かれ、**0 件の種類も枠が残る** (「商品はお気に入りにできない」と
 *     読まれる状態を作らない)
 *   - 押しても行き先が無いカードは一覧に出さない
 *   - 解除の楽観更新は、失敗したとき **元の位置に** 戻る (並びが変わらない)
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * コメントを落としたソース。「この呼び出しが**書かれていない**こと」を縛るときに使う。
 *
 * 素のソースを見ると、直した経緯を説明するコメント (「以前はここで
 * `countFavorites(groups)` を数えていた」等) が本物の呼び出しと区別できず、
 * 経緯を書いた瞬間にテストが赤くなる。実際 F14 でそれを踏んだので、
 * 見るのはコメントを除いた側にする。
 *
 * 対象はこのリポジトリの `.tsx` / `.ts` だけで、文字列の中の `//` (URL 等) までは
 * 面倒を見ない。使う前に対象ファイルにそれが無いことを確かめること。
 */
const readCode = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const raw = (over: Partial<FavoriteInput> = {}): FavoriteInput => ({
  id: "f-1",
  type: "article",
  targetId: "hiire",
  title: "火入れという時間のかけ方",
  imageUrl: "/a.jpg",
  createdAt: "2026-08-18T02:00:00.000Z",
  ...over,
});

describe("normalizeFavorites", () => {
  it("種類ごとの遷移先を組む", () => {
    const [article, product] = normalizeFavorites([
      raw(),
      raw({ id: "f-2", type: "product", targetId: "sencha-akane", title: "煎茶 茜" }),
    ]);

    expect(article).toMatchObject({ kind: "article", href: "/journal/hiire" });
    expect(product).toMatchObject({ kind: "product", href: "/products/sencha-akane" });
  });

  it("題名なし・遷移先なし・未知の種類は落とす (押しても何も無いカードを出さない)", () => {
    expect(
      normalizeFavorites([
        raw({ id: "a", title: null }),
        raw({ id: "b", targetId: "  " }),
        /* 種類の正本 (`FAVORITE_KINDS`) に無い語。農家は 4 分類目になったので
           ここでは使えない — 未知の種類の例には、いま実在しない語を使う。 */
        raw({ id: "c", type: "brewery" }),
        raw({ id: "d", type: undefined }),
      ])
    ).toEqual([]);
  });

  it("入力順 (createdAt 降順) を保つ", () => {
    const result = normalizeFavorites([
      raw({ id: "new", targetId: "new" }),
      raw({ id: "old", targetId: "old" }),
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("id が無い行にも安定した鍵を振る (React の key が衝突しない)", () => {
    const result = normalizeFavorites([
      raw({ id: undefined, targetId: "x" }),
      raw({ id: undefined, targetId: "y" }),
    ]);
    expect(new Set(result.map((entry) => entry.id)).size).toBe(2);
  });
});

describe("groupFavorites", () => {
  it("種類の並びは FAVORITE_KINDS で固定され、0 件の種類も枠が残る", () => {
    const groups = groupFavorites(normalizeFavorites([raw()]));

    expect(groups.map((group) => group.kind)).toEqual([...FAVORITE_KINDS]);
    const product = groups.find((group) => group.kind === "product");
    expect(product).toBeDefined();
    expect(product?.items).toEqual([]);
  });

  it("1 種類あたりの上限で切る", () => {
    const many = Array.from({ length: FAVORITES_KIND_LIMIT + 5 }, (_, i) =>
      raw({ id: `f-${i}`, targetId: `t-${i}` })
    );
    const groups = groupFavorites(normalizeFavorites(many));
    expect(countFavorites(groups)).toBe(FAVORITES_KIND_LIMIT);
  });

  it("マイページ本体の抜粋より十分に多く出す (一覧が抜粋の下位互換にならない)", () => {
    expect(FAVORITES_KIND_LIMIT).toBeGreaterThan(6);
  });
});

describe("解除の楽観更新", () => {
  const groups = groupFavorites(
    normalizeFavorites([
      raw({ id: "a1", targetId: "a1" }),
      raw({ id: "a2", targetId: "a2" }),
      raw({ id: "a3", targetId: "a3" }),
      raw({ id: "p1", type: "product", targetId: "p1" }),
    ])
  );
  const target = groups[1]?.items[1] as FavoriteEntry; // article の 2 番目

  it("押した 1 件だけが消える (種類の枠は残る)", () => {
    const next = removeFavoriteFromGroups(groups, target.id);
    expect(next.map((group) => group.kind)).toEqual([...FAVORITE_KINDS]);
    expect(
      next.find((group) => group.kind === "article")?.items.map((item) => item.id)
    ).toEqual(["a1", "a3"]);
    expect(next.find((group) => group.kind === "product")?.items).toHaveLength(1);
  });

  it("失敗したときは元の位置に戻る (末尾に付け足さない)", () => {
    const index = indexOfFavorite(groups, target);
    const removed = removeFavoriteFromGroups(groups, target.id);
    const restored = insertFavoriteIntoGroups(removed, target, index);

    expect(
      restored.find((group) => group.kind === "article")?.items.map((item) => item.id)
    ).toEqual(["a1", "a2", "a3"]);
  });

  it("同じものを二重に戻さない (復元が二度走っても件数が増えない)", () => {
    const once = insertFavoriteIntoGroups(groups, target, 1);
    expect(countFavorites(once)).toBe(countFavorites(groups));
  });

  it("元データを書き換えない (壊れた状態が残らない)", () => {
    removeFavoriteFromGroups(groups, target.id);
    expect(countFavorites(groups)).toBe(4);
  });
});

describe("種類カタログ", () => {
  it("すべての種類がメタ情報を持つ", () => {
    for (const kind of FAVORITE_KINDS) {
      const meta = FAVORITE_KIND_META[kind];
      expect(meta.basePath.startsWith("/"), kind).toBe(true);
      expect(favoriteHref(kind, "x"), kind).toBe(`${meta.basePath}/x`);
    }
  });

  /**
   * 0 件の節に出る「探しに行く」導線は **実在するページ** を指していなければ
   * ならない。人 (`/people/[slug]`) は詳細だけがあって一覧が無いので、
   * `basePath` をそのまま導線にすると 404 に送ってしまう。
   */
  it("0 件のときの導線は実在する一覧ページを指す", () => {
    for (const kind of FAVORITE_KINDS) {
      const { browsePath } = FAVORITE_KIND_META[kind];
      expect(browsePath.startsWith("/"), kind).toBe(true);
      expect(
        existsSync(join(ROOT, "app/[locale]", browsePath.slice(1), "page.tsx")) ||
          existsSync(join(ROOT, "app/[locale]/(reading)", browsePath.slice(1), "page.tsx")),
        `${kind}: ${browsePath} に一覧ページが無い`
      ).toBe(true);
    }
  });

  /**
   * 分類は 4 つ (商品・読みもの・人・農家) で確定 (J-5 決裁)。
   *
   * 農家は以前「フォロー中の農家」という別の動詞・別のコレクションだったが、
   * 4 分類目としてお気に入りへ統合した。ここが 3 に戻る = 農家の行き先が
   * また消える、5 になる = 決裁を経ずに分類が増えた、のどちらかなので縛る。
   */
  it("分類は商品・読みもの・人・農家の 4 つ", () => {
    expect([...FAVORITE_KINDS]).toEqual(["product", "article", "person", "farmer"]);
  });

  /**
   * マイページは抜粋ではなく **4 分類をそのまま** 見せる (Setaka 実機指示
   * 2026-08-25)。「続き」の抜粋・優先順位 (`continueRank` /
   * `FAVORITE_CONTINUE_ORDER`) と「お気に入りをすべて見る」リンクは、
   * その結果として行き先が無くなったので撤去した。
   * 復活すると「入れたのに見当たらない」が戻るので、書かれていないことを縛る。
   */
  it("抜粋の優先順位はもう持たない (マイページが 4 分類をそのまま出すため)", () => {
    const source = readCode("lib/account-favorites.ts");
    expect(source).not.toContain("continueRank");
    expect(source).not.toContain("FAVORITE_CONTINUE_ORDER");
  });

  /**
   * どの種類も、少なくとも 1 つの保存の入口 (`FavoriteToggleButton`) を持つ
   * ページから保存できなければ、節だけが残って中身が増えない
   * (旧「フォロー中の農家」が実際にそうなっていた)。
   */
  it("すべての種類に保存の入口がある (節だけ残って増えない状態を作らない)", () => {
    const entryPoints: Record<string, string> = {
      product: "app/[locale]/products/[handle]/page.tsx",
      article: "app/[locale]/(reading)/journal/[slug]/page.tsx",
      person: "app/[locale]/people/[slug]/page.tsx",
      farmer: "app/[locale]/(reading)/farmers/[slug]/page.tsx",
    };

    for (const kind of FAVORITE_KINDS) {
      const path = entryPoints[kind];
      expect(path, `${kind}: 保存の入口となるページが決まっていない`).toBeDefined();
      expect(existsSync(join(ROOT, path)), `${kind}: ${path} が無い`).toBe(true);
      const page = readCode(path);
      expect(page, `${kind}: ${path} に保存ボタンが無い`).toContain("FavoriteToggleButton");
      expect(page, `${kind}: ${path} の保存ボタンが種類を渡していない`).toContain(
        `kind="${kind}"`
      );
    }
  });

  /**
   * API の受け口と Firestore の型は `FAVORITE_KINDS` から導く (F4)。
   * ここが語のベタ書きに戻ると「画面には節が出るのに保存すると 400」が復活する。
   */
  it("API の受け口が種類の正本から導かれている", () => {
    const route = read("app/api/user/favorites/route.ts");
    expect(route).toContain("z.enum(FAVORITE_KINDS)");
    expect(route).not.toMatch(/z\.enum\(\s*\[/);
    expect(read("lib/firebase/types.ts")).toContain("export type FavoriteType = FavoriteKind");
  });

  it("人のお気に入りは人のページを指す", () => {
    expect(favoriteHref("person", "masayuki-kubo")).toBe("/people/masayuki-kubo");
  });

  it("文言キーはすべて messages/ja.json と en.json に実在する", () => {
    for (const locale of ["ja", "en"] as const) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      const account = messages.account as Record<string, unknown>;
      const common = messages.common as Record<string, unknown>;

      for (const kind of FAVORITE_KINDS) {
        const meta = FAVORITE_KIND_META[kind];
        for (const key of [meta.headingKey, meta.emptyKey, meta.labelKey]) {
          expect(typeof account[key], `${locale}.json account.${key}`).toBe("string");
        }
        expect(
          typeof common[meta.browseLabelKey],
          `${locale}.json common.${meta.browseLabelKey}`
        ).toBe("string");
      }

      for (const key of ["favorites", "favoritesCount", "favoriteRemoveLabel", "noFavorites"]) {
        expect(typeof account[key], `${locale}.json account.${key}`).toBe("string");
      }
    }
  });
});

describe("お気に入りはマイページ本体で見る", () => {
  const page = read("app/[locale]/account/page.tsx");

  /**
   * 一覧は独立ページ (`/account/favorites`) から **マイページ本体へ移した**
   * (Setaka 実機指摘 2026-08-25)。自分が保存したものを見るのに 1 回よけいな
   * 遷移が要り、抜粋 6 枚に入らなかった種類はマイページから存在ごと見えなかった。
   */
  it("分類ごとの一覧はマイページ本体が描く", () => {
    const code = readCode("app/[locale]/account/page.tsx");
    expect(code).toContain("<FavoritesBoard groups={favoriteGroups} />");
    expect(code).toContain("groupFavorites");
  });

  it("識別子をクライアントへ渡さない (渡すのは正規化済みの一覧だけ)", () => {
    expect(page).not.toMatch(/userKey=\{/);
  });

  /**
   * 旧ページは **消さずに恒久リダイレクト**にする。ブックマーク・過去の案内・
   * 検索結果からの流入を 404 にしないため。中身を二重に持たせない
   * (両方が一覧を描くと、直した側だけが直る状態に戻る)。
   */
  it("旧ページはマイページ本体への転送だけを残す (404 にしない / 二重に描かない)", () => {
    const legacy = readCode("app/[locale]/account/favorites/page.tsx");
    expect(legacy).toContain("redirect");
    expect(legacy).toContain('"/account"');
    expect(legacy).not.toContain("FavoritesBoard");
    expect(legacy).not.toContain("groupFavorites");
  });

  it("マイページ本体に「すべて見る」の外向きリンクは残っていない", () => {
    const code = readCode("app/[locale]/account/page.tsx");
    expect(code).not.toContain('href: "/account/favorites"');
  });

  /**
   * F14 (本番実測 2026-08-25): 3 件のうち 1 件を解除するとカードは即消えるのに、
   * 見出し脇の合計が「3件」のまま残り、リロードして初めて「2件」に正っていた。
   *
   * 原因は件数の出どころが 2 つに割れていたこと — 節の件数は解除の状態
   * (`FavoritesBoard` の state) から出ていたが、合計だけはこのページが
   * `countFavorites(groups)` を **サーバで一度** 数えて `AccountTitleBlock` に
   * 渡していた。サーバ側の値は解除では再計算されないので永久に古いままになる。
   *
   * 直し方は「数える側を state を持つ側だけにする」なので、その形をここで縛る。
   * 描画結果ではなく出どころを見るのは、`countFavorites` がページに戻った瞬間に
   * 落とすため — 戻ってしまえば、どんな描画テストも初期表示では緑のまま通る
   * (壊れるのは解除した後だけ) で、取りこぼす。
   */
  it("合計件数をサーバで数えない (解除で更新されない値を作らない / F14)", () => {
    const code = readCode("app/[locale]/account/page.tsx");
    expect(code).not.toContain("countFavorites");
    // 見出し脇の合計の文言もページ側には残らない (残っていれば描いている)。
    expect(code).not.toContain("favoritesCount");
  });

  it("合計件数は解除の状態を持つ側が state から数える (F14)", () => {
    const board = readCode("components/account/favorites-board.tsx");
    /* 見出しは節見出し (`AccountSectionHeader`)。マイページ本体の 1 節になったので
       ページ見出し (`AccountTitleBlock` = 戻るリンク付き) はもう使わない。 */
    expect(board).toContain("<AccountSectionHeader");
    expect(board).not.toContain("<AccountTitleBlock");
    // 初期 props (`initialGroups`) ではなく state の `groups` を数える。
    expect(board).toContain("countFavorites(groups)");
    expect(board).not.toContain("countFavorites(initialGroups)");
  });

  /* 検出器の自己点検。`readCode` がコメントごと中身を消してしまうと、上の 2 本は
     実装が壊れても緑のままになる (「書かれていない」は空文字でも成立する)。 */
  it("(検出器の自己点検) readCode はコメントだけを落とし、コードは残す", () => {
    const board = readCode("components/account/favorites-board.tsx");
    expect(board).toContain('"use client"');
    expect(board).toContain("export function FavoritesBoard");
    expect(board).not.toContain("なぜクライアント側なのか");
  });
});

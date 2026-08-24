import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FAVORITES_KIND_LIMIT,
  FAVORITE_CONTINUE_ORDER,
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
        raw({ id: "c", type: "farmer" }),
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

  it("抜粋の並びはすべての種類を含む (新しい種類が黙って漏れない)", () => {
    expect([...FAVORITE_CONTINUE_ORDER].sort()).toEqual([...FAVORITE_KINDS].sort());
    // 確定版の 1 枚目は読みもの。
    expect(FAVORITE_CONTINUE_ORDER[0]).toBe("article");
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

describe("お気に入り一覧ページ", () => {
  const page = read("app/[locale]/account/favorites/page.tsx");

  it("ログインしていない人には一覧を組まない", () => {
    expect(page).toContain("isSignedIn");
    expect(page).toContain("loginRequired");
  });

  it("識別子をクライアントへ渡さない (渡すのは正規化済みの一覧だけ)", () => {
    expect(page).not.toMatch(/userKey=\{/);
    expect(page).toContain("<FavoritesBoard groups={groups} />");
  });

  it("マイページ本体の「すべて見る」がこのページを指している", () => {
    expect(read("app/[locale]/account/page.tsx")).toContain('href: "/account/favorites"');
  });
});

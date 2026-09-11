import { describe, it, expect, vi } from "vitest";
import {
  planNotionUpsert,
  upsertFromNotion,
  type SanityDocLike,
} from "../scripts/lib/sanity-upsert";

/**
 * 2026-08-22 の本番事故の回帰テスト。
 *
 * 記事同期が `createOrReplace` を使っていたため、Notion 台帳に無い
 * フィールド (Studio でしか編集しない audioUrl / category / tags /
 * author / relatedProducts / seo.metaTitle) が毎時の同期で消えていた。
 *
 * ここで守りたい性質はひとつだけ:
 *   **doc に載っていないフィールドは、書き込みの対象に入らない。**
 */

/** 本番の記事同期が組み立てるのと同じ形の doc (Notion 由来のみ) */
function notionArticleDoc(): SanityDocLike {
  return {
    _id: "notion-tsushima-oishi-farm-interview",
    _type: "article",
    title: "生産者インタビュー：つしま大石農園",
    slug: { _type: "slug", current: "tsushima-oishi-farm-interview" },
    excerpt: "つしま大石農園を訪ねた。",
    body: [{ _type: "block", _key: "a", children: [] }],
    language: "ja",
    memberOnly: false,
    featured: false,
    publishedAt: "2026-08-01T00:00:00.000Z",
    seo: { metaDescription: "つしま大石農園のインタビュー" },
  };
}

/** Studio 側でしか持たないフィールド (同期は絶対に触ってはいけない) */
const STUDIO_ONLY_FIELDS = [
  "audioUrl",
  "audioVideoUrl",
  "cta",
  "orderNumber",
  "requiredTier",
  "contentPersona",
  "depthLevel",
  "targetLayer",
  "publishedAtDesc",
];

/**
 * Notion 側が空でも Sanity には値がある関係フィールド。
 * 実データでは tag-articles.ts と Studio が入れており、Notion は空を返す。
 */
const SCRIPT_OWNED_RELATION_FIELDS = [
  "category",
  "tags",
  "author",
  "relatedProducts",
];

describe("planNotionUpsert", () => {
  it("doc に無い Studio 専用フィールドを set にも setIfMissing にも含めない", () => {
    const plan = planNotionUpsert(notionArticleDoc());
    const touched = [
      ...Object.keys(plan.set),
      ...Object.keys(plan.setIfMissing),
    ];

    for (const field of STUDIO_ONLY_FIELDS) {
      expect(
        touched.some((k) => k === field || k.startsWith(`${field}.`)),
        `${field} に触れてはいけない`
      ).toBe(false);
    }
  });

  it("Notion が値を返さなかった関係フィールドを消しにいかない", () => {
    // 実際の Notion Content Hub は category/tags/author/relatedProducts を
    // 返さない。呼び出し側が doc から省くので、ここにも現れてはならない。
    const plan = planNotionUpsert(notionArticleDoc());
    const touched = [
      ...Object.keys(plan.set),
      ...Object.keys(plan.setIfMissing),
    ];

    for (const field of SCRIPT_OWNED_RELATION_FIELDS) {
      expect(touched).not.toContain(field);
    }
  });

  it("createIfNotExists は _id と _type だけの骨組みにする", () => {
    const plan = planNotionUpsert(notionArticleDoc());
    expect(plan.createIfNotExists).toEqual({
      _id: "notion-tsushima-oishi-farm-interview",
      _type: "article",
    });
  });

  it("Notion 由来のフィールドはちゃんと set に入る", () => {
    const plan = planNotionUpsert(notionArticleDoc());
    expect(plan.set.title).toBe("生産者インタビュー：つしま大石農園");
    expect(plan.set.excerpt).toBe("つしま大石農園を訪ねた。");
    expect(plan.set.language).toBe("ja");
    expect(plan.set.featured).toBe(false);
  });

  it("seo はドットパスに展開して metaTitle / ogImage を巻き込まない", () => {
    const plan = planNotionUpsert(notionArticleDoc());

    // 同期が書くのは metaDescription だけ
    expect(plan.set["seo.metaDescription"]).toBe(
      "つしま大石農園のインタビュー"
    );
    // seo を丸ごと置き換えていない (これをやると metaTitle が消える)
    expect(plan.set.seo).toBeUndefined();
    // 親が無い場合に備える
    expect(plan.setIfMissing.seo).toEqual({});
  });

  it("_type を持つ値 (slug / image / reference) は丸ごと置き換える", () => {
    const doc = notionArticleDoc();
    doc.mainImage = { _type: "image", asset: { _ref: "image-abc" }, alt: "a" };
    doc.category = { _type: "reference", _ref: "notion-category-farm" };
    const plan = planNotionUpsert(doc);

    expect(plan.set.slug).toEqual({
      _type: "slug",
      current: "tsushima-oishi-farm-interview",
    });
    expect(plan.set.mainImage).toEqual({
      _type: "image",
      asset: { _ref: "image-abc" },
      alt: "a",
    });
    expect(plan.set.category).toEqual({
      _type: "reference",
      _ref: "notion-category-farm",
    });
    // ドットパスに割られていないこと
    expect(plan.set["slug.current"]).toBeUndefined();
    expect(plan.set["category._ref"]).toBeUndefined();
  });

  it("配列は丸ごと置き換える", () => {
    const doc = notionArticleDoc();
    doc.tags = [{ _type: "reference", _ref: "notion-tag-farm", _key: "k1" }];
    const plan = planNotionUpsert(doc);
    expect(plan.set.tags).toEqual([
      { _type: "reference", _ref: "notion-tag-farm", _key: "k1" },
    ]);
  });

  it("undefined のフィールドは触らない", () => {
    const doc = notionArticleDoc();
    doc.excerpt = undefined;
    const plan = planNotionUpsert(doc);
    expect("excerpt" in plan.set).toBe(false);
  });

  it("中身が空のオブジェクトは親だけ作らない", () => {
    const doc = notionArticleDoc();
    doc.seo = {};
    const plan = planNotionUpsert(doc);
    expect(plan.setIfMissing.seo).toBeUndefined();
  });

  it("_id / _type が無ければ落とす", () => {
    expect(() =>
      planNotionUpsert({ _type: "article" } as unknown as SanityDocLike)
    ).toThrow(/_id/);
    expect(() =>
      planNotionUpsert({ _id: "x" } as unknown as SanityDocLike)
    ).toThrow(/_type/);
  });
});

describe("upsertFromNotion", () => {
  function makeClient() {
    const commit = vi.fn().mockResolvedValue({});
    const patchObj: Record<string, unknown> = { commit };
    patchObj.set = vi.fn(() => patchObj);
    patchObj.setIfMissing = vi.fn(() => patchObj);
    const client = {
      createIfNotExists: vi.fn().mockResolvedValue({}),
      patch: vi.fn(() => patchObj),
    };
    return { client, patchObj, commit };
  }

  it("createOrReplace を呼ばず createIfNotExists + patch で書く", async () => {
    const { client, patchObj, commit } = makeClient();
    await upsertFromNotion(client as never, notionArticleDoc());

    expect(client.createIfNotExists).toHaveBeenCalledWith({
      _id: "notion-tsushima-oishi-farm-interview",
      _type: "article",
    });
    expect(client.patch).toHaveBeenCalledWith(
      "notion-tsushima-oishi-farm-interview"
    );
    expect(patchObj.setIfMissing).toHaveBeenCalledWith({ seo: {} });
    expect(commit).toHaveBeenCalledOnce();

    // 事故の本体。client にこのメソッドを生やしていないので、
    // 呼ばれていたらそもそも落ちるが、意図として明示しておく。
    expect(client).not.toHaveProperty("createOrReplace");
  });

  it("patch の set に Studio 専用フィールドが一切現れない", async () => {
    const { client, patchObj } = makeClient();
    await upsertFromNotion(client as never, notionArticleDoc());

    const setArg = (patchObj.set as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    for (const field of [
      ...STUDIO_ONLY_FIELDS,
      ...SCRIPT_OWNED_RELATION_FIELDS,
    ]) {
      expect(Object.keys(setArg)).not.toContain(field);
    }
  });

  it("書くものが無ければ patch を投げない", async () => {
    const { client } = makeClient();
    await upsertFromNotion(client as never, {
      _id: "notion-category-farm",
      _type: "category",
    });
    expect(client.createIfNotExists).toHaveBeenCalledOnce();
    expect(client.patch).not.toHaveBeenCalled();
  });
});

describe("同期スクリプト本体", () => {
  it("sync-notion-to-sanity.ts に createOrReplace が残っていない", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../scripts/sync-notion-to-sanity.ts"),
      "utf8"
    );
    // コメント中の言及 (事故の説明) は許すが、実際の呼び出しは禁止。
    const calls = src.match(/\.createOrReplace\s*\(/g) ?? [];
    expect(calls).toHaveLength(0);
  });
});

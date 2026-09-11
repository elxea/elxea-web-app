/**
 * Sanity の SEO 設定が本当に `<title>` / `<meta name="description">` に出るかを
 * 固定する検査。
 *
 * ## 何が壊れていたのか
 *
 * `sanity/schemas/seo.ts` のフィールド名は `metaTitle` / `metaDescription` /
 * `ogImage`。ところが詳細ページ 3 本 (tea-menu / journal / elxea-journal) は
 * `seo?.title` / `seo?.description` を読んでいた。スキーマに無い名前なので
 * 値は常に undefined になり、編集者が Sanity で SEO を入れても head には
 * 一切出ない。さらに別の 3 本 (farmers / events / pages) は GROQ で `seo` を
 * 取得しているのに generateMetadata が一度も読んでいなかった。症状は同じ。
 *
 * ## なぜ型検査でも lint でも落ちなかったのか
 *
 * 各ページが `seo?: { title?: string; description?: string }` という
 * **実体と違うローカル型**を自前で宣言していたため、綴りのずれが型の中で
 * 閉じていた。値が無いときは元のタイトルに落ちるので画面も自然に見える。
 * 「設定したのに効かない」が、どこも赤くならないまま成立していた。
 *
 * ## この検査の作り
 *
 * 素朴に「`metaTitle` を渡したら `metaTitle` が出た」と書くと、コードと
 * テストが揃って間違っていても通ってしまう (同語反復)。そうならないよう、
 * **fixture のキーをスキーマファイルそのものから取り出す**:
 *
 *   1. `sanity/schemas/seo.ts` を TypeScript の AST で読み、`defineField` の
 *      name を実測する (= 唯一の正本)
 *   2. その名前で fixture を組み立てる
 *   3. `seo` を持つ document 型を描く全ページの `generateMetadata` を実際に
 *      呼び、返ってきた `Metadata.title` / `Metadata.description` が
 *      fixture の値になっていることを見る
 *
 * スキーマ側の名前が変われば 1 で落ち、ページ側が違う名前を読めば 3 で落ちる。
 * (Next は `Metadata.title` を `<title>`、`Metadata.description` を
 * `<meta name="description">` として出力する。ここで押さえているのはその手前、
 * ページが head に渡す値そのもの。)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, it, expect, vi, beforeEach } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// ページが引く外部依存。head の値だけを見たいので最小限に差し替える。
// ---------------------------------------------------------------------------

/** 各テストが「Sanity から返ってきたこと」にしたい document。 */
let fetched: unknown = null;

vi.mock("next-intl/server", () => ({
  getLocale: async () => "ja",
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  redirect: () => {},
  usePathname: () => "/",
  useRouter: () => ({}),
  getPathname: () => "/",
}));

vi.mock("@/sanity/lib/fetch", () => ({
  sanityFetch: vi.fn(async () => fetched),
}));

/** 画像 URL の組み立ては本件と無関係。実 asset を持たない fixture で落とさない。 */
vi.mock("@/sanity/lib/image", () => ({
  urlFor: () => ({
    width: () => ({
      height: () => ({ url: () => "https://example.invalid/i.jpg" }),
      url: () => "https://example.invalid/i.jpg",
    }),
  }),
}));

// ---------------------------------------------------------------------------
// 1. 正本 = スキーマファイルから実測したフィールド名
// ---------------------------------------------------------------------------

/** `sanity/schemas/seo.ts` の `defineField({ name: "..." })` を AST で拾う。 */
function seoSchemaFieldNames(): string[] {
  const file = path.join(REPO_ROOT, "sanity/schemas/seo.ts");
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineField" &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === "name" &&
          ts.isStringLiteralLike(prop.initializer)
        ) {
          names.push(prop.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

const SCHEMA_FIELDS = seoSchemaFieldNames();

/** fixture の値。fixture の **キー** はスキーマ実測から作るので手で書かない。 */
const SEO_TITLE = "スキーマ由来のメタタイトル";
const SEO_DESCRIPTION = "スキーマ由来のメタディスクリプション";

/** スキーマの 1 番目 = タイトル、2 番目 = ディスクリプションの欄。 */
const [TITLE_FIELD, DESCRIPTION_FIELD] = SCHEMA_FIELDS;

function seoFixture(): Record<string, string> {
  return { [TITLE_FIELD]: SEO_TITLE, [DESCRIPTION_FIELD]: SEO_DESCRIPTION };
}

describe("sanity/schemas/seo.ts が SEO フィールド名の正本である", () => {
  it("欄は metaTitle / metaDescription / ogImage の 3 つ", () => {
    expect(SCHEMA_FIELDS).toEqual(["metaTitle", "metaDescription", "ogImage"]);
  });

  it("`title` / `description` という欄は存在しない (死に参照の再発を止める)", () => {
    expect(SCHEMA_FIELDS).not.toContain("title");
    expect(SCHEMA_FIELDS).not.toContain("description");
  });
});

// ---------------------------------------------------------------------------
// 2. ヘルパー単体
// ---------------------------------------------------------------------------

describe("lib/seo/sanity-seo", () => {
  it("スキーマ実測の欄名で値を読む", async () => {
    const { seoTitle, seoDescription } = await import("@/lib/seo/sanity-seo");
    const seo = seoFixture();
    expect(seoTitle(seo, "既定")).toBe(SEO_TITLE);
    expect(seoDescription(seo, "既定")).toBe(SEO_DESCRIPTION);
  });

  it("未設定・空文字は既定値に落ちる (既存表示を壊さない)", async () => {
    const { seoTitle, seoDescription } = await import("@/lib/seo/sanity-seo");
    expect(seoTitle(undefined, "既定")).toBe("既定");
    expect(seoTitle({ metaTitle: "   " }, "既定")).toBe("既定");
    expect(seoDescription(undefined, "既定")).toBe("既定");
    expect(seoDescription({ metaDescription: "" }, "既定")).toBe("既定");
    expect(seoDescription(undefined, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. `seo` を持つ document 型を描く全ページの generateMetadata
// ---------------------------------------------------------------------------

/**
 * `type: "seo"` を持つ Sanity document 型は 6 つ
 * (article / event / farmer / journal / page / teaMenu)。それぞれを描く
 * 詳細ページを 1 本ずつ押さえる。1 本でも欄名を間違えれば、その行が落ちる。
 */
const PAGES: Array<{
  /** 見出しに出す名前 */
  label: string;
  /** page.tsx のモジュール指定子 */
  module: string;
  /** SEO 未設定のときに使われる既定タイトル */
  fallbackTitle: string;
  /** `seo` 抜きの document (既定タイトルが出ることの確認に使う) */
  doc: Record<string, unknown>;
}> = [
  {
    label: "teaMenu — tea-menu/[slug]",
    module: "@/app/[locale]/(reading)/tea-menu/[slug]/page",
    fallbackTitle: "煎茶 やぶきた",
    doc: { displayName: "煎茶 やぶきた", description: "既定の説明文" },
  },
  {
    label: "article — journal/[slug]",
    module: "@/app/[locale]/(reading)/journal/[slug]/page",
    fallbackTitle: "記事の見出し",
    doc: { title: "記事の見出し", excerpt: "既定の抜粋" },
  },
  {
    label: "journal — elxea-journal/[slug]",
    module: "@/app/[locale]/(reading)/elxea-journal/[slug]/page",
    fallbackTitle: "ジャーナルの見出し",
    doc: { title: "ジャーナルの見出し", summary: "既定の要約" },
  },
  {
    label: "farmer — farmers/[slug]",
    module: "@/app/[locale]/(reading)/farmers/[slug]/page",
    fallbackTitle: "生産者の名前",
    doc: { name: "生産者の名前", role: "茶農家", meta: "既定のひとこと" },
  },
  {
    label: "event — events/[slug]",
    module: "@/app/[locale]/events/[slug]/page",
    fallbackTitle: "催しの名前",
    doc: { title: "催しの名前", location: "京都" },
  },
  {
    label: "page — pages/[slug]",
    module: "@/app/[locale]/pages/[slug]/page",
    fallbackTitle: "汎用ページの見出し",
    doc: { title: "汎用ページの見出し" },
  },
];

/** 架空コンテンツの deny-list に当たらない slug (当たると head が空で返る)。 */
const SLUG = "seo-metadata-fixture";

type MetadataLike = { title?: unknown; description?: unknown };

async function metadataOf(moduleId: string): Promise<MetadataLike> {
  const mod: {
    generateMetadata: (args: {
      params: Promise<{ slug: string }>;
    }) => Promise<MetadataLike>;
  } = await import(/* @vite-ignore */ moduleId);
  return mod.generateMetadata({ params: Promise.resolve({ slug: SLUG }) });
}

describe("Sanity の SEO 設定が head に出る", () => {
  beforeEach(() => {
    fetched = null;
  });

  it.each(PAGES)("$label — metaTitle / metaDescription が反映される", async (page) => {
    fetched = { ...page.doc, seo: seoFixture() };
    const meta = await metadataOf(page.module);
    expect(meta.title).toBe(SEO_TITLE);
    expect(meta.description).toBe(SEO_DESCRIPTION);
  });

  it.each(PAGES)("$label — SEO 未設定なら既定タイトルのまま", async (page) => {
    fetched = { ...page.doc };
    const meta = await metadataOf(page.module);
    expect(meta.title).toBe(page.fallbackTitle);
    expect(meta.title).not.toBe(SEO_TITLE);
  });
});

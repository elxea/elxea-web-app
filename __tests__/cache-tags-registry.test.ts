/**
 * 憲章 Wave 2「Sanity 境界とキャッシュの対化」の突合テスト。
 *
 * キャッシュの名札は **貼る側と剥がす側が揃って初めて機能する**。片側だけでも
 * 型検査は通り、lint も通り、webhook は 200 を返す — そして本番だけが更新され
 * ない。実際 2026-08-27 の実測で、Sanity の読み取り 60 か所のうち名札を貼って
 * いた箇所は 0 で、その裏で `revalidateTag` は毎回空振りしていた。
 *
 * つまりこの欠陥は「どこかが赤くなる」形では現れない。**対応が取れているか**を
 * 明示的に照合する検査を置かない限り、同じ状態に戻っても誰も気づけない。
 *
 * 検査は 5 本。それぞれ、対になっている装置の片側が欠けたときに落ちる:
 *
 *   1. 貼る側の存在 — 宣言された名札に、実際にそれを貼っている読み取りがあるか
 *   2. 剥がす側の存在 — 宣言された名札に、それを捨てる webhook の行があるか
 *   3. `revalidateTag` の引数 — レジストリに実在する名札しか渡っていないか
 *   4. ドキュメント型の整合 — GROQ が読む `_type` が全て表に載っているか / 表に
 *      死んだ行が無いか
 *   5. ゲートウェイの迂回 — `app/**` が Sanity の client を直接掴んでいないか
 *
 * 走査は TypeScript の AST で行う (正規表現だとコメントや文字列の中の一致を
 * 拾ってしまい、「検査しているつもり」になる)。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  CACHE_TAGS,
  SANITY_DOCUMENT_TYPES,
  SANITY_TYPE_TO_TAGS,
  type CacheTag,
} from "@/lib/cache/tags";
import { sanityFetch } from "@/sanity/lib/fetch";

const ROOT = path.resolve(__dirname, "..");

/** 走査対象。`sanity/lib` はゲートウェイとクエリの正本なので含める。 */
const SCAN_DIRS = ["app", "lib", "sanity"];

/** 走査から外す枝 (生成物・テスト・ストーリー)。 */
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "__tests__", "__fixtures__"]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|stories)\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

const SOURCE_FILES = SCAN_DIRS.flatMap((d) => collectSourceFiles(path.join(ROOT, d)));

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

interface Scan {
  /** `cache: { tag: "..." }` として書かれた名札 -> 書かれているファイル */
  appliedTags: Map<string, string[]>;
  /** `revalidateTag("...")` に文字列リテラルで渡された値 */
  revalidateLiterals: { value: string; file: string }[];
  /** GROQ の `_type == "..."` に出てくるドキュメント型 */
  documentTypes: Map<string, string[]>;
  /** `@/sanity/lib/client` を import しているファイル (static / dynamic 両方) */
  clientImporters: string[];
}

/** GROQ 文字列から `_type == "x"` を拾う。走査対象は文字列リテラルの中身のみ。 */
const TYPE_EQ = /_type\s*==\s*"([A-Za-z0-9_]+)"/g;

function scan(): Scan {
  const result: Scan = {
    appliedTags: new Map(),
    revalidateLiterals: [],
    documentTypes: new Map(),
    clientImporters: [],
  };

  const record = (map: Map<string, string[]>, key: string, file: string) => {
    const rel = path.relative(ROOT, file);
    const list = map.get(key);
    if (list) {
      if (!list.includes(rel)) list.push(rel);
    } else {
      map.set(key, [rel]);
    }
  };

  for (const file of SOURCE_FILES) {
    const sf = parse(file);
    const rel = path.relative(ROOT, file);

    const visit = (node: ts.Node): void => {
      // (1) `cache: { tag: "..." }` — 名札を貼っている箇所
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "tag" &&
        ts.isStringLiteralLike(node.initializer)
      ) {
        record(result.appliedTags, node.initializer.text, file);
      }

      // (3) `revalidateTag(...)` の第 1 引数が文字列リテラルなら記録する
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "revalidateTag" &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        result.revalidateLiterals.push({
          value: (node.arguments[0] as ts.StringLiteralLike).text,
          file: rel,
        });
      }

      // (4) 文字列 / テンプレートリテラルの中の GROQ
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text;
        if (text.includes("_type")) {
          TYPE_EQ.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = TYPE_EQ.exec(text)) !== null) {
            record(result.documentTypes, m[1], file);
          }
        }
      }

      // (5) Sanity client の直接 import (static / dynamic)
      // `./client` は `sanity/lib` 配下から書かれたときだけ Sanity の client を
      // 指す (`lib/shopify/index.ts` の `./client` は別物)。
      const insideSanityLib = rel.startsWith("sanity/lib/");
      const isClientModule = (spec: ts.Expression | undefined) =>
        spec !== undefined &&
        ts.isStringLiteralLike(spec) &&
        (spec.text === "@/sanity/lib/client" || (insideSanityLib && spec.text === "./client"));
      if (ts.isImportDeclaration(node) && isClientModule(node.moduleSpecifier)) {
        if (!result.clientImporters.includes(rel)) result.clientImporters.push(rel);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        isClientModule(node.arguments[0])
      ) {
        if (!result.clientImporters.includes(rel)) result.clientImporters.push(rel);
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return result;
}

const SCAN = scan();

/** 剥がす側の表に現れる名札の集合。 */
const INVALIDATED_TAGS = new Set<string>(
  Object.values(SANITY_TYPE_TO_TAGS).flatMap((tags) => [...tags])
);

describe("cache tag registry — 貼る側と剥がす側の突合", () => {
  it("走査が空振りしていない (検査自体が動いている証拠)", () => {
    // 走査対象が 0 件だと、以下の検査は全て「該当なしで合格」になる。
    // 検査が沈黙で通ることを許さないための番人。
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(SCAN.appliedTags.size).toBeGreaterThan(0);
    expect(SCAN.documentTypes.size).toBeGreaterThan(0);
  });

  it("宣言された名札には必ず貼っている読み取りがある", () => {
    const orphans = CACHE_TAGS.filter((tag) => !SCAN.appliedTags.has(tag));
    expect(
      orphans,
      `貼る側の無い名札: ${orphans.join(", ")}\n` +
        "sanityFetch({ cache: { tag: ... } }) で実際に使うか、レジストリから消すこと。"
    ).toEqual([]);
  });

  it("貼られている名札はすべてレジストリの語彙にある", () => {
    const known = new Set<string>(CACHE_TAGS);
    const unknown = [...SCAN.appliedTags.entries()].filter(([tag]) => !known.has(tag));
    expect(
      unknown.map(([tag, files]) => `${tag} (${files.join(", ")})`),
      "レジストリに無い名札が貼られている"
    ).toEqual([]);
  });

  it("宣言された名札には必ず剥がす呼び手がある", () => {
    const orphans = CACHE_TAGS.filter((tag) => !INVALIDATED_TAGS.has(tag));
    expect(
      orphans,
      `剥がす側の無い名札: ${orphans.join(", ")}\n` +
        "SANITY_TYPE_TO_TAGS のどれかの行に載せること (載らない名札は永久に消えない)。"
    ).toEqual([]);
  });

  it("revalidateTag に渡る文字列リテラルはレジストリに実在する", () => {
    const known = new Set<string>(CACHE_TAGS);
    const bad = SCAN.revalidateLiterals.filter((r) => !known.has(r.value));
    expect(
      bad.map((r) => `${r.value} (${r.file})`),
      "レジストリに無い名札を revalidateTag に渡している (= 確実に空振りする)"
    ).toEqual([]);
  });

  it("webhook 受け口は名札をレジストリ経由でしか取らない", () => {
    // `revalidateTag("article")` のようなベタ書きに戻っていないこと。
    // 上の検査は「実在するか」だけを見るので、たまたま実在する名札を直書き
    // されると通ってしまう。ここは経路そのものを固定する。
    const route = readFileSync(path.join(ROOT, "app/api/revalidate/route.ts"), "utf8");
    expect(route).toContain("tagsForSanityType");
    expect(
      SCAN.revalidateLiterals.filter((r) => r.file === "app/api/revalidate/route.ts")
    ).toEqual([]);
  });
});

describe("cache tag registry — Sanity のドキュメント型との整合", () => {
  it("GROQ が読むドキュメント型はすべてレジストリに載っている", () => {
    const known = new Set<string>(SANITY_DOCUMENT_TYPES);
    const missing = [...SCAN.documentTypes.entries()].filter(([t]) => !known.has(t));
    expect(
      missing.map(([t, files]) => `${t} (${files.join(", ")})`),
      "アプリが読んでいるのに webhook の対応表に無いドキュメント型 " +
        "(= その型の更新は永久に反映されない)"
    ).toEqual([]);
  });

  it("レジストリに死んだドキュメント型の行が無い", () => {
    const used = new Set(SCAN.documentTypes.keys());
    const dead = SANITY_DOCUMENT_TYPES.filter((t) => !used.has(t));
    expect(
      dead,
      `どの GROQ からも読まれていないドキュメント型: ${dead.join(", ")}\n` +
        "表に残すと『対応済み』に見えるが実体が無い。読む側を足すか行を消すこと。"
    ).toEqual([]);
  });

  it("対応表の網羅とタグの実在", () => {
    for (const type of SANITY_DOCUMENT_TYPES) {
      const tags = SANITY_TYPE_TO_TAGS[type];
      expect(tags.length, `${type} に剥がす名札が 1 つも無い`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(CACHE_TAGS as readonly string[]).toContain(tag);
      }
    }
  });
});

describe("Sanity 読み取りゲートウェイの迂回", () => {
  it("app/ から Sanity の client を直接 import していない", () => {
    const bypass = SCAN.clientImporters.filter((f) => f.startsWith("app/"));
    expect(
      bypass,
      "sanityFetch を迂回して client を掴んでいる " +
        "(キャッシュ指定の型強制がまるごと外れる)"
    ).toEqual([]);
  });

  it("client を import してよいのは sanity/lib 配下の 2 本だけ", () => {
    // `fetch.ts` = 読み取りゲートウェイ (本体)。
    // `image.ts` = `imageUrlBuilder` に client の設定 (projectId / dataset) を
    //   渡すだけの利用で、GROQ を投げないのでキャッシュの対象外。
    // これ以外が増えたら、それは新しい読み取り経路が生えたということ。
    expect(SCAN.clientImporters.sort()).toEqual([
      "sanity/lib/fetch.ts",
      "sanity/lib/image.ts",
    ]);
  });
});

describe("sanityFetch のキャッシュ指定は型で必須", () => {
  /**
   * ここはランタイムの検査ではなく **型の検査**。`pnpm typecheck` (tsc) が
   * `__tests__/**` も対象にしているので、`@ts-expect-error` が「実際にエラーに
   * なる」ことを tsc が確かめる。要求が緩んで **エラーでなくなった瞬間**、
   * 未使用の `@ts-expect-error` として tsc が落ちる — 逆向きにも効く番人。
   */
  it("cache を省略した呼び出しはコンパイルできない", () => {
    const call = () =>
      // @ts-expect-error cache は必須。省略できるようになったらこの行が落ちる。
      sanityFetch({ query: "*[_type == \"article\"]" });
    expect(typeof call).toBe("function");
  });

  it("レジストリに無い名札は指定できない", () => {
    const call = () =>
      sanityFetch({
        query: "*[_type == \"article\"]",
        // @ts-expect-error 語彙外の名札。CacheTag に無い文字列は受け付けない。
        cache: { tag: "sanity:not-a-real-tag" },
      });
    expect(typeof call).toBe("function");
  });

  it("tag と noStore は同時に指定できない", () => {
    const call = () =>
      sanityFetch({
        query: "*[_type == \"article\"]",
        // @ts-expect-error 排他。両方立てるのは意図が矛盾している。
        cache: { tag: "sanity:articles", noStore: true },
      });
    expect(typeof call).toBe("function");
  });

  it("CacheTag の値はレジストリの要素だけを取る", () => {
    const tag: CacheTag = "sanity:articles";
    expect(CACHE_TAGS as readonly string[]).toContain(tag);
  });
});

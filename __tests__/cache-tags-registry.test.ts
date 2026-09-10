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
  SANITY_TYPE_TO_OWN_TAG,
  SANITY_TYPE_TO_TAGS,
  type CacheTag,
  type SanityDocumentType,
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

/**
 * import 指定子を **リポジトリ相対のモジュールパス**に正規化する。
 *
 * - `@/x/y` … tsconfig の `paths` により リポジトリ直下からの `x/y`
 * - `./x` `../x` … 書いたファイルの位置から解決
 * - それ以外 (`next-sanity` 等の bare specifier) … 対象外なので `null`
 *
 * `path.posix.normalize` が `/./` と `/../` を畳むので、`sanity/lib/./client`
 * も `sanity/lib/../lib/client` も同じ答えに落ちる。判定は「解決結果が
 * `sanity/lib/client` か」だけで済み、綴りの数え上げが不要になる。
 */
function resolveToRepoPath(specifier: string, importerRel: string): string | null {
  if (specifier.startsWith("@/")) {
    return path.posix.normalize(specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    const dir = path.posix.dirname(importerRel.split(path.sep).join("/"));
    return path.posix.normalize(path.posix.join(dir, specifier));
  }
  return null;
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
      // Sanity の client を指す import かどうか。
      //
      // **綴りを 1 つだけ見る検査は、綴りを変えれば通るので検査にならない**
      // (QA 指摘 2026-08-27 / 2 回)。同じモジュールを指す書き方は複数ある:
      //
      //   @/sanity/lib/client          別名
      //   ../../sanity/lib/client      相対
      //   ../sanity/lib/./client       dot-segment
      //   ../sanity/lib/../lib/client  `..` の往復
      //   ./client                     sanity/lib 配下から書いたとき
      //
      // Node も TypeScript もこれらを**正規化**して同じモジュールに解決する。
      // だから検査も文字列一致ではなく **同じ正規化を通してから**照合する。
      // 相対指定は書いたファイルの位置から解決してリポジトリ相対に直すので、
      // どれだけ遠回りな綴りでも 1 つの答え (`sanity/lib/client`) に落ちる。
      const isClientModule = (spec: ts.Expression | undefined) => {
        if (spec === undefined || !ts.isStringLiteralLike(spec)) return false;
        return resolveToRepoPath(spec.text, rel) === "sanity/lib/client";
      };
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

/* ------------------------------------------------------------------ *
 * 参照展開の意味的な欠落を捕まえる (QA 指摘 / 2026-08-27)
 *
 * 最初の扇形の表は「その型を主役にするページ」しか見ておらず、**参照されて
 * 他の型のページの中に描かれている**ぶんを 8 辺取りこぼしていた。目視で足すと
 * 同じ取りこぼしを繰り返すので、必要な辺を **スキーマと GROQ から導出**する。
 *
 *   1. `sanity/schemas/*.ts` から「どの型のどのフィールドが、どの型を参照するか」
 *   2. `sanity/lib/queries.ts` から「どの型を主役にするクエリが、どのフィールドを
 *      `->` で展開しているか」「どの型を入れ子で数えているか」
 *   3. 1 と 2 を突き合わせて「A のページには B の中身が出る」という辺を得る
 *   4. その辺ごとに `SANITY_TYPE_TO_TAGS[B]` が `SANITY_TYPE_TO_OWN_TAG[A]` を
 *      含むことを要求する
 *
 * Studio 側で参照フィールドを 1 本足してクエリで展開した時点で、検査が扇形の
 * 更新を要求する。手で書いた表どうしの突き合わせではないのが要点。
 * ------------------------------------------------------------------ */

/** `${docType}.${fieldName}` -> 参照先のドキュメント型 */
function scanSchemaReferences(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dir = path.join(ROOT, "sanity/schemas");
  const knownTypes = new Set<string>(SANITY_DOCUMENT_TYPES);

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".ts")) continue;
    const docType = entry.replace(/\.ts$/, "");
    // スキーマファイル名 = ドキュメント型名。文書型でないもの (blockContent /
    // seo / index) はここで落ちる。
    if (!knownTypes.has(docType)) continue;

    const sf = parse(path.join(dir, entry));

    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const nameProp = node.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === "name" &&
            ts.isStringLiteralLike(p.initializer)
        );
        if (nameProp) {
          const fieldName = (nameProp.initializer as ts.StringLiteralLike).text;
          const text = node.getText(sf);
          if (text.includes('"reference"') || text.includes("'reference'")) {
            const targets = new Set<string>();
            for (const m of text.matchAll(/to:\s*\[\s*\{\s*type:\s*["']([A-Za-z0-9_]+)["']/g)) {
              if (knownTypes.has(m[1])) targets.add(m[1]);
            }
            if (targets.size > 0) out.set(`${docType}.${fieldName}`, [...targets]);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return out;
}

interface DependencyEdge {
  /** このページ (主役の型) に */
  owner: SanityDocumentType;
  /** この型の中身が出る */
  dependency: SanityDocumentType;
  /** 根拠 (クエリ名 + 経路) */
  why: string;
}

function scanQueryDependencies(schemaRefs: Map<string, string[]>): DependencyEdge[] {
  const source = readFileSync(path.join(ROOT, "sanity/lib/queries.ts"), "utf8");
  const known = new Set<string>(SANITY_DOCUMENT_TYPES);
  const edges: DependencyEdge[] = [];

  for (const block of source.matchAll(/export const (\w+) = groq`([\s\S]*?)`/g)) {
    const [, queryName, body] = block;

    const typesInBody = [...body.matchAll(/_type\s*==\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    const owner = typesInBody[0];
    if (!owner || !known.has(owner)) continue;

    // (a) `field->` / `field[]->` の参照展開。参照先はスキーマが決める。
    for (const m of body.matchAll(/([A-Za-z0-9_]+)\s*(?:\[\])?\s*->/g)) {
      const field = m[1];
      const targets = schemaRefs.get(`${owner}.${field}`);
      if (!targets) continue; // スキーマに無いフィールドは判断材料が無いので数えない
      for (const dependency of targets) {
        edges.push({
          owner: owner as SanityDocumentType,
          dependency: dependency as SanityDocumentType,
          why: `${queryName} が ${owner}.${field}-> を展開`,
        });
      }
    }

    // (b) 入れ子の `_type == "..."` (件数の埋め込み等)。
    for (const t of typesInBody.slice(1)) {
      if (!known.has(t) || t === owner) continue;
      edges.push({
        owner: owner as SanityDocumentType,
        dependency: t as SanityDocumentType,
        why: `${queryName} が入れ子で ${t} を数えている`,
      });
    }
  }

  return edges;
}

const SCHEMA_REFS = scanSchemaReferences();
const DEPENDENCY_EDGES = scanQueryDependencies(SCHEMA_REFS);

describe("扇形の網羅 — 参照で他の型のページに描かれるぶん", () => {
  it("スキーマとクエリの走査が空振りしていない", () => {
    // 走査が 0 件になると以下の検査は「該当なしで合格」になる。実測値
    // (2026-08-27) は参照フィールド 10 / 依存辺 40 前後なので、その半分を床にする。
    expect(SCHEMA_REFS.size, "スキーマの参照フィールドが取れていない").toBeGreaterThanOrEqual(5);
    expect(DEPENDENCY_EDGES.length, "依存辺が取れていない").toBeGreaterThanOrEqual(20);
  });

  it("参照される型の更新は、参照する側のページの名札も剥がす", () => {
    const missing: string[] = [];

    for (const edge of DEPENDENCY_EDGES) {
      const requiredTag = SANITY_TYPE_TO_OWN_TAG[edge.owner];
      const invalidates = SANITY_TYPE_TO_TAGS[edge.dependency] as readonly CacheTag[];
      if (!invalidates.includes(requiredTag)) {
        missing.push(
          `${edge.dependency} の更新が "${requiredTag}" を剥がさない ` +
            `(根拠: ${edge.why})`
        );
      }
    }

    expect(
      [...new Set(missing)].sort(),
      "SANITY_TYPE_TO_TAGS に不足している辺がある。" +
        "参照先が変わっても参照元のページが古いまま残る。"
    ).toEqual([]);
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

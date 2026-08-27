/**
 * Wave 4 で宣言した正本が、本物のツリーで**1 箇所だけ**名乗っていることを固定する
 * — 憲章 R5。
 *
 * `scripts/ops/check-sot-registry.mjs` は「同じ concept が 2 箇所にあれば落とす」
 * という一般則を持っている (歯があることは `__tests__/sot-registry.test.ts` が
 * 一時ツリーで確認済み)。ここで見るのはその一般則ではなく、**この 2 つの概念が
 * 実際に宣言されていて、参照側が参照のままである**という具体である。
 *
 * 分けている理由: 一般則のテストは fixture の上で回るので、本物のツリーで
 * 宣言が消えても気づかない。「ルールは動くが、対象が居なくなった」は緑になる。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "components", "scripts", "sanity"];
const SCAN_FILES = ["middleware.ts", "instrumentation.ts"];
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", "storybook-static"]);

/** 宣言: コメント行に `@sot <concept>` だけがある行 (検査スクリプトと同じ形)。 */
const DECLARATION = /^\s*(?:\*|\/\/|#)?\s*@sot\s+([a-z0-9][a-z0-9-]*)\s*$/;
const DECLARATION_ONE_LINE = /^\s*\/\*\*?\s*@sot\s+([a-z0-9][a-z0-9-]*)\s*\*\/\s*$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const f of SCAN_FILES) files.push(path.join(ROOT, f));
  return files;
}

/** concept を宣言しているファイル (リポジトリ相対)。 */
function declarationSites(concept: string): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles()) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("@sot")) continue;
    for (const line of text.split("\n")) {
      const m = line.match(DECLARATION) ?? line.match(DECLARATION_ONE_LINE);
      if (m?.[1] === concept) {
        hits.push(path.relative(ROOT, file).split(path.sep).join("/"));
      }
    }
  }
  return hits;
}

describe.each([
  ["button-component", "components/ui/button.tsx"],
  ["cookie-name-registry", "lib/auth/cookie-names.ts"],
])("@sot %s", (concept, expectedFile) => {
  it(`${expectedFile} が 1 箇所だけで名乗っている`, () => {
    expect(declarationSites(concept)).toEqual([expectedFile]);
  });
});

describe("参照側が参照のままであること", () => {
  it("pill-button は button-component を参照するが、宣言はしない", () => {
    const source = readFileSync(
      path.join(ROOT, "components/ui/pill-button.tsx"),
      "utf8",
    );
    /* 参照は残っている (どちらを使うかの判断規則がここから辿れる)。 */
    expect(source).toContain("@sot button-component");
    /* しかし宣言の形 (行に concept だけ) では書かれていない。
       ここが崩れると「押せるものの正本が 2 つ」に戻る。 */
    const declares = source
      .split("\n")
      .some((line) => (line.match(DECLARATION) ?? line.match(DECLARATION_ONE_LINE))?.[1] === "button-component");
    expect(declares, "pill-button.tsx が button-component を宣言してしまっている").toBe(
      false,
    );
  });

  it("lib/auth/cookies.ts は cookie-name-registry を参照するが、宣言はしない", () => {
    const source = readFileSync(path.join(ROOT, "lib/auth/cookies.ts"), "utf8");
    expect(source).toContain("@sot cookie-name-registry");
    const declares = source
      .split("\n")
      .some((line) => (line.match(DECLARATION) ?? line.match(DECLARATION_ONE_LINE))?.[1] === "cookie-name-registry");
    expect(declares).toBe(false);
  });
});

describe("生成物が最新であること", () => {
  it("docs/sot-registry.md に 2 概念が載っている", () => {
    const registry = readFileSync(path.join(ROOT, "docs/sot-registry.md"), "utf8");
    expect(registry).toContain("`button-component`");
    expect(registry).toContain("`cookie-name-registry`");
    expect(registry).toContain("components/ui/button.tsx");
    expect(registry).toContain("lib/auth/cookie-names.ts");
  });
});

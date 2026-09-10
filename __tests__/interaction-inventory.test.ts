/**
 * 憲章 R9 の**配線 assert** — 台帳の仕組みが本当に繋がっているかを確かめる。
 *
 * 台帳そのものの正しさ (誰がどう応答するか) は e2e が見る。ここが見るのは
 * **仕組みが空回りしていないか**で、R9 が壊れる形は 4 つある:
 *
 *   1. 生成物が実体とずれる (押せるものが増えたのに台帳が古いまま)
 *   2. 未分類が残る (`response` も `exempt` も無い行が通ってしまう)
 *   3. e2e が台帳を読んでいない (台帳に何を書いても検査が変わらない)
 *   4. CI に配線されていない (手元でしか走らない)
 *
 * どれも「ルールは在る・CI は緑・でも何も見ていない」という同じ壊れ方をする。
 * だから **壊した入力で確実に落ちること**を、実際にスクリプトを起動して確かめる
 * (`__tests__/ratchet.test.ts` と同じ作法。リポジトリ本体には触らない)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const GENERATOR = join(REPO, "scripts/ops/generate-interaction-inventory.mjs");
const INVENTORY = join(REPO, "interaction-inventory.json");
const SPEC = join(REPO, "e2e/interaction-response.spec.ts");
const CI = join(REPO, ".github/workflows/ci.yml");

type Row = {
  id: string;
  file: string;
  kind: string;
  name: string;
  response?: string;
  observe?: string[];
  exempt?: string;
  why?: string;
};

const inventory = (): Row[] =>
  JSON.parse(readFileSync(INVENTORY, "utf8")).interactions as Row[];

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** 使い捨ての最小ツリー。本物の app/ を写さない (件数に依存させない)。 */
function tree(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "inventory-")));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [GENERATOR, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const HOST = [
  '"use client";',
  "export function Host() {",
  '  return <button onClick={() => void 0}>押す</button>;',
  "}",
].join("\n");

/* -------------------------------------------------------------------------- */
/* 1. 生成物が実体と同期しているか                                                */
/* -------------------------------------------------------------------------- */

describe("生成物と実体の同期", () => {
  it("本物のリポジトリで --check が通る", () => {
    const result = run(REPO, ["--check"]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("OK");
  });

  it("押せるものを 1 つ足すと落ちる", () => {
    const dir = tree({ "components/host.tsx": HOST });
    expect(run(dir, ["--seed-baseline"]).code).toBe(0);
    expect(run(dir, ["--check"]).code).toBe(0);

    writeFileSync(
      join(dir, "components/host.tsx"),
      HOST.replace("</button>", "</button>\n  ;<button onDoubleClick={() => void 0}>2</button>"),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("台帳に無い操作");
    expect(result.out).toContain("onDoubleClick");
  });

  it("押せるものが消えたのに台帳に残っていると落ちる", () => {
    const dir = tree({ "components/host.tsx": HOST });
    run(dir, ["--seed-baseline"]);
    writeFileSync(join(dir, "components/host.tsx"), '"use client";\nexport const Host = null;');

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("実体が無い操作");
  });

  it("拡張子を .tsx から .ts に移しても台帳から消えない", () => {
    /* 例外表と同じ逃げ方を台帳でも塞ぐ。`.ts` へ動かすだけで監査から消えるなら、
       台帳は「押せるもの全部」ではなくなる。 */
    const dir = tree({
      "components/host.tsx": '"use client";\nimport "./writer";\nexport const H = 1;',
      "components/writer.ts": [
        "export async function save() {",
        '  await fetch("/api/x", { method: "POST" });',
        "}",
      ].join("\n"),
    });
    run(dir, ["--seed-baseline"]);
    const rows = JSON.parse(readFileSync(join(dir, "interaction-inventory.json"), "utf8"))
      .interactions as Row[];
    expect(rows.map((r) => r.id)).toContain("components/writer.ts#write:fetch:POST#1");
  });
});

/* -------------------------------------------------------------------------- */
/* 1b. href を書き換えて自動 exempt を引き継げないか (QA 指摘 HIGH)               */
/* -------------------------------------------------------------------------- */

describe("内部リンクの自動 exempt は href に追随する", () => {
  /**
   * 台帳の id は `file#link:Link#n` で **href を含まない**。
   * よって「別ページへ移るだけ」として自動 exempt になった行の href に後から
   * `?` を足しても id は変わらず、旧 exempt がそのまま引き継がれる。
   * その状態では `--check` が緑のままなので、**網羅表 G6 と同型の操作
   * (クエリでページ内の見た目が変わる遷移) を宣言なしで復活させられた**。
   */
  const linkTree = (href: string) =>
    tree({
      "components/host.tsx": [
        '"use client";',
        "export function Host() {",
        `  return <a href=${JSON.stringify(href)}>行く</a>;`,
        "}",
      ].join("\n"),
    });

  it("静的な別ページ遷移は自動 exempt になる", () => {
    const dir = linkTree("/products");
    expect(run(dir, ["--seed-baseline"]).code).toBe(0);
    const rows = JSON.parse(readFileSync(join(dir, "interaction-inventory.json"), "utf8"))
      .interactions as Row[];
    expect(rows[0].response).toBe("router-nav");
    expect(rows[0].exempt).toContain("別ページへの遷移のみ");
    expect(run(dir, ["--check"]).code).toBe(0);
  });

  it("href にクエリを足すと落ちる (旧 exempt を引き継がない)", () => {
    const dir = linkTree("/products");
    run(dir, ["--seed-baseline"]);
    expect(run(dir, ["--check"]).code).toBe(0);

    /* href だけを書き換える。id は変わらないので、素直に実装すると素通りする。 */
    const host = join(dir, "components/host.tsx");
    writeFileSync(host, readFileSync(host, "utf8").replace('"/products"', '"/products?sort=new"'));

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("自動 exempt が残っている");
  });

  it("href を変数に逃がしても落ちる (安全側 = 分類必須)", () => {
    const dir = linkTree("/products");
    run(dir, ["--seed-baseline"]);

    const host = join(dir, "components/host.tsx");
    writeFileSync(
      host,
      readFileSync(host, "utf8").replace('href="/products"', "href={target}"),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("自動 exempt が残っている");
  });

  it("再生成すると失効した自動 exempt が外れて未分類になる", () => {
    const dir = linkTree("/products");
    run(dir, ["--seed-baseline"]);
    const host = join(dir, "components/host.tsx");
    writeFileSync(host, readFileSync(host, "utf8").replace('"/products"', '"/products?sort=new"'));

    run(dir, []);
    const rows = JSON.parse(readFileSync(join(dir, "interaction-inventory.json"), "utf8"))
      .interactions as Row[];
    expect(rows[0].exempt).toBeUndefined();
    expect(rows[0].response).toBeUndefined();
    /* 宣言を求める状態になっている = 黙って通らない。 */
    expect(run(dir, ["--check"]).code).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 1c. 抽出のすり抜け 5 パターン (QA 指摘 MID-a)                                 */
/* -------------------------------------------------------------------------- */

describe("書き方を変えても台帳から消せない", () => {
  const rowsOf = (dir: string) =>
    (
      JSON.parse(readFileSync(join(dir, "interaction-inventory.json"), "utf8"))
        .interactions as Row[]
    ).map((r) => r.id);

  it("素の要素への spread は 1 行立つ (中身が読めないので安全側)", () => {
    const dir = tree({
      "components/host.tsx": [
        '"use client";',
        "export function Host(props) {",
        "  return <button {...props} />;",
        "}",
      ].join("\n"),
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toContain("components/host.tsx#handler:spread#1");
  });

  it("React.createElement のハンドラも拾う", () => {
    const dir = tree({
      "components/host.tsx": [
        '"use client";',
        "import React from \"react\";",
        "export const Host = () => React.createElement(\"button\", { onClick: () => 0 });",
      ].join("\n"),
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toContain("components/host.tsx#handler:onClick#1");
  });

  it("init を外に出した fetch も拾う (eslint も同時に抜ける形)", () => {
    const dir = tree({
      "components/host.tsx": '"use client";\nimport "./writer";\nexport const H = 1;',
      "components/writer.ts": [
        'const init = { method: "POST" };',
        'export const save = () => fetch("/api/x", init);',
      ].join("\n"),
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toContain("components/writer.ts#write:fetch:HOISTED#1");
  });

  it("globalThis.fetch でも拾う", () => {
    const dir = tree({
      "components/host.tsx": '"use client";\nimport "./writer";\nexport const H = 1;',
      "components/writer.ts":
        'export const save = () => globalThis.fetch("/api/x", { method: "POST" });',
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toContain("components/writer.ts#write:fetch:POST#1");
  });

  it("角括弧の addEventListener でも拾う", () => {
    const dir = tree({
      "components/host.tsx": [
        '"use client";',
        'export const H = () => window["addEventListener"]("scroll", () => 0);',
      ].join("\n"),
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toContain("components/host.tsx#listener:scroll#1");
  });

  it("サーバ専用モジュールの書き込みは台帳に載せない", () => {
    /* 「押せるもの」の表にサーバ内部の往復が混ざると、本当に押せる行が埋もれる。 */
    const dir = tree({
      "app/api/x/route.ts": 'export const POST = () => fetch("/up", { method: "POST" });',
    });
    run(dir, ["--seed-baseline"]);
    expect(rowsOf(dir)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. 未分類が通らないか                                                         */
/* -------------------------------------------------------------------------- */

describe("宣言の強制", () => {
  it("本物の台帳に未分類は 0 件", () => {
    const rest = inventory().filter((r) => !r.exempt && !r.response);
    expect(rest.map((r) => r.id)).toEqual([]);
  });

  it("response を消すと落ちる", () => {
    const dir = tree({ "components/host.tsx": HOST });
    run(dir, ["--seed-baseline"]);

    const path = join(dir, "interaction-inventory.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    delete parsed.interactions[0].exempt;
    writeFileSync(path, JSON.stringify(parsed, null, 2));

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("応答の宣言が無い操作");
  });

  it("optimistic なのに observe が空だと落ちる", () => {
    /* **これが G2 を捕まえる本体**。「金額も観測対象だ」と書かせることが、
       cartReducer の覆い漏れを機械的に赤くする唯一の経路なので、
       空の observe を通すとこの仕組みは無意味になる。 */
    const dir = tree({ "components/host.tsx": HOST });
    run(dir, ["--seed-baseline"]);

    const path = join(dir, "interaction-inventory.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    parsed.interactions[0] = {
      ...parsed.interactions[0],
      exempt: undefined,
      response: "optimistic",
      observe: [],
    };
    delete parsed.interactions[0].exempt;
    writeFileSync(path, JSON.stringify(parsed, null, 2));

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("応答の宣言が無い操作");
  });

  it("理由の無い exempt は通らない", () => {
    /* `"exempt": true` を書くだけで台帳から消せるなら、逃げ道は「差分に必ず
       現れる」だけの中身の無いものになる。 */
    const dir = tree({ "components/host.tsx": HOST });
    run(dir, ["--seed-baseline"]);

    const path = join(dir, "interaction-inventory.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    parsed.interactions[0].exempt = "";
    writeFileSync(path, JSON.stringify(parsed, null, 2));

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("exempt の形が不正");
  });

  it("知らない response の値は通らない", () => {
    const dir = tree({ "components/host.tsx": HOST });
    run(dir, ["--seed-baseline"]);

    const path = join(dir, "interaction-inventory.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    delete parsed.interactions[0].exempt;
    parsed.interactions[0].response = "fast-enough";
    writeFileSync(path, JSON.stringify(parsed, null, 2));

    expect(run(dir, ["--check"]).code).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. e2e が台帳を実際に読んでいるか                                              */
/* -------------------------------------------------------------------------- */

describe("e2e との配線", () => {
  const spec = readFileSync(SPEC, "utf8");

  /**
   * 画面で観測できる応答だけが e2e の対象。
   *
   * `fire-and-forget` を外すのは、その宣言が「誰もこの往復を待っていない」を
   * 意味するから (先読みの引き金は画面を何も変えないのが正しい挙動)。
   * **exempt とは別物** — 応答を分類したうえで「観測対象が無い」と言っている。
   * 正本は spec 側の `OBSERVABLE_RESPONSES` で、ここはそれと同じ集合を見ている
   * ことを確かめてから使う (2 か所に別々の定義を置かない)。
   */
  const OBSERVABLE = ["optimistic", "sync-dom", "asset-load", "router-nav"];

  const observableDeclared = () =>
    inventory().filter(
      (r) => !r.exempt && r.response && !["fire-and-forget"].includes(r.response),
    );

  it("観測できる応答の集合が spec と食い違っていない", () => {
    /* ここがずれると、片方だけが「検査対象」と思っている行が生まれる。 */
    for (const kind of OBSERVABLE) {
      expect(spec, `${kind} が spec の OBSERVABLE_RESPONSES に無い`).toContain(`"${kind}"`);
    }
    expect(spec).toContain("OBSERVABLE_RESPONSES");
    expect(spec).not.toMatch(/OBSERVABLE_RESPONSES = new Set\(\[[^\]]*"fire-and-forget"/);
  });

  it("spec が台帳を読み込んでいる (手書きのリストにしていない)", () => {
    /* ここを手書きリストにすると、台帳に何を書いても検査は変わらない。
       それが `interactive-instant-controls.test.ts` の 3 ファイル配列で
       実際に起きたこと (網羅表 S5)。 */
    expect(spec).toContain("interaction-inventory.json");
    expect(spec).toMatch(/readFileSync\(/);
  });

  it("応答を宣言した行には、必ず e2e の操作手順がある", () => {
    /* **宣言だけして検査しない**を原理的に不可能にする。宣言を増やすと
       検査も増える形にしておかないと、台帳は「守っているつもり」の表になる。 */
    const declared = observableDeclared();
    expect(declared.length, "応答を宣言した行が 1 件も無い").toBeGreaterThan(0);

    const missing = declared.filter((r) => !spec.includes(`"${r.id}"`));
    expect(
      missing.map((r) => r.id),
      "台帳が応答を宣言しているのに e2e に操作手順が無い",
    ).toEqual([]);
  });

  it("宣言に出てくる response は e2e が判定方法を持っている", () => {
    for (const row of observableDeclared()) {
      expect(spec, `${row.response} の判定が e2e に無い`).toContain(`case "${row.response}"`);
    }
  });

  it("observe の selector は e2e が実際に引く形になっている", () => {
    /* selector を書き間違えると `page.locator()` が 0 件を返し、
       `not.toHaveText("")` が通ってしまう向きがある。形だけでも固定する。 */
    for (const row of inventory()) {
      for (const selector of row.observe ?? []) {
        expect(selector, `${row.id} の observe が selector の形ではない`).toMatch(
          /^\[data-(slot|testid)=/,
        );
      }
    }
  });

  it("observe が名指しした data-slot は実装に存在する", () => {
    /* 名前を変えたときに e2e ではなくここが落ちる (原因が近いところで分かる)。 */
    const slots = new Set<string>();
    for (const row of inventory()) {
      for (const selector of row.observe ?? []) {
        /* 複合 selector (`[data-slot="x"][data-pending="true"]`) でも先頭の
           data-slot は実在を確かめる。末尾を固定すると検査から漏れる。 */
      const m = /^\[data-slot="([^"]+)"\]/.exec(selector);
        if (m) slots.add(m[1]);
      }
    }
    expect(slots.size).toBeGreaterThan(0);

    const sources = execFileSync(
      "git",
      ["grep", "-l", "-F", "data-slot=", "--", "components", "app"],
      { cwd: REPO, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((p) => readFileSync(join(REPO, p), "utf8"))
      .join("\n");

    for (const slot of slots) {
      expect(sources, `observe が指す data-slot="${slot}" が実装に無い`).toContain(
        `data-slot="${slot}"`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 4. CI に配線されているか                                                      */
/* -------------------------------------------------------------------------- */

describe("CI との配線", () => {
  const ci = readFileSync(CI, "utf8");

  it("static-checks が台帳の検査を走らせている", () => {
    /* 手元でしか走らない検査は、いずれ誰も走らせなくなる。 */
    const staticChecks = ci.slice(ci.indexOf("  static-checks:"), ci.indexOf("  unit-tests:"));
    expect(staticChecks).toContain("check:interactions");
  });

  it("新規ジョブを作っていない (既存の static-checks に相乗り)", () => {
    /* 緑の push 1 回 = 15 分・無料枠 2,000 分/月 (docs/ci-gates.md)。
       ジョブを増やすと、この検査のために他の検査が回せなくなる。 */
    expect(ci).not.toContain("interaction-checks:");
    expect(ci).not.toContain("name: interaction");
  });

  it("package.json に check:interactions がある", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["check:interactions"]).toContain("generate-interaction-inventory.mjs");
    expect(pkg.scripts["check:interactions"]).toContain("--check");
  });
});

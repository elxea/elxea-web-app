/**
 * `scripts/ops/check-ratchet.mjs` に歯があることを確かめる — 憲章 R8 (Wave 4)。
 *
 * 検査そのものが空回りしていたら、CI の緑は「例外が増えていない」ではなく
 * 「見ていない」を意味する。だから本物のツリーで OK になることだけでなく、
 * **壊した入力で確実に落ちること**を、実際にスクリプトを起動して確かめる。
 *
 * 各ケースは使い捨ての一時ツリーを作り、そこを cwd にしてスクリプトを回す。
 * リポジトリ本体には触らない (`__tests__/sot-registry.test.ts` と同じ作法)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/ops/check-ratchet.mjs");

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/**
 * 最小の「例外表を持つリポジトリ」を作る。
 *
 * 本物の app/ lib/ を写さないのは、テストが本体の実際の件数に依存しないように
 * するため。依存すると、無関係な変更で毎回このテストを書き換えることになり、
 * そのうち誰も中身を見なくなる。
 */
function tree(overrides: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-"));
  made.push(dir);

  const files: Record<string, string> = {
    /* 憲章 R9 の操作台帳。`interaction-unclassified` (max 0) と
       `interaction-exempt` の数え方がここを読むので、最小の形で置いておく。
       置かないと `countInventory` が「表が見つからない」で落ちる — それは
       正しい挙動 (0 件と数えて上限だけ残す方が危険) なので、テスト側が用意する。 */
    "interaction-inventory.json": JSON.stringify({
      interactions: [
        { id: "components/a.tsx#handler:onClick#1", kind: "handler", exempt: "据え置き" },
        { id: "components/b.tsx#handler:onClick#1", kind: "handler", response: "sync-dom" },
      ],
    }),
    "eslint-suppressions.json": JSON.stringify({
      "a.ts": { "some/rule": { count: 2 } },
      "b.ts": { "some/rule": { count: 1 } },
    }),
    // inline disable 1 件 + expected-failure 1 件
    "app/x.ts": "// eslint-disable-next-line foo\nconst a = 1;\n",
    "lib/y.ts": "try { f(); } catch { /* expected-failure: 無ければ既定で進む */ }\n",
    "eslint-rules/mutation-through-shared-primitive.mjs": [
      "const ALLOWLIST = new Set([",
      '  "components/a.tsx",',
      '  // "components/removed.tsx" — 移行済み (コメントは数えない)',
      '  "components/b.tsx",',
      "]);",
    ].join("\n"),
    "eslint-rules/no-silent-catch-at-boundary.mjs": [
      "const GRANDFATHERED = new Map([",
      "  // 空である",
      "]);",
    ].join("\n"),
    "__tests__/design-system/z-layer-scan.ts": [
      "export const FIXED_Z_ALLOWLIST = [",
      '  "components/ui/",',
      '  "app/dev/",',
      "];",
      "",
      "export const PINNED_EXEMPTIONS: ReadonlyArray<{ key: string }> = [",
      "  {",
      '    key: "components/viz/wash.tsx | -z-10",',
      "  },",
      "];",
    ].join("\n"),
    ...overrides,
  };

  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], {
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

const ratchetsOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "ratchets.json"), "utf8")).ratchets;

describe("正常系", () => {
  it("--update で実測値を書き、そのまま --check が通る", () => {
    const dir = tree();
    expect(run(dir, ["--update"]).code).toBe(0);

    const r = ratchetsOf(dir);
    expect(r["eslint-suppressions-total"].max).toBe(3);
    expect(r["eslint-suppressions-files"].max).toBe(2);
    expect(r["eslint-inline-disable"].max).toBe(1);
    expect(r["expected-failure-escapes"].max).toBe(1);
    /* コメント行 (`// "components/removed.tsx"`) を数えていないこと。 */
    expect(r["interaction-allowlist"].max).toBe(2);
    expect(r["silent-catch-grandfathered"].max).toBe(0);
    expect(r["z-layer-fixed-allowlist"].max).toBe(2);
    expect(r["z-layer-pinned-exemptions"].max).toBe(1);
    expect(r["interaction-exempt"].max).toBe(1);
    expect(r["interaction-unclassified"].max).toBe(0);

    expect(run(dir, ["--check"]).code).toBe(0);
  });

  it("本物のリポジトリで --check が通る", () => {
    const result = run(process.cwd(), ["--check"]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("OK");
  });
});

describe("--update は人が書いたものを落とさない", () => {
  /* 初版の `render()` は `{ max, source, why }` だけを組み立て直して書いていた。
     つまり `--update` を 1 回走らせるだけで、各エントリの `note` (なぜその件数に
     なったのかの経緯) と `$comment` の 4〜5 行目が**黙って消えた**。しかも消える
     のは「表を減らしたので --update してね」とスクリプト自身が指示した直後で、
     消えたことはエラーにならない。例外の件数は守りながら、なぜ例外なのかの記録の
     ほうを機械が捨てる — この仕組みが最も嫌う形の失敗 (憲章 R8)。 */
  it("note と $comment を持ち越す", () => {
    const dir = tree();
    run(dir, ["--update"]);

    const path = join(dir, "ratchets.json");
    const seeded = JSON.parse(readFileSync(path, "utf8"));
    seeded.$comment = [...seeded.$comment, "人が足した 4 行目"];
    seeded.ratchets["interaction-allowlist"].note = "16 → 19 にした理由がここに書いてある";
    seeded.ratchets["interaction-allowlist"].why = "人が書いた why";
    writeFileSync(path, JSON.stringify(seeded, null, 2));

    /* 表を 1 件減らして、スクリプトの指示どおり --update を走らせる。 */
    const rulePath = join(dir, "eslint-rules/mutation-through-shared-primitive.mjs");
    writeFileSync(
      rulePath,
      readFileSync(rulePath, "utf8").replace('  "components/b.tsx",\n', ""),
    );
    expect(run(dir, ["--update"]).code).toBe(0);

    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.ratchets["interaction-allowlist"].max).toBe(1);
    expect(after.ratchets["interaction-allowlist"].note).toBe(
      "16 → 19 にした理由がここに書いてある",
    );
    expect(after.ratchets["interaction-allowlist"].why).toBe("人が書いた why");
    expect(after.$comment).toContain("人が足した 4 行目");
  });
});

describe("変異: 例外を増やしたら落ちる", () => {
  it("ALLOWLIST に 1 行足すと落ちる", () => {
    const dir = tree();
    run(dir, ["--update"]);

    const rulePath = join(dir, "eslint-rules/mutation-through-shared-primitive.mjs");
    writeFileSync(
      rulePath,
      readFileSync(rulePath, "utf8").replace(
        '  "components/b.tsx",',
        '  "components/b.tsx",\n  "components/sneaked-in.tsx",',
      ),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("interaction-allowlist");
    expect(result.out).toContain("例外が増えています");
  });

  it("GRANDFATHERED を 0 件から 1 件にすると落ちる", () => {
    const dir = tree();
    run(dir, ["--update"]);

    writeFileSync(
      join(dir, "eslint-rules/no-silent-catch-at-boundary.mjs"),
      ['const GRANDFATHERED = new Map([', '  ["lib/foo.ts", 3],', "]);"].join("\n"),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("silent-catch-grandfathered");
  });

  it("eslint-suppressions の件数が増えると落ちる", () => {
    const dir = tree();
    run(dir, ["--update"]);

    writeFileSync(
      join(dir, "eslint-suppressions.json"),
      JSON.stringify({
        "a.ts": { "some/rule": { count: 9 } },
        "b.ts": { "some/rule": { count: 1 } },
      }),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("eslint-suppressions-total");
  });

  it("inline の eslint-disable が増えると落ちる", () => {
    const dir = tree();
    run(dir, ["--update"]);
    writeFileSync(join(dir, "app/z.ts"), "// eslint-disable-next-line bar\nconst b = 2;\n");

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("eslint-inline-disable");
  });
});

describe("変異: 緩んだ枠を残しても落ちる", () => {
  it("例外を減らしたのに max が下がっていないと落ちる", () => {
    const dir = tree();
    run(dir, ["--update"]);

    const rulePath = join(dir, "eslint-rules/mutation-through-shared-primitive.mjs");
    writeFileSync(
      rulePath,
      readFileSync(rulePath, "utf8").replace('  "components/b.tsx",\n', ""),
    );

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("緩んでいます");

    /* 直し方は --update 1 回。それで通るところまで確かめる。 */
    expect(run(dir, ["--update"]).code).toBe(0);
    expect(run(dir, ["--check"]).code).toBe(0);
    expect(ratchetsOf(dir)["interaction-allowlist"].max).toBe(1);
  });
});

describe("変異: 検査自体を骨抜きにしても落ちる", () => {
  it("ratchets.json から表を消すと落ちる (数え方は残っている)", () => {
    const dir = tree();
    run(dir, ["--update"]);

    const parsed = JSON.parse(readFileSync(join(dir, "ratchets.json"), "utf8"));
    delete parsed.ratchets["interaction-allowlist"];
    writeFileSync(join(dir, "ratchets.json"), JSON.stringify(parsed, null, 2));

    const result = run(dir, ["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("ratchets.json にありません");
  });

  it("表そのものが見つからないと 0 件と数えずに落ちる", () => {
    /* 表の名前が変わった / ファイルが移動した、を「例外 0 件」と読むと、
       上限だけが残って検査は永久に緑になる。最も危険な壊れ方なので明示的に確かめる。 */
    const dir = tree({
      "eslint-rules/mutation-through-shared-primitive.mjs": "const OTHER = new Set([]);",
    });
    const result = run(dir, ["--update"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("見つかりません");
  });

  it("配列の終端を取り違えてファイル末尾まで飲まない", () => {
    /* 初回実装がこれを踏んだ: `const X = [...]` を `]);` で閉じると思い込み、
       閉じ位置が見つからずファイル全体を表として数えて 4 件を 8 件と報告した。 */
    const dir = tree({
      "__tests__/design-system/z-layer-scan.ts": [
        "export const FIXED_Z_ALLOWLIST = [",
        '  "components/ui/",',
        "];",
        "",
        "// 表の外にある無関係な文字列 — 数えてはいけない",
        'const NOISE = ["a", "b", "c", "d"];',
        "",
        "export const PINNED_EXEMPTIONS: ReadonlyArray<{ key: string }> = [",
        "  {",
        '    key: "x",',
        "  },",
        "];",
      ].join("\n"),
    });
    expect(run(dir, ["--update"]).code).toBe(0);
    expect(ratchetsOf(dir)["z-layer-fixed-allowlist"].max).toBe(1);
  });
});

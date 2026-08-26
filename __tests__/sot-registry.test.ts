/**
 * `scripts/ops/check-sot-registry.mjs` に歯があることを確かめる — 憲章 R5。
 *
 * 検査そのものが空回りしていたら、CI の緑は「重複が無い」ではなく「見ていない」
 * を意味する。だから本物のツリーで OK になることだけでなく、**壊した入力で
 * 確実に落ちること**を、実際にスクリプトを起動して確かめる。
 *
 * 各ケースは使い捨ての一時ツリーを作り、そこを cwd にしてスクリプトを回す。
 * リポジトリ本体には触らない。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/ops/check-sot-registry.mjs");

const made: string[] = [];

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** 使い捨てツリーを作る。`files` は cwd 相対パス -> 中身。 */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sot-registry-"));
  made.push(dir);
  mkdirSync(join(dir, "docs"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

/** スクリプトを走らせて { code, out } を返す。 */
function run(cwd: string, args: string[] = []): { code: number; out: string } {
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

const declare = (concept: string) => `/**\n * @sot ${concept}\n */\nexport const x = 1;\n`;

describe("正常系", () => {
  it("概念が 1 箇所ずつなら通る", () => {
    const dir = tree({
      "lib/a.ts": declare("site-origin"),
      "lib/b.ts": declare("env-access"),
    });
    run(dir); // 生成
    const r = run(dir, ["--check"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("重複なし");
  });

  it("参照は重複扱いしない (正本を説明する文章が書ける)", () => {
    const dir = tree({
      "lib/a.ts": declare("site-origin"),
      "lib/b.ts": `// 正本は lib/a.ts (\`@sot site-origin\`) にある。\nexport const y = 2;\n`,
    });
    run(dir);
    expect(run(dir, ["--check"]).code).toBe(0);
  });
});

describe("歯があること (変異させると落ちる)", () => {
  it("同じ概念を 2 箇所で宣言すると落ちる", () => {
    // これが本題。lib/site-url.ts と lib/env.ts が両方「サイト基準 URL の正本」を
    // 名乗り、しかも正規化規則が違っていた、という実際に起きた状態を再現する。
    const dir = tree({
      "lib/site-url.ts": declare("site-origin"),
      "lib/env.ts": declare("site-origin"),
    });
    run(dir);
    const r = run(dir, ["--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("site-origin");
    expect(r.out).toContain("2 箇所で正本を名乗っています");
    // 両方の場所を名指しする (どちらを消すか判断できる情報を出す)
    expect(r.out).toContain("lib/site-url.ts");
    expect(r.out).toContain("lib/env.ts");
  });

  it("宣言の無い概念を参照していると落ちる", () => {
    // 正本が移動したのに参照が古いまま、を捕まえる。
    const dir = tree({
      "lib/a.ts": declare("site-origin"),
      "lib/b.ts": `// \`@sot moved-away\` を見よ\nexport const y = 2;\n`,
    });
    run(dir);
    const r = run(dir, ["--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("moved-away");
    expect(r.out).toContain("宣言がありません");
  });

  it("生成物 docs/sot-registry.md が古いと落ちる", () => {
    // 一覧そのものが drift したら、一覧を見て判断できなくなる。
    const dir = tree({ "lib/a.ts": declare("site-origin") });
    run(dir);
    writeFileSync(join(dir, "lib/b.ts"), declare("env-access"));
    const r = run(dir, ["--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("最新ではありません");
  });

  it("--check は生成物を書き換えない (CI が勝手に直して緑にしない)", () => {
    const dir = tree({ "lib/a.ts": declare("site-origin") });
    run(dir);
    writeFileSync(join(dir, "lib/b.ts"), declare("env-access"));
    expect(run(dir, ["--check"]).code).toBe(1);
    // 直っていないので 2 回目も落ちる
    expect(run(dir, ["--check"]).code).toBe(1);
  });
});

describe("実際のリポジトリ", () => {
  it("--check が通り、走査が空回りしていない", () => {
    const r = run(process.cwd(), ["--check"]);
    expect(r.code).toBe(0);
    // 「0 concepts で OK」は検査停止と区別がつかないので、下限を置く。
    const m = r.out.match(/OK — (\d+) concepts/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(3);
  });
});

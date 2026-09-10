/**
 * `no-silent-catch-at-boundary` の「名前が `report` で始まれば通す」穴が
 * 塞がっていることを確かめる — 憲章 R1 / R8 (Wave 3 QA 指摘の是正)。
 *
 * ## 何が穴だったのか
 *
 * ルールは「本物の報告先 (`@/lib/log` / `@sentry/nextjs`) を import しているか」を
 * 見るのに、**別ファイルから import した `reportX` には同じ条件が掛かっていなかった**。
 * つまり
 *
 *   // noop.ts
 *   export function reportNothing() {}
 *   // 使う側
 *   import { reportNothing } from "./noop";
 *   catch (e) { reportNothing(e); }
 *
 * でルールが黙った。ルールが止めたい状態 (届かない記録) を、ルール自身が
 * 用意していたことになる。緑が「握り潰しが無い」ではなく「見ていない」を意味していた。
 *
 * 是正後は import 元を 1 ホップ読み、そのファイルが本物の報告先を import して
 * いるかを確かめる。ここではその**両側**を実際の Linter で確認する:
 * noop なら落ち、本物のヘルパなら通る。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const RULE_PATH = join(process.cwd(), "eslint-rules/no-silent-catch-at-boundary.mjs");

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/**
 * 一時ツリーで ESLint を起動する。
 *
 * ルールは import 元を **cwd 基準**で解決するので、`process.cwd()` を切り替える
 * 必要がある。同一プロセスで `chdir` するとテスト間で干渉するため、子プロセスに
 * 分ける (`__tests__/ratchet.test.ts` と同じ理由)。
 */
function lintInTree(files: Record<string, string>, target: string): string {
  const dir = mkdtempSync(join(tmpdir(), "silent-catch-"));
  made.push(dir);

  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }

  const runner = join(dir, "run.mjs");
  writeFileSync(
    runner,
    [
      `import { Linter } from ${JSON.stringify(join(process.cwd(), "node_modules/eslint/lib/linter/index.js"))};`,
      `import { readFileSync } from "node:fs";`,
      `const rule = (await import(${JSON.stringify(RULE_PATH)})).default;`,
      `const code = readFileSync(${JSON.stringify(join(dir, target))}, "utf8");`,
      `const messages = new Linter().verify(code, [{`,
      `  files: ["**/*.ts"],`,
      `  plugins: { local: { rules: { r: rule } } },`,
      `  rules: { "local/r": "error" },`,
      `}], ${JSON.stringify(target)});`,
      `console.log(JSON.stringify(messages));`,
    ].join("\n"),
  );

  return execFileSync("node", [runner], { cwd: dir, encoding: "utf8" });
}

const CATCH_SITE = (importLine: string, call: string) =>
  [
    importLine,
    "export async function load() {",
    "  try {",
    "    await fetch('https://example.test');",
    "  } catch (error) {",
    `    ${call}`,
    "  }",
    "}",
    "",
  ].join("\n");

describe("変異: 空の report ヘルパでルールを黙らせられないか", () => {
  it("何も報告しない reportX を import しても落ちる", () => {
    const out = lintInTree(
      {
        "lib/shopify/noop.ts": "export function reportNothing(_e: unknown) {}\n",
        "lib/shopify/target.ts": CATCH_SITE(
          'import { reportNothing } from "./noop";',
          "reportNothing(error);",
        ),
      },
      "lib/shopify/target.ts",
    );
    const messages = JSON.parse(out);
    expect(
      messages.length,
      "空の reportX でルールが黙った — 穴が再発している",
    ).toBeGreaterThan(0);
  });

  it("第三者パッケージから来た reportX でも落ちる", () => {
    const out = lintInTree(
      {
        "lib/shopify/target.ts": CATCH_SITE(
          'import { reportSomething } from "some-package";',
          "reportSomething(error);",
        ),
      },
      "lib/shopify/target.ts",
    );
    expect(JSON.parse(out).length).toBeGreaterThan(0);
  });
});

describe("正常系: 本物のヘルパは通る (誤検出しない)", () => {
  it("Sentry を import しているヘルパ経由なら通る", () => {
    const out = lintInTree(
      {
        "lib/shopify/reporter.ts": [
          'import * as Sentry from "@sentry/nextjs";',
          "export function reportFailure(e: unknown) {",
          "  Sentry.captureException(e);",
          "}",
          "",
        ].join("\n"),
        "lib/shopify/target.ts": CATCH_SITE(
          'import { reportFailure } from "./reporter";',
          "reportFailure(error);",
        ),
      },
      "lib/shopify/target.ts",
    );
    expect(JSON.parse(out)).toEqual([]);
  });

  it("@/ 別名で解決するヘルパも通る", () => {
    const out = lintInTree(
      {
        "lib/line/reporter.ts": [
          'import { logger } from "@/lib/log";',
          "export function reportChannel(e: unknown) {",
          "  logger.error(e);",
          "}",
          "",
        ].join("\n"),
        "app/api/probe/route.ts": CATCH_SITE(
          'import { reportChannel } from "@/lib/line/reporter";',
          "reportChannel(error);",
        ),
      },
      "app/api/probe/route.ts",
    );
    expect(JSON.parse(out)).toEqual([]);
  });

  it("本物の報告先を直接呼ぶ形は当然通る", () => {
    const out = lintInTree(
      {
        "lib/shopify/target.ts": CATCH_SITE(
          'import * as Sentry from "@sentry/nextjs";',
          "Sentry.captureException(error);",
        ),
      },
      "lib/shopify/target.ts",
    );
    expect(JSON.parse(out)).toEqual([]);
  });
});

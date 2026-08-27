/**
 * `mutation-through-shared-primitive` の**視界**に歯があることを確かめる — 憲章 R9。
 *
 * このルールは 2 回、同じ形で空回りしていた。
 *
 *   1. `eslint.config.mjs` の `files` が `.tsx` しか見ておらず、`lib/**` と `.ts`
 *      全域が対象外だった。`lib/favorites/client-store.ts` は `"use client"` +
 *      `method: "POST"` + 例外表未登載なのに `npx eslint` が 0 件で返っていた。
 *   2. glob を広げても、判定が `"use client"` の 1 行だったので、`.ts` に 1 段
 *      切り出すだけで指令が消えてまた見えなくなった
 *      (`lib/firebase/behavior-tracker.ts` / `components/chat/elxea-chat-transport.ts`)。
 *
 * どちらも「ルールは在る・CI は緑・でも何も見ていない」という同じ壊れ方である。
 * だから**本物のツリーで緑になること**ではなく、**逃げ方を実際に作って落ちること**
 * を確かめる。使い捨ての一時ツリーで確かめ、リポジトリ本体には触らない
 * (`__tests__/ratchet.test.ts` と同じ作法)。
 *
 * 2 層に分けてある:
 *
 *   - **視界の計算そのもの** (`isBrowserReachable`) … 到達の意味論を直接確かめる。
 *     型だけの import・`"use server"` の切れ目・多段の中継など、間違えると
 *     「誤検出で例外表が膨らむ」か「見落として穴が残る」のどちらかになる境目。
 *   - **ルール全体** … 実際に ESLint を起動し、逃げ方を作ったツリーで報告が
 *     出ることを確かめる。視界の計算が正しくても配線が外れていれば意味がない。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const ESLINT_BIN = join(REPO, "node_modules/.bin/eslint");
const RULE = join(REPO, "eslint-rules/mutation-through-shared-primitive.mjs");
const HELPER = join(REPO, "eslint-rules/lib/browser-reachable.mjs");

type Helper = {
  isBrowserReachable: (root: string, relPath: string) => boolean;
  __resetBrowserReachableCache: () => void;
};

const helper = (await import(pathToFileURL(HELPER).href)) as Helper;

const made: string[] = [];
afterEach(() => {
  helper.__resetBrowserReachableCache();
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** 使い捨ての木を作る。macOS の `/var` は `/private/var` への symlink なので実体に直す。 */
function tree(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutation-reach-")));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

const reaches = (dir: string, rel: string) => helper.isBrowserReachable(dir, rel);

/* -------------------------------------------------------------------------- */
/* 1. 視界の計算 — 何をブラウザ側と見なすか                                      */
/* -------------------------------------------------------------------------- */

describe("視界: 逃げ方を作っても到達可能と分かる", () => {
  it("指令を持たない .ts に切り出しても、画面から到達できる", () => {
    /* これが穴そのもの。`"use client"` を持つのは host だけで、実際に書き込む
       writer.ts には指令が無い。指令だけを見る判定はここで空振りしていた。 */
    const dir = tree({
      "components/host.tsx": '"use client";\nimport { save } from "@/lib/thing/writer";\nsave;',
      "lib/thing/writer.ts": "export function save() {}",
    });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(true);
  });

  it("拡張子を .tsx から .ts に変えるだけでは消えない", () => {
    /* 旧 glob では、この 1 文字の変更で監査から消えた。例外表には 1 行も差分が
       出ないので、レビューでも気づけない。 */
    const dir = tree({
      "components/host.tsx": '"use client";\nimport { save } from "./writer";\nsave;',
      "components/writer.ts": "export function save() {}",
    });
    expect(reaches(dir, "components/writer.ts")).toBe(true);
  });

  it("何段挟んでも到達可能", () => {
    const dir = tree({
      "components/host.tsx": '"use client";\nimport { save } from "@/lib/a";\nsave;',
      "lib/a.ts": 'export { save } from "@/lib/b";',
      "lib/b.ts": 'export { save } from "@/lib/thing/writer";',
      "lib/thing/writer.ts": "export function save() {}",
    });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(true);
  });

  it("動的 import 越しでも到達可能", () => {
    const dir = tree({
      "components/host.tsx":
        '"use client";\nexport const f = () => import("@/lib/thing/writer");',
      "lib/thing/writer.ts": "export function save() {}",
    });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(true);
  });
});

describe("視界: 誤検出しない (例外表を膨らませないため)", () => {
  it("`use server` の向こう側は到達可能にしない", () => {
    /* ここを切らないと `lib/shopify/client.ts` のようなサーバ専用モジュールまで
       「ブラウザ到達可能」に見え、直しようのない違反で例外表が膨らむ。
       実測 (2026-08-27, bcce45e): 切らないと 5 件 / 切ると 2 件で、増える 3 件は
       すべて Server Action の向こう側だった。 */
    const dir = tree({
      "components/host.tsx": '"use client";\nimport { act } from "@/lib/thing/actions";\nact;',
      "lib/thing/actions.ts": '"use server";\nexport { save as act } from "@/lib/thing/writer";',
      "lib/thing/writer.ts": "export function save() {}",
    });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(false);
  });

  it("どこからも import されないモジュールは到達可能にしない", () => {
    const dir = tree({ "lib/thing/writer.ts": "export function save() {}" });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(false);
  });

  it("型だけの import では到達しない (実行時には消える)", () => {
    const dir = tree({
      "components/host.tsx":
        '"use client";\nimport type { Thing } from "@/lib/thing/writer";\nexport type T = Thing;',
      "lib/thing/writer.ts": "export type Thing = string;\nexport function save() {}",
    });
    expect(reaches(dir, "lib/thing/writer.ts")).toBe(false);
  });

  it("サーバ専用ページから読むだけのモジュールは到達可能にしない", () => {
    const dir = tree({
      "app/page.tsx": 'import { read } from "@/lib/thing/reader";\nread;',
      "lib/thing/reader.ts": "export function read() {}",
    });
    expect(reaches(dir, "lib/thing/reader.ts")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. ルール全体 — 視界が正しくても配線が外れていれば意味がない                   */
/* -------------------------------------------------------------------------- */

/**
 * ESLint を一時ツリーの cwd で起動し、**このルールが**報告したファイルを返す。
 *
 * `ruleId` で絞るのが要点。素の espree は TypeScript 構文を読めないので、
 * 絞らないと構文エラー (`ruleId: null`) を報告と取り違えて、**何も検査して
 * いないのに緑・あるいは赤**になる。だから雛形も JS として読める範囲で書く
 * (型注釈を置かない)。見たいのは「書き込みが見えているか」だけなので足りる。
 */
function lintOffenders(dir: string): string[] {
  let raw = "";
  try {
    raw = execFileSync(ESLINT_BIN, [".", "--format", "json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    raw = (e as { stdout?: string }).stdout ?? "";
  }
  const results = JSON.parse(raw) as {
    filePath: string;
    messages: { ruleId: string | null; fatal?: boolean }[];
  }[];

  /* 構文エラーが出ていたら黙って 0 件にせず落とす。雛形が読めていない状態の
     「違反 0 件」は、このテストが最も避けたい「見ていない緑」そのもの。 */
  const fatal = results.flatMap((r) =>
    r.messages.filter((m) => m.fatal).map(() => r.filePath),
  );
  if (fatal.length > 0) {
    throw new Error(`雛形が構文エラーで読めていない: ${fatal.join(", ")}`);
  }

  return results
    .filter((r) =>
      r.messages.some((m) => m.ruleId === "local/mutation-through-shared-primitive"),
    )
    .map((r) => r.filePath.slice(dir.length + 1))
    .sort();
}

const CONFIG = [
  `import rule from ${JSON.stringify(RULE)};`,
  "export default [",
  "  {",
  /* 対象範囲は本体の eslint.config.mjs と同じ「app / components / lib / hooks を
     .ts も含めて全部」。ここを狭く書くとテストだけ通って本番の穴が残る。 */
  '    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],',
  '    languageOptions: { ecmaVersion: 2023, sourceType: "module" },',
  '    plugins: { local: { rules: { "mutation-through-shared-primitive": rule } } },',
  '    rules: { "local/mutation-through-shared-primitive": "error" },',
  "  },",
  "];",
].join("\n");

const WRITER = [
  "export async function save(id) {",
  '  await fetch("/api/thing", {',
  '    method: "POST",',
  '    headers: { "Content-Type": "application/json" },',
  "    body: JSON.stringify({ id }),",
  "  });",
  "}",
].join("\n");

describe("ルール全体: 逃げ方を作ると実際に落ちる", () => {
  it("指令なしの .ts に書き込みを移しても報告される", () => {
    const dir = tree({
      "eslint.config.mjs": CONFIG,
      "components/host.tsx": '"use client";\nimport { save } from "@/lib/thing/writer";\nsave;',
      "lib/thing/writer.ts": WRITER,
    });
    expect(lintOffenders(dir)).toEqual(["lib/thing/writer.ts"]);
  });

  it("共通の通り道を通っていれば報告しない", () => {
    const dir = tree({
      "eslint.config.mjs": CONFIG,
      "components/host.tsx": '"use client";\nimport { save } from "@/lib/thing/writer";\nsave;',
      "lib/thing/writer.ts": [
        'import { createWriteQueue } from "@/lib/interaction/write-queue";',
        "createWriteQueue;",
        WRITER,
      ].join("\n"),
      "lib/interaction/write-queue.ts": "export function createWriteQueue() {}",
    });
    expect(lintOffenders(dir)).toEqual([]);
  });

  it("`use server` の向こう側は報告しない", () => {
    const dir = tree({
      "eslint.config.mjs": CONFIG,
      "components/host.tsx": '"use client";\nimport { act } from "@/lib/thing/actions";\nact;',
      "lib/thing/actions.ts": '"use server";\nexport { save as act } from "@/lib/thing/writer";',
      "lib/thing/writer.ts": WRITER,
    });
    expect(lintOffenders(dir)).toEqual([]);
  });
});

/**
 * 対象範囲そのものの固定 — **これが無いと視界を戻せてしまう**。
 *
 * 下の「違反 0 件」は、glob を旧 `["components/**\/*.tsx", "app/**\/*.tsx"]` に
 * 戻しても通る (狭めれば当然 0 件になる)。つまり 0 件の assert だけでは
 * **穴を開け直す変更を止められない**。実際に確かめた (2026-08-27 の負検査:
 * glob を旧形へ戻しても本テストは 12/12 緑のままだった)。
 *
 * よって「そのファイルでルールが有効か」を `eslint --print-config` で直接見る。
 * これは網羅表がこの穴の実証に使ったコマンドそのもので、手順を機械に移したもの。
 */
describe("対象範囲 (files glob)", () => {
  const activeRulesFor = (file: string): Record<string, unknown> => {
    const raw = execFileSync(ESLINT_BIN, ["--print-config", file], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return (JSON.parse(raw) as { rules: Record<string, unknown> }).rules;
  };

  const RULE_ID = "elxea-tokens/mutation-through-shared-primitive";

  it.each([
    ["lib/favorites/client-store.ts", "lib/** の .ts (S1 の実証に使われた当該ファイル)"],
    ["lib/firebase/behavior-tracker.ts", "lib/** の .ts (指令なし・到達可能)"],
    ["components/chat/elxea-chat-transport.ts", "components/** の .ts"],
    ["components/cart/cart-content.tsx", "components/** の .tsx (従来から対象)"],
    ["app/[locale]/contact/contact-form.tsx", "app/** の .tsx (従来から対象)"],
  ])("%s で有効 — %s", (file) => {
    expect(activeRulesFor(file)).toHaveProperty(RULE_ID);
  });
});

describe("本物のリポジトリ", () => {
  /**
   * かつて**見えていなかった側**のファイルを名指しで検査する。
   *
   * 全域を走らせないのは、`pnpm lint --max-warnings 0` (CI の required check)
   * が既に全域の 0 件を担保しているから。ここを全域にすると、同じことを 2 回
   * 数えたうえで storybook プロジェクトと並走したときに 30 秒の上限に当たり、
   * **変更内容と無関係に落ちるテスト**になる (実測 38.5 秒)。そうなると
   * `--no-verify` (禁止) への圧力になるだけで、検査の質は上がらない。
   *
   * ここが受け持つのは「網羅表 A23-A26 の 4 件が、例外表へ逃げずに実体として
   * 直ったままか」の 1 点。戻せばここが名指しで落ちる。
   */
  it("かつて見えていなかった 4 件が、このルールの違反として残っていない", () => {
    const PREVIOUSLY_INVISIBLE = [
      "lib/favorites/client-store.ts", // A23 / A24
      "lib/firebase/behavior-tracker.ts", // A25
      "components/account/favorites-board.tsx", // 同じ相手への DELETE の重複
    ];

    let raw = "";
    try {
      raw = execFileSync(ESLINT_BIN, [...PREVIOUSLY_INVISIBLE, "--format", "json"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      raw = (e as { stdout?: string }).stdout ?? "";
    }
    const results = JSON.parse(raw) as {
      filePath: string;
      messages: { ruleId: string | null }[];
    }[];

    /* ファイルが移動・改名されて 0 件になったのを「直った」と読まないため、
       検査したファイル数そのものも固定する。 */
    expect(results).toHaveLength(PREVIOUSLY_INVISIBLE.length);

    const offenders = results
      .filter((r) =>
        r.messages.some(
          (m) => m.ruleId === "elxea-tokens/mutation-through-shared-primitive",
        ),
      )
      .map((r) => r.filePath.slice(REPO.length + 1));

    expect(offenders).toEqual([]);
  });
});

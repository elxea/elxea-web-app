/**
 * 「そのモジュールはブラウザで走るのか」を **import の道筋から** 判定する。
 *
 * ## なぜ `"use client"` の有無で判定してはいけないのか
 *
 * `mutation-through-shared-primitive` は当初 `"use client"` の 1 行だけを見て
 * 「画面側のファイル」を決めていた。ところが React Server Components では
 * **その指令を持つのは境界のファイルだけ**で、そこから import される `.ts`
 * モジュールは指令を持たないままブラウザで走る。つまり、
 *
 *     components/foo.tsx  ("use client")  ← 見張られている
 *       └─ lib/foo/writer.ts  (指令なし)  ← 見張られていない。ここで fetch する
 *
 * と 1 段挟むだけで、検査を通らずに書き込みを置ける。実測 (2026-08-27, bcce45e):
 * `lib/firebase/behavior-tracker.ts` と `components/chat/elxea-chat-transport.ts`
 * がこの形で `POST` を持ち、`pnpm lint` は緑だった。
 *
 * 対処は **import の道筋を辿ってブラウザ到達可能集合を出す** こと。指令の有無
 * ではなく到達可能性で決めるので、ファイルを分割しても逃げられない。
 *
 * ## どこで辿るのをやめるか — `"use server"` が唯一の切れ目
 *
 * client component は Server Action モジュール (`"use server"`) を import する。
 * これは **関数呼び出しがネットワーク越しになる境界** で、その先のコードは
 * ブラウザに送られない。ここで止めないと `lib/shopify/client.ts` のような
 * サーバ専用モジュールまで「ブラウザ到達可能」に見え、誤検出で例外表が膨らむ
 * (実測: 止めないと 5 件、止めると 2 件。増える 3 件はすべて `"use server"`
 * の向こう側だった)。
 *
 * ## 型だけの import は辺にしない
 *
 * `import type { X } from "@/lib/shopify/types"` は実行時には消える。辺として
 * 数えるとサーバ専用モジュールが型経由で到達可能になってしまう。
 *
 * ## 走査は 1 プロセスに 1 回
 *
 * ESLint はファイルごとにルールを作るので、素直に書くとファイル数ぶん走査する。
 * cwd をキーにして memo 化し、1 プロセス 1 回に抑える (実測 457 ファイルで
 * 数十 ms)。ESLint は 1 回の実行のあいだ木を書き換えないので、これで足りる。
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";

/** 走査しないディレクトリ (生成物・依存・退避)。 */
const SKIP_DIR = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "coverage",
  "storybook-static",
  "backup-before-cleanup",
  "playwright-report",
  "test-results",
]);

/** 走査の起点。画面とその下請けが入るところ全部。 */
const ROOTS = ["app", "components", "lib", "hooks"];

/** 画面ではないもの (型定義・テスト・Storybook)。 */
const NOT_SOURCE = /\.(d\.ts|test\.tsx?|stories\.tsx?)$/;

const toPosix = (p) => p.replace(/\\/g, "/");

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !NOT_SOURCE.test(name)) out.push(full);
  }
  return out;
}

/**
 * import 指定子を、走査済みファイルの相対パスへ解決する。
 * 解決できないもの (外部パッケージ・画像など) は辺にしない。
 */
function resolveSpecifier(spec, fromRel, byRel, root) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("."))
    base = toPosix(relative(root, resolve(dirname(join(root, fromRel)), spec)));
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (byRel.has(candidate)) return candidate;
  }
  return null;
}

/** 値として import しているものだけを取り出す (型だけの import は落とす)。 */
function valueImports(text) {
  const withoutTypeImports = text.replace(
    /\b(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["']/g,
    "",
  );
  return [
    ...withoutTypeImports.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g),
  ].map((m) => m[1]);
}

const hasDirective = (text, name) =>
  new RegExp(`^\\s*["']${name}["']`, "m").test(text);

/** cwd ごとの結果。ESLint 1 実行につき 1 回だけ組み立てる。 */
const cache = new Map();

function build(root) {
  const files = [];
  for (const dir of ROOTS) walk(join(root, dir), files);

  const rel = (f) => toPosix(relative(root, f));
  const byRel = new Map(files.map((f) => [rel(f), f]));

  const clientEntries = new Set();
  const serverBoundaries = new Set();
  const edges = new Map();

  for (const file of files) {
    const r = rel(file);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (hasDirective(text, "use client")) clientEntries.add(r);
    if (hasDirective(text, "use server")) serverBoundaries.add(r);
    edges.set(
      r,
      [
        ...new Set(
          valueImports(text)
            .map((s) => resolveSpecifier(s, r, byRel, root))
            .filter(Boolean),
        ),
      ],
    );
  }

  /* ブラウザ到達可能集合 = "use client" から値 import を辿った先。
     `"use server"` のモジュールに入ったらそこで打ち切る (その先はブラウザに
     送られない)。境界そのものは集合に入れない — 中身はサーバで走るため。 */
  const reachable = new Set(clientEntries);
  const queue = [...clientEntries];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const next of edges.get(current) ?? []) {
      if (serverBoundaries.has(next)) continue;
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }

  return reachable;
}

/**
 * `relPath` (リポジトリ相対・posix) がブラウザで走るか。
 *
 * 走査に失敗した場合は **`"use client"` の有無だけを見る従来の判定へ落ちる**
 * のではなく、呼び出し側が持っている指令判定を使う (この関数は false を返す)。
 * 走査できない環境 (RuleTester の仮想ファイル等) で誤検出しないため。
 */
export function isBrowserReachable(root, relPath) {
  let set = cache.get(root);
  if (!set) {
    set = build(root);
    cache.set(root, set);
  }
  return set.has(relPath);
}

/** テスト用。走査結果を捨てて次の呼び出しで組み立て直す。 */
export function __resetBrowserReachableCache() {
  cache.clear();
}

#!/usr/bin/env node
// =============================================================================
// check-edge-bundle.mjs — Edge Function に Node 専用モジュールを入れさせない
//
// 問題:
//   Vercel の Edge Runtime は node:http や node:fs を動かせない。入ってしまうと
//   デプロイが次のエラーで落ちる:
//
//     Error: The Edge Function "_middleware" is referencing unsupported modules:
//       - __vc__ns__/0/index.js: node:http, node:https, node:zlib, node:stream,
//         node:net, node:fs, node:path
//
//   厄介なのは **`next build` は成功する** こと。required check は全部緑のまま
//   main にマージでき、Vercel が出力を配る段になって初めて落ちる。つまり
//   「マージできるがデプロイできない main」が作れてしまう。実際に 2026-08-27、
//   憲章 Wave 1 (#164) のマージでこれが起きた。
//
// 原因の型:
//   `instrumentation.ts` の分岐が畳めなくなると起きる。`process.env.NEXT_RUNTIME`
//   や `process.env.NODE_ENV` をリテラルで書いてあればバンドラが定数に畳み、
//   `if ("edge" === "nodejs")` のような分岐は丸ごと消える。消えることで、その中の
//   動的 import (sentry.server.config / fake-firestore → firebase-admin) が
//   Edge の bundle から落ちる。これを `env("NEXT_RUNTIME")` のような**関数呼び出し**
//   に変えると畳めなくなり、Node 専用の依存が芋づるで入る。
//   経緯と判断は `instrumentation.ts` の doc comment が正本。
//
// 処方:
//   ビルド成果物 (middleware-manifest.json が指す実チャンク) を直接読み、
//   Edge Runtime が扱えない `node:*` の参照が出たらその場で落とす。
//   「デプロイして初めて分かる」を「ビルドした直後に分かる」に前倒しする。
//   CI の `build` は required check なので、PR の段階で止まる。
//
// 使い方:
//   node scripts/ops/check-edge-bundle.mjs        … .next を検査 (要 next build 済み)
//
// 終了コード: 0 = 問題なし / 1 = 違反あり / 2 = 検査自体が成立しなかった
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const NEXT_DIR = ".next";
const MANIFEST = join(NEXT_DIR, "server", "middleware-manifest.json");

/**
 * Edge Runtime が実際にサポートしている node: 組み込み。
 *
 * Vercel の Edge Runtime は `node:buffer` と `node:async_hooks`
 * (AsyncLocalStorage) を通す。Next 自身と next-intl がこの 2 つを使うので、
 * 素の main でもこの 2 つは必ず現れる。
 *
 * ここに足すのは「Edge が本当に動かせると確認したもの」だけ。落ちたからといって
 * 足すと、この検査は「デプロイが落ちるのを事前に教える」という唯一の仕事を失う。
 */
const EDGE_SUPPORTED = new Set(["node:buffer", "node:async_hooks"]);

if (!existsSync(MANIFEST)) {
  console.error(
    `check-edge-bundle: ${MANIFEST} が無い。先に \`pnpm build\` を実行すること。\n` +
      `(検査対象はソースではなくビルド成果物。畳まれたかどうかは成果物にしか出ない)`,
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const entries = { ...(manifest.middleware ?? {}), ...(manifest.functions ?? {}) };

const entryNames = Object.keys(entries);
if (entryNames.length === 0) {
  console.error(
    "check-edge-bundle: middleware-manifest.json に Edge のエントリが 1 つも無い。\n" +
      "middleware.ts が消えたか、manifest の形が変わった可能性がある。検査が空振りしていることを\n" +
      "「問題なし」と報告しないため、ここは失敗として扱う。",
  );
  process.exit(2);
}

/** 違反: entry ごとに「どの chunk が」「どの node: を」参照しているか。 */
const violations = [];
let scannedFiles = 0;

for (const [name, entry] of Object.entries(entries)) {
  for (const file of entry.files ?? []) {
    const path = join(NEXT_DIR, file);
    if (!existsSync(path)) {
      console.error(`check-edge-bundle: manifest が指す ${path} が無い。ビルドが壊れている。`);
      process.exit(2);
    }
    scannedFiles += 1;
    const source = readFileSync(path, "utf8");
    const found = new Set();
    for (const match of source.matchAll(/node:[a-z_]+/g)) {
      if (!EDGE_SUPPORTED.has(match[0])) found.add(match[0]);
    }
    if (found.size > 0) {
      violations.push({ name, file, modules: [...found].sort() });
    }
  }
}

if (violations.length > 0) {
  const allModules = [...new Set(violations.flatMap((v) => v.modules))].sort();
  console.error(
    `check-edge-bundle: Edge Function が Edge Runtime で動かないモジュールを参照している。\n` +
      `このままだと \`next build\` は通るが Vercel のデプロイが\n` +
      `"The Edge Function ... is referencing unsupported modules" で落ちる。\n`,
  );
  for (const v of violations) {
    console.error(`  [${v.name}] ${v.file}\n      ${v.modules.join(", ")}`);
  }
  console.error(
    `\n  検出: ${allModules.join(", ")}\n\n` +
      `よくある原因: instrumentation.ts の分岐がビルド時に畳めなくなり、nodejs 側の\n` +
      `動的 import (sentry.server.config / fake-firestore → firebase-admin) が Edge の\n` +
      `bundle に残っている。分岐条件は process.env.NEXT_RUNTIME / process.env.NODE_ENV を\n` +
      `**リテラルで**読むこと (env() のような関数呼び出しは畳めない)。\n` +
      `理由の正本は instrumentation.ts の register() の doc comment。`,
  );
  process.exit(1);
}

console.log(
  `check-edge-bundle: OK — Edge のエントリ ${entryNames.length} 件 / ` +
    `chunk ${scannedFiles} 件に、Edge が扱えない node: 参照は無い ` +
    `(許可: ${[...EDGE_SUPPORTED].join(", ")})`,
);

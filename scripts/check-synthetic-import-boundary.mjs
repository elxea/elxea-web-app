#!/usr/bin/env node
// =============================================================================
// check-synthetic-import-boundary.mjs — roji プロファイルの生成データ
// (lib/profile/synthetic/**) が lib/profile/source.ts 以外から import
// されていないことをソースレベルで検査する。
//
// 背景 (2026-09-05 Setaka決定・改訂):
//   「初期はダミーデータで見せる」(Decision Log
//   https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac) により、
//   `PROFILE_DEMO_MODE=true` のときは **本番でも** synthetic を返せるように
//   なった (`lib/profile/source.ts#getProfileSource`)。
//
//   このため「本番ビルド成果物の server bundle に synthetic の種文字列が
//   含まれていたら fail」という旧検査 (check-no-synthetic-in-prod-bundle.mjs)
//   は前提が崩れた — デモモードでは synthetic のコードが実際に本番へ
//   届いて動く必要があるため、「bundle に synthetic が全く無いこと」はもはや
//   守るべき性質ではない。
//
//   守るべき性質は変わっていない: **synthetic への到達経路が
//   `lib/profile/source.ts` の1ファイルだけであること** (生成データ混入防止
//   5層防御・層1「到達不能化」)。これは ESLint `no-restricted-imports`
//   (`eslint.config.mjs`) が静的な import を lint 時に検査しているのと同じ
//   不変条件だが、CI では「lint も通った」だけでなく成果物側でも独立に
//   裏取りしたい (check-edge-bundle.mjs と同じ「2本目の検査で1本目の穴を
//   塞ぐ」思想)。
//
// 処方:
//   ビルド成果物ではなく**ソースファイルの import 指定子**を直接読み、
//   `app/**` `components/**` `lib/**` (ESLint の対象範囲と同じ) のうち
//   `lib/profile/synthetic/**` 自身と `lib/profile/source.ts` を除いた
//   全ファイルが `lib/profile/synthetic` を import していないかを見る。
//   `__tests__/**` は対象外 (ESLint の対象範囲と同じ — テストが直接
//   SyntheticSource の振る舞いを検証する正当な理由がある)。
//
// 使い方:
//   node scripts/check-synthetic-import-boundary.mjs   … ソースツリーを検査
//   (ビルド成果物は不要。`pnpm build` の前後どちらでも実行できる)
//
// 終了コード: 0 = 問題なし / 1 = 違反あり
// =============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["app", "components", "lib"];
const EXTENSIONS = /\.(ts|tsx)$/;

/** この2つだけが `lib/profile/synthetic` へ到達してよい。 */
const ALLOWED_DIR = join("lib", "profile", "synthetic") + sep;
const ALLOWED_FILE = join("lib", "profile", "source.ts");

/** import 指定子として現れる可能性のある書き方 (静的 import / 動的 import / re-export)。 */
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|export\s+\*?\s*(?:as\s+\S+\s+)?from\s+)["'`]([^"'`]*lib\/profile\/synthetic[^"'`]*)["'`]/g;

/** @type {string[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.test(entry)) continue;

    const rel = relative(process.cwd(), full);
    if (rel.startsWith(ALLOWED_DIR) || rel === ALLOWED_FILE) continue;

    const content = readFileSync(full, "utf8");
    let match;
    IMPORT_PATTERN.lastIndex = 0;
    while ((match = IMPORT_PATTERN.exec(content))) {
      violations.push(`${rel}: import "${match[1]}"`);
    }
  }
}

for (const root of ROOTS) {
  try {
    walk(root);
  } catch {
    // ルートが存在しないケースは無い想定だが、存在しなければスキップする
    // (このリポは app/ components/ lib/ の3区画を前提にしている)。
  }
}

if (violations.length > 0) {
  console.error(
    `check-synthetic-import-boundary: lib/profile/synthetic/** への到達経路が\n` +
      `lib/profile/source.ts 以外にも存在する (生成データ混入防止5層防御・層1違反)。\n` +
      violations.map((v) => `  - ${v}`).join("\n"),
  );
  process.exit(1);
}

console.log("check-synthetic-import-boundary: OK (到達経路は lib/profile/source.ts のみ)");
process.exit(0);

#!/usr/bin/env node
// =============================================================================
// check-no-synthetic-in-prod-bundle.mjs — 生成データ (roji プロファイル) が
// 本番の server bundle に混入していないかを検査する。
//
// 背景:
//   roji プロファイル (ミクロ⇔マクロ) は実ユーザーに生成データ (架空の人) を
//   絶対に見せてはならない。防御を5層に組む (Spec §「実ユーザーに生成データを
//   見せない防御」):
//     1. 到達不能化 (ESLint no-restricted-imports で lib/profile/synthetic/**
//        の import を lib/profile/source.ts の1ファイルに限定)
//     2. 実行時 fail-closed (VERCEL_ENV=production × PROFILE_DATA_SOURCE=synthetic
//        は lib/profile/source.ts が例外を投げる)
//     3. キャッシュ隔離 (synthetic 応答は常に private, no-store)
//     4. テストで固定 (__tests__/profile-anonymity.test.ts)
//     5. 開示 (X-Profile-Source ヘッダー)
//
//   本スクリプトは層1の裏取り — 「1ファイルに限定した」という規律が本当に
//   守られ、本番ビルド成果物 (server bundle) から生成データの種が排除されて
//   いるかを、成果物そのものを読んで確認する (check-edge-bundle.mjs と同じ
//   「ビルドした直後に分かる」思想)。
//
// 使い方:
//   node scripts/check-no-synthetic-in-prod-bundle.mjs   … .next を検査 (要 next build 済み)
//
// 終了コード: 0 = 問題なし / 1 = 混入あり / 2 = 検査自体が成立しなかった
// =============================================================================

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const NEXT_SERVER_DIR = join(".next", "server");

/** `lib/profile/synthetic/generators.ts#SYNTHETIC_SEED_MARKER` と同じ文字列。 */
const MARKER = "roji-profile-synthetic-v1";

if (!existsSync(NEXT_SERVER_DIR)) {
  console.error(
    `check-no-synthetic-in-prod-bundle: ${NEXT_SERVER_DIR} が無い。先に \`pnpm build\` を実行すること。\n` +
      `(検査対象はソースではなくビルド成果物)`,
  );
  process.exit(2);
}

/** @type {string[]} */
const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(entry)) continue;
    const content = readFileSync(full, "utf8");
    if (content.includes(MARKER)) hits.push(full);
  }
}

walk(NEXT_SERVER_DIR);

if (hits.length > 0) {
  console.error(
    `check-no-synthetic-in-prod-bundle: 生成データの種が本番 server bundle に混入している。\n` +
      hits.map((h) => `  - ${h}`).join("\n") +
      `\n\nlib/profile/synthetic/** への import 経路が lib/profile/source.ts の\n` +
      `動的 import 以外に増えていないか確認すること (ESLint no-restricted-imports は\n` +
      `静的な import しか塞げない)。`,
  );
  process.exit(1);
}

console.log("check-no-synthetic-in-prod-bundle: OK (混入なし)");
process.exit(0);

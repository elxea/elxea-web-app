/**
 * check-fictional-content.ts
 *
 * `lib/fictional-content.ts` (SoT) と `public/fictional-content.json` (配信物) が
 * 食い違ったまま本番に出るのを止めるビルドゲート。
 *
 * 止めたい事故は 1 方向だけだが、黙って起きると痛い:
 * deny-list に 1 件足したのに JSON を作り直さないと、**アセットハブだけが古い
 * 一覧を読み続け**、本番に出ていないページの写真枠を空き枠として出し続ける。
 * 2026-09-14 に生産者 4 件 / イベント 4 件で実際に起きたのがこの形
 * (そのときは JSON 自体が無く、アセットハブが deny-list を一切知らなかった)。
 *
 * 直し方は常に同じ: `pnpm generate:fictional-content`。
 *
 * package.json の `build` が `next build` の前に走らせる
 * (check-image-slots.ts の直後)。**新しい CI ジョブは足していない** ので
 * GitHub Actions の実行時間は増えない。単体では `pnpm check:fictional-content`。
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  FICTIONAL_JSON_PATH,
  renderFictionalContentJson,
} from "./gen-fictional-content";

const ROOT = path.resolve(__dirname, "..");

/** 実ファイルと期待値を比べる。戻り値が空なら整合。 */
export function checkFictionalContent(jsonPath = FICTIONAL_JSON_PATH): string[] {
  const rel = path.relative(ROOT, jsonPath);
  if (!existsSync(jsonPath)) {
    return [`${rel} が無い — pnpm generate:fictional-content を走らせること`];
  }
  const actual = readFileSync(jsonPath, "utf8");
  if (actual !== renderFictionalContentJson()) {
    return [
      `${rel} が lib/fictional-content.ts と食い違っている — ` +
        `pnpm generate:fictional-content を走らせること`,
    ];
  }
  return [];
}

function main(): void {
  const errors = checkFictionalContent();
  if (errors.length > 0) {
    console.error("fictional-content: 不整合");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("fictional-content: OK (SoT と配信物が一致)");
}

if (require.main === module) main();

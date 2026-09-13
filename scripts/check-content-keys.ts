/**
 * check-content-keys.ts
 *
 * `lib/fictional-content.ts` (SoT) と `public/content-keys.json` (配信物) が
 * 食い違ったまま本番に出るのを止めるビルドゲート。
 *
 * 止めたい事故: SoT に 1 件足したのに符号表を作り直さないと、**社内ツールだけが
 * 古い表を読み続け**、伏せたはずの書類の写真枠が出続ける。
 *
 * 合言葉 (`CONTENT_KEYS_SECRET`) がある環境では 1 バイト単位で照合する。
 * 無い環境 (手元の作業ツリー等) でも **件数**だけは SoT から数えられるので、
 * 作り直し忘れはそこで落ちる。合言葉が無いことを理由に検査を素通りさせない。
 *
 * `build` が `next build` の前に走らせる。**新しい CI ジョブは足していない。**
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  CONTENT_KEYS_PATH,
  CONTENT_KEYS_SCHEMA_VERSION,
  SECRET_ENV,
  renderContentKeysJson,
  sourceEntryCount,
} from "./gen-content-keys";

const ROOT = path.resolve(__dirname, "..");

/** 実ファイルを検査する。戻り値が空なら整合。 */
export function checkContentKeys(
  jsonPath = CONTENT_KEYS_PATH,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const rel = path.relative(ROOT, jsonPath);
  if (!existsSync(jsonPath)) {
    return [`${rel} が無い — pnpm generate:content-keys を走らせること`];
  }
  const raw = readFileSync(jsonPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [`${rel} が JSON として読めない`];
  }
  const errors: string[] = [];
  const doc = parsed as { version?: unknown; keys?: unknown };
  if (doc.version !== CONTENT_KEYS_SCHEMA_VERSION) {
    errors.push(`${rel}: version が ${CONTENT_KEYS_SCHEMA_VERSION} ではない`);
  }
  const keys = doc.keys;
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
    return [...errors, `${rel}: keys が文字列配列ではない`];
  }
  // 符号以外のものが混ざっていないか (元の値が生で載っていないか)。
  const badToken = (keys as string[]).find((k) => !/^[0-9a-f]{32}$/.test(k));
  if (badToken !== undefined) {
    errors.push(`${rel}: 符号の形をしていない要素がある (元の値を載せていないか)`);
  }
  const expected = sourceEntryCount();
  if (keys.length !== expected) {
    errors.push(
      `${rel}: 件数が合わない (配信物 ${keys.length} 件 / SoT ${expected} 件) — ` +
        `pnpm generate:content-keys を走らせること`,
    );
  }

  const secret = env[SECRET_ENV];
  if (typeof secret === "string" && secret.trim() !== "") {
    if (raw !== renderContentKeysJson(secret)) {
      errors.push(
        `${rel} が lib/fictional-content.ts と食い違っている — ` +
          `pnpm generate:content-keys を走らせること`,
      );
    }
  } else {
    console.warn(
      `content-keys: ${SECRET_ENV} が無いので件数と形だけ検査した ` +
        `(完全一致の検査にはデプロイ先と同じ合言葉が要る)`,
    );
  }
  return errors;
}

function main(): void {
  const errors = checkContentKeys();
  if (errors.length > 0) {
    console.error("content-keys: 不整合");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("content-keys: OK");
}

if (require.main === module) main();

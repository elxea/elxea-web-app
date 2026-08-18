/**
 * check-placeholders.ts
 *
 * 仮当て値 (lib/placeholders.ts の `status: ROJI_PLACEHOLDER`) が公開物に出ることを
 * 機械的に止めるビルドゲート。
 *
 * 判定ポリシー (詳細は lib/placeholders.ts の `placeholderGuardMode`):
 *   - 既定 (production / Preview / dev / test すべて) → 未解決 1 件でも exit 1
 *   - `ROJI_PLACEHOLDER_GUARD=off`                    → 常に exit 0 (唯一の逃げ道)
 *
 * 環境で挙動を変えない (2026-08-12 Setaka 決定)。旧仕様は `VERCEL_ENV=production`
 * だけを落としていたため、Preview では通って本番デプロイで初めて落ち、毎回
 * `ROJI_PLACEHOLDER_GUARD=off` で回避する運用になっていた。全環境同一にすれば
 * Preview の時点で気づけるので `off` を使う場面が無くなる。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる。
 * 単体でも `pnpm validate:placeholders` で実行できる。
 *
 * Exit codes: 0 = 公開可 (or guard=off) / 1 = 仮値が残っている
 */

import {
  PLACEHOLDERS,
  PLACEHOLDER_MARKER,
  assertPlaceholdersResolved,
  placeholderGuardMode,
  unresolvedPlaceholderIds,
} from "../lib/placeholders";

function main(): void {
  const mode = placeholderGuardMode(process.env);
  const unresolved = unresolvedPlaceholderIds();
  const total = Object.keys(PLACEHOLDERS).length;

  console.log(
    `placeholder guard: mode=${mode} ` +
      `(VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, ` +
      `ROJI_PLACEHOLDER_GUARD=${process.env.ROJI_PLACEHOLDER_GUARD ?? "unset"})`
  );

  for (const id of unresolved) {
    const entry = PLACEHOLDERS[id as keyof typeof PLACEHOLDERS];
    console.log(
      `  [${mode === "error" ? "FAIL" : "WARN"}] ${id} — ${entry.label}: ` +
        `「${entry.value}」 / 担当: ${entry.owner}`
    );
  }

  try {
    assertPlaceholdersResolved(process.env);
  } catch (err) {
    console.error("");
    console.error(err instanceof Error ? err.message : err);
    console.error("");
    console.error(
      `Summary: ${unresolved.length}/${total} placeholder(s) unresolved — 本番ビルドを中止しました`
    );
    process.exit(1);
  }

  if (unresolved.length === 0) {
    console.log(`OK: ${PLACEHOLDER_MARKER} は残っていません (${total} entries checked)`);
  } else {
    // ここに来るのは ROJI_PLACEHOLDER_GUARD=off を明示したときだけ。
    console.log(
      `OK (guard=off): ${unresolved.length}/${total} placeholder(s) unresolved — ` +
        "明示的にガードを無効化しています。公開前に docs/placeholders.md を消化してください"
    );
  }

  process.exit(0);
}

main();

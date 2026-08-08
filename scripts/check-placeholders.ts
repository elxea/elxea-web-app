/**
 * check-placeholders.ts
 *
 * 仮当て値 (lib/placeholders.ts の `status: ROJI_PLACEHOLDER`) が本番に出ることを
 * 機械的に止めるビルドゲート。
 *
 * 判定ポリシー (詳細は lib/placeholders.ts の `placeholderGuardMode`):
 *   - `VERCEL_ENV=production`            → 未解決 1 件でも exit 1 (本番ビルドを落とす)
 *   - `ROJI_PLACEHOLDER_GUARD=error`     → 同上 (CI / 手元の動作確認用の強制スイッチ)
 *   - `ROJI_PLACEHOLDER_GUARD=off`       → 常に exit 0
 *   - それ以外 (dev / Preview / test)     → 一覧を出すだけで exit 0 (作業を止めない)
 *
 * `NODE_ENV` では判定しない。`next build` はローカルでも `NODE_ENV=production` に
 * なるため、それを条件にすると Preview 用ビルドまで落ちてしまう。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる。
 * 単体でも `pnpm validate:placeholders` で実行できる。
 *
 * Exit codes: 0 = 公開可 or 非 production / 1 = production で仮値が残っている
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
    console.log(
      `OK (non-production): ${unresolved.length}/${total} placeholder(s) unresolved — ` +
        "dev / Preview では落としません。公開前に docs/placeholders.md を消化してください"
    );
  }

  process.exit(0);
}

main();

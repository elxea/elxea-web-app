/**
 * validate-design-kit.ts
 *
 * Drift guard for the generated design-kit.
 * Run: pnpm validate:design-kit   (wired into CI static-checks)
 *
 * Regenerates the kit in memory and asserts it reproduces the committed mirror
 * (scripts/design-system/design-kit.generated.json) exactly. Any change to
 * tokens/*.json, sd.config.mjs, app/globals.css or components/ui/*.tsx that is
 * not accompanied by `pnpm generate:design-kit` fails the build here.
 *
 * Exits 1 on: missing mirror / manual-vs-code collision / missing verified_at /
 * any content difference.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  buildKit,
  flatten,
  MANUAL_PATH,
  REPO_MIRROR_PATH,
  serialize,
} from "./design-kit-lib.ts";

const MAX_REPORTED_DIFFS = 40;

function main(): void {
  const { kit, collisions, manualMissingVerifiedAt } = buildKit({
    volatile: false,
  });

  let failed = false;

  if (collisions.length > 0) {
    failed = true;
    console.log(
      "❌ ERROR: design-kit.manual.json が生成値と衝突している (手書きがコード由来の値を上書きしようとしている):",
    );
    for (const c of collisions) console.log(`   - ${c}`);
    console.log(`   -> 値はコード側で直す。${MANUAL_PATH} には注記のみ書く。`);
  }

  if (manualMissingVerifiedAt.length > 0) {
    failed = true;
    console.log("❌ ERROR: 手動エントリに verified_at が無い:");
    for (const m of manualMissingVerifiedAt) console.log(`   - ${m}`);
  }

  if (!existsSync(REPO_MIRROR_PATH)) {
    console.log(
      `❌ ERROR: ${REPO_MIRROR_PATH} が無い。→ pnpm generate:design-kit を実行してコミットすること。`,
    );
    process.exit(1);
  }

  const expected = serialize(kit);
  const actual = readFileSync(REPO_MIRROR_PATH, "utf8");

  if (expected !== actual) {
    failed = true;
    const a = flatten(JSON.parse(actual));
    const b = flatten(kit);
    const keys = new Set([...a.keys(), ...b.keys()]);
    const diffs: string[] = [];
    for (const key of keys) {
      const av = a.get(key);
      const bv = b.get(key);
      if (av !== bv) {
        diffs.push(
          `   - ${key}\n       committed: ${av ?? "(absent)"}\n       regenerated: ${bv ?? "(absent)"}`,
        );
      }
    }
    console.log(
      `❌ ERROR: design-kit がコードとずれている (${diffs.length} 箇所)。`,
    );
    for (const d of diffs.slice(0, MAX_REPORTED_DIFFS)) console.log(d);
    if (diffs.length > MAX_REPORTED_DIFFS) {
      console.log(`   ... 他 ${diffs.length - MAX_REPORTED_DIFFS} 箇所`);
    }
    console.log(
      "\n   -> pnpm generate:design-kit を実行して差分をコミットすること。",
    );
  }

  if (failed) process.exit(1);

  const counts = kit.counts as Record<string, unknown>;
  console.log(
    `✅ design-kit is in sync with code ` +
      `(components=${counts.code_ui_components} / conflicts=${counts.conflicts} / known_gaps=${counts.known_gaps})`,
  );
}

main();

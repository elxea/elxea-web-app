#!/usr/bin/env node
/**
 * Publish "how many E2E tests skipped themselves, and why" to the CI job summary.
 *
 * Why this exists
 * ---------------
 * The E2E suite is full of runtime guards like
 *
 *     test.skip(!process.env.CRON_SECRET, "CRON_SECRET が設定されていません");
 *
 * CI injects almost none of those secrets, so a large slice of the suite skips
 * itself and the job still goes green. Playwright's own console line reports the
 * count but the job *status* does not, so "e2e-tests: passed" was being read as
 * "the subscription flow works" when nothing in it had run. That is a no-op
 * green: the most expensive kind of false confidence, because it looks like
 * coverage.
 *
 * This script does NOT enable those tests and does NOT fail the build. Turning
 * them on means provisioning secrets, which is a separate decision. All it does
 * is make the silence audible, so the gap is visible on every run instead of
 * needing an inventory to rediscover.
 *
 * Usage
 * -----
 *   node scripts/ci/e2e-skip-summary.mjs [path-to-playwright-json-report]
 *
 * Defaults to `test-results/e2e-report.json` (written by the `json` reporter in
 * playwright.config.ts when CI=1). Appends Markdown to $GITHUB_STEP_SUMMARY when
 * that is set, and always prints the same table to stdout for local runs.
 *
 * Exit code is 0 even when the report is missing: this is a reporting aid, and
 * failing the build here would mean a reporting bug could mask the actual test
 * result. A missing report is reported as a warning in the summary instead.
 */

import fs from "node:fs";
import path from "node:path";

const reportPath = process.argv[2] ?? "test-results/e2e-report.json";

/** Append to the GitHub job summary if we're on Actions; always echo locally. */
function emit(markdown) {
  process.stdout.write(markdown + "\n");
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdown + "\n");
    } catch (err) {
      // Never let a summary-write problem change the job result.
      process.stderr.write(`[e2e-skip-summary] could not write job summary: ${err.message}\n`);
    }
  }
}

if (!fs.existsSync(reportPath)) {
  emit(
    `## E2E skip summary\n\n[WARN] Playwright JSON report not found at \`${reportPath}\`. ` +
      `Skip visibility is unavailable for this run (the tests themselves are unaffected).`,
  );
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (err) {
  emit(`## E2E skip summary\n\n[WARN] Could not parse \`${reportPath}\`: ${err.message}`);
  process.exit(0);
}

/**
 * Walk the nested suite tree and collect one row per test.
 *
 * Playwright nests suites arbitrarily deep (file -> describe -> describe), and
 * the file path only appears on some levels, so it is threaded down.
 */
const rows = [];

function walkSuite(suite, file) {
  const currentFile = suite.file ?? file;

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      // Reasons come from annotations. A runtime `test.skip(cond, "reason")`
      // records {type:"skip", description:"reason"}; a declaration-level
      // `test.skip("title", fn)` records {type:"skip"} with no description.
      const annotations = [...(test.annotations ?? []), ...(spec.annotations ?? [])];
      const skipNotes = annotations
        .filter((a) => a.type === "skip" || a.type === "fixme")
        .map((a) => (a.description ?? "").trim())
        .filter(Boolean);

      // `results[].status` is what actually happened; `test.status` is the
      // expected outcome. A test skipped at runtime has an outcome of "skipped".
      const statuses = (test.results ?? []).map((r) => r.status);
      const skipped =
        test.status === "skipped" ||
        (statuses.length > 0 && statuses.every((s) => s === "skipped"));

      if (!skipped) continue;

      rows.push({
        file: currentFile ? path.basename(currentFile) : "(unknown)",
        title: [...(spec.titlePath ?? []), spec.title].filter(Boolean).join(" > ") || spec.title,
        // Declaration-level skips carry no reason. Say so explicitly rather than
        // leaving a blank cell that reads as "no reason needed".
        reason: skipNotes.length > 0 ? skipNotes.join(" / ") : "(理由未記載 — 恒久 skip の可能性)",
      });
    }
  }

  for (const child of suite.suites ?? []) walkSuite(child, currentFile);
}

for (const suite of report.suites ?? []) walkSuite(suite, suite.file);

const stats = report.stats ?? {};
const expected = stats.expected ?? 0;
const unexpected = stats.unexpected ?? 0;
const flaky = stats.flaky ?? 0;
const skippedCount = stats.skipped ?? rows.length;
const total = expected + unexpected + flaky + skippedCount;

// Group identical reasons: 17 tests sharing one missing precondition is one
// problem to fix, not 17, and the grouped view makes that obvious.
const byReason = new Map();
for (const r of rows) {
  const entry = byReason.get(r.reason) ?? { count: 0, files: new Set() };
  entry.count += 1;
  entry.files.add(r.file);
  byReason.set(r.reason, entry);
}

const lines = [];
lines.push("## E2E skip summary");
lines.push("");

if (total > 0) {
  const ranPct = ((expected / total) * 100).toFixed(1);
  const skipPct = ((skippedCount / total) * 100).toFixed(1);
  lines.push(
    `**${skippedCount} / ${total} tests skipped (${skipPct}%).** ` +
      `Actually asserted: ${expected} (${ranPct}%)` +
      (unexpected > 0 ? ` — failed: ${unexpected}` : "") +
      (flaky > 0 ? ` — flaky: ${flaky}` : "") +
      ".",
  );
} else {
  lines.push(`**${skippedCount} tests skipped.**`);
}
lines.push("");

if (rows.length === 0) {
  lines.push("No skipped tests in this run.");
} else {
  lines.push(
    "A skipped test is a green check that verified nothing. These are not " +
      "failures, but they are also not coverage — most need a secret or a " +
      "Shopify fixture before they can assert anything.",
  );
  lines.push("");
  lines.push("### Grouped by reason");
  lines.push("");
  lines.push("| Tests | Reason | Specs |");
  lines.push("| ---: | --- | --- |");
  for (const [reason, entry] of [...byReason.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const files = [...entry.files].sort().join(", ");
    lines.push(`| ${entry.count} | ${escapeCell(reason)} | ${escapeCell(files)} |`);
  }
  lines.push("");
  lines.push("<details><summary>Per-test detail</summary>");
  lines.push("");
  lines.push("| Spec | Test | Reason |");
  lines.push("| --- | --- | --- |");
  for (const r of rows) {
    lines.push(`| ${escapeCell(r.file)} | ${escapeCell(r.title)} | ${escapeCell(r.reason)} |`);
  }
  lines.push("");
  lines.push("</details>");
}

/** Keep pipes and newlines from breaking the Markdown table. */
function escapeCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

emit(lines.join("\n"));

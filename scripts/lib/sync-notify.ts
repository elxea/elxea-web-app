/**
 * Outcome reporting for the Notion → Sanity sync.
 *
 * Before this existed, every failure path was `console.error` + `process.exit(1)`
 * with no notification target configured, so a broken sync produced no signal
 * anywhere — a silent failure. The rules below come from the Spec:
 *
 *   - all-success            → do NOT notify (no noise on the happy path)
 *   - partial failure        → notify with synced / failed counts and the
 *                              slugs that failed
 *   - input fetch failure    → ALWAYS notify, and never let it look like
 *                              "there were simply 0 published articles"
 *   - 0 fetched              → state explicitly which of the two it was
 *
 * Every non-success outcome lands in at least one durable place even when no
 * Slack webhook is configured: the GitHub Actions job summary and a
 * machine-readable result file the workflow reads to decide whether to open /
 * bump a tracking issue. Slack is an additional channel, never the only one.
 */

import { appendFileSync, writeFileSync } from "fs";

export type SyncOutcome =
  /** Everything requested succeeded (including a legitimate 0 published items). */
  | "success"
  /** Input was fetched, but some items failed to sync. */
  | "partial"
  /** Could not read the input at all — must never be confused with "0 items". */
  | "input-failure"
  /** Required configuration is absent (missing secrets / env vars). */
  | "config-error"
  /** Anything else that aborted the run. */
  | "fatal";

/** Process exit code per outcome, so the caller/runner can distinguish causes. */
export const EXIT_CODES: Record<SyncOutcome, number> = {
  success: 0,
  partial: 1,
  "input-failure": 2,
  "config-error": 3,
  fatal: 4,
};

export interface SyncReport {
  /** Which sub-sync this is, e.g. "articles" or "pages". */
  job: string;
  outcome: SyncOutcome;
  dryRun: boolean;
  dataset: string;
  /** Items read from the input (Notion). `null` when the fetch itself failed. */
  fetched: number | null;
  synced: number;
  errors: number;
  /** Identifiers (slugs) of items that failed, for actionable notifications. */
  failures?: string[];
  /** One-line human explanation. Never include secret values. */
  message?: string;
}

function isTruthyOutcome(outcome: SyncOutcome): boolean {
  return outcome === "success";
}

/**
 * Human-readable line describing the count situation.
 *
 * This is the "0 件" disambiguation the Spec demands: a failed fetch and an
 * empty-but-healthy input must read differently.
 */
export function describeCounts(report: SyncReport): string {
  if (report.outcome === "config-error") {
    return "設定不足のため実行前に停止 (入力の読み取りは行っていない)";
  }
  if (report.fetched === null) {
    return "入力の取得に失敗 (取得件数不明 — 「公開対象 0 件」ではない)";
  }
  if (report.fetched === 0) {
    return "入力の取得は成功。公開対象が 0 件 (正常)";
  }
  return `取得 ${report.fetched} 件 / 同期成功 ${report.synced} 件 / 失敗 ${report.errors} 件`;
}

function renderSummary(report: SyncReport): string {
  const lines = [
    `### sync (${report.job}) — ${report.outcome}`,
    "",
    `- dataset: \`${report.dataset}\`${report.dryRun ? " (dry-run — Sanity への書き込みなし)" : ""}`,
    `- ${describeCounts(report)}`,
  ];
  if (report.message) lines.push(`- ${report.message}`);
  if (report.failures?.length) {
    lines.push(`- 失敗した記事 (${report.failures.length} 件): ${report.failures.join(", ")}`);
  }
  return lines.join("\n") + "\n\n";
}

/**
 * 通知の見出しに出す同期の名前。
 *
 * `job` をそのまま英語で出すと読み手が何の同期か分からないので日本語に寄せる。
 * 未知の job でも「<job> 同期」で通る形にして、対象が増えたときに
 * 「記事同期」と誤って名乗らないようにする (茶譜の失敗が記事の失敗に見えた)。
 */
function jobLabel(job: string): string {
  const labels: Record<string, string> = {
    articles: "記事同期",
    pages: "ページ同期",
    "tea-menu": "茶譜同期",
    config: "同期設定",
  };
  return labels[job] ?? `${job} 同期`;
}

function renderSlackText(report: SyncReport): string {
  const name = jobLabel(report.job);
  const head =
    report.outcome === "input-failure"
      ? `${name}: 入力の取得に失敗`
      : report.outcome === "config-error"
        ? `${name}: 設定不足で実行できず`
        : report.outcome === "partial"
          ? `${name}: 一部失敗`
          : `${name}: 異常終了`;

  const lines = [
    `${head} (${report.job} / ${report.dataset}${report.dryRun ? " / dry-run" : ""})`,
    describeCounts(report),
  ];
  if (report.message) lines.push(report.message);
  if (report.failures?.length) {
    lines.push(`失敗: ${report.failures.join(", ")}`);
  }
  const runUrl = runUrlOrNull();
  if (runUrl) lines.push(runUrl);
  return lines.join("\n");
}

function runUrlOrNull(): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

/**
 * Emit the report to every configured sink. Never throws: a notification
 * problem must not mask the sync outcome it is trying to report.
 *
 * Sinks, in order of reliability:
 *  1. stdout — a grep-able `SYNC_RESULT` JSON line, always present in the log.
 *  2. `$GITHUB_STEP_SUMMARY` — rendered on the run page, always present in CI.
 *  3. `$SYNC_RESULT_PATH` — machine-readable file the workflow reads to decide
 *     whether to open/bump the tracking issue (the durable record).
 *  4. `$SLACK_WEBHOOK_URL` — only for non-success outcomes, and only if set.
 */
export async function reportSyncResult(report: SyncReport): Promise<void> {
  // 1. Always in the log.
  console.log(`SYNC_RESULT ${JSON.stringify(report)}`);

  // 2. Run page summary.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, renderSummary(report), "utf-8");
    } catch (err) {
      console.error(`  [notify] step summary write failed: ${errText(err)}`);
    }
  }

  // 3. Machine-readable result for the workflow.
  const resultPath = process.env.SYNC_RESULT_PATH;
  if (resultPath) {
    try {
      writeFileSync(resultPath, JSON.stringify(report, null, 2), "utf-8");
    } catch (err) {
      console.error(`  [notify] result file write failed: ${errText(err)}`);
    }
  }

  // 4. Slack — failures only. Silence on success is intentional (Spec).
  if (isTruthyOutcome(report.outcome)) return;

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    // Make the *absence* of the channel visible rather than silently skipping,
    // otherwise we have reintroduced the silent-failure problem one level up.
    console.error(
      "  [notify] SLACK_WEBHOOK_URL is not set — failure was recorded in the " +
        "job summary and result file only, no Slack message was sent."
    );
    if (summaryPath) {
      try {
        appendFileSync(
          summaryPath,
          "> 注記: `SLACK_WEBHOOK_URL` が未設定のため Slack 通知は送信されていません。\n\n",
          "utf-8"
        );
      } catch {
        /* already reported above */
      }
    }
    return;
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: renderSlackText(report) }),
    });
    if (!res.ok) {
      console.error(`  [notify] Slack webhook returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`  [notify] Slack webhook failed: ${errText(err)}`);
  }
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

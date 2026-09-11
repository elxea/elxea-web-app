#!/usr/bin/env node
// =============================================================================
// verify-production.mjs — 本番で「何が配信されているか」を秘密情報なしで確かめる
//
// なぜ必要か
// ----------
// 本番はサイトパスワードで保護されており、パスワードを持たない側 (エージェント・
// 監視・当番でない人) は中身を確認できない。「200 が返るか」だけの監視では、古い
// デプロイが生きていても緑になる。見るべきは「応答があるか」ではなく「**何が**
// 配信されているか」。
//
// 既存の check-prod-main-sync.mjs との違い (重複ではない)
// -----------------------------------------------------
//   check-prod-main-sync : Vercel の**デプロイ記録** (meta.githubCommitSha) を読む。
//                          VERCEL_TOKEN (秘密) が要る。
//   これ                 : **動いているアプリ自身の応答** を読む。秘密は要らない。
//
// 「Vercel がデプロイしたと記録している」と「いまリクエストに答えているコードが
// それだ」は別の事実。本番の前段には Cloudflare が居るため (実測 2026-09-11)、
// デプロイ記録だけでは配信面の実体を保証できない。
//
// 使い方
// ------
//   node scripts/ops/verify-production.mjs
//   node scripts/ops/verify-production.mjs --expect-sha "$(git rev-parse origin/main)"
//   node scripts/ops/verify-production.mjs --json
//
// 終了コード (fail-closed)
// ------------------------
//   0 = 検証できて、期待どおり
//   1 = 検証できて、期待と違う (ずれ / 保護の緩み / ルート異常)
//   2 = **検証できなかった** (到達不能 / SHA が unknown)。成功として扱わないこと。
//       「検証していない」を「検証して問題なかった」と同じ緑にしない
//       (2026-08-18 に 259 commit のズレを見逃した原因がこれ)。
// =============================================================================

const DEFAULT_BASE_URL = "https://elxea.com";

/**
 * 主要ルート。「サイトの入口として壊れていたら困る」ものだけ。
 * gate が有効な本番では 307 → /password になるのが正常なので、ステータスの値では
 * なく「応答が返ること」「404/5xx でないこと」を見る。
 */
const KEY_ROUTES = ["/", "/ja", "/ja/products", "/ja/journal", "/ja/about"];

/** `/api/version` が返してよいキー。増えていたら余計な情報を返しているので落とす。 */
const ALLOWED_VERSION_KEYS = ["sha", "shaShort", "env"];

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PRODUCTION_URL || DEFAULT_BASE_URL,
    expectSha: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--expect-sha") args.expectSha = (argv[++i] || "").trim();
    else if (a === "--json") args.json = true;
  }
  return args;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.baseUrl.replace(/\/$/, "");
  const findings = [];
  const report = { baseUrl: base, checkedAt: new Date().toISOString(), routes: [] };

  // ── 1. 配信中のビルドを取る ────────────────────────────────────────────────
  let version;
  try {
    const res = await fetchWithTimeout(`${base}/api/version`);
    if (res.status !== 200) {
      return finish(2, report, [`/api/version が ${res.status} を返した (検証不能)`], args);
    }
    version = await res.json();
  } catch (err) {
    return finish(2, report, [`/api/version に到達できない: ${err.message} (検証不能)`], args);
  }
  report.version = version;

  const extraKeys = Object.keys(version).filter((k) => !ALLOWED_VERSION_KEYS.includes(k));
  if (extraKeys.length > 0) {
    findings.push(`/api/version が想定外のキーを返している: ${extraKeys.join(", ")}`);
  }

  if (!version.sha || version.sha === "unknown") {
    return finish(
      2,
      report,
      ["配信中の commit SHA が unknown (Vercel の git メタデータが無い) — 検証不能"],
      args,
    );
  }

  // ── 2. 期待する SHA と一致するか ──────────────────────────────────────────
  if (args.expectSha && version.sha !== args.expectSha) {
    findings.push(
      `配信中の SHA が期待と違う: live=${version.sha.slice(0, 7)} expected=${args.expectSha.slice(0, 7)}`,
    );
  }

  // ── 3. 主要ルートが応答するか ─────────────────────────────────────────────
  //
  // ここで見られるのは「応答が返ること」まで。**ルートごとに配信ビルドを個別に
  // 突き合わせることはしない** — それには全応答へビルドヘッダーを付ける middleware の
  // 変更が要り、本 PR では行っていないため。できないことを、できたことにしない。
  for (const path of KEY_ROUTES) {
    const entry = { path };
    try {
      const res = await fetchWithTimeout(`${base}${path}`);
      entry.status = res.status;
      entry.location = res.headers.get("location") || "";

      if (res.status >= 500) {
        findings.push(`${path} がサーバーエラー (${res.status})`);
      } else if (res.status === 404) {
        findings.push(`${path} が 404 (ルートが失われている)`);
      }
    } catch (err) {
      entry.error = err.message;
      findings.push(`${path} に到達できない: ${err.message}`);
    }
    report.routes.push(entry);
  }

  // ── 4. サイトパスワード保護が緩んでいないか (本番のみ) ────────────────────
  // 本番で `/ja` が 200 を返すなら gate が外れて中身が誰でも読める状態。この検証経路
  // は保護を弱めないことが前提なので、緩みを検知したら落とす。
  if (version.env === "production") {
    const home = report.routes.find((r) => r.path === "/ja");
    if (home && home.status === 200) {
      findings.push(
        "サイトパスワード保護が効いていない: /ja が 200 を返した (中身が公開されている)",
      );
    }
  }

  return finish(findings.length > 0 ? 1 : 0, report, findings, args);
}

function finish(code, report, findings, args) {
  report.findings = findings;
  report.result = code === 0 ? "ok" : code === 1 ? "drift" : "unverifiable";

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const v = report.version || {};
    process.stdout.write(`base   : ${report.baseUrl}\n`);
    process.stdout.write(`result : ${report.result}\n`);
    process.stdout.write(`sha    : ${v.sha || "-"}\n`);
    process.stdout.write(`env    : ${v.env || "-"}\n`);
    for (const r of report.routes || []) {
      process.stdout.write(`  ${String(r.status ?? "ERR").padEnd(4)} ${r.path}\n`);
    }
    for (const f of findings) process.stdout.write(`  [FAIL] ${f}\n`);
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`verify-production: ${err.stack || err.message}\n`);
  process.exit(2);
});

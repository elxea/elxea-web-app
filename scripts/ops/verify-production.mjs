#!/usr/bin/env node
/**
 * 本番で「何が配信されているか」を、サイトパスワードなしで機械的に確かめる。
 *
 * なぜ必要か
 * ----------
 * 本番はサイトパスワードで保護されており、エージェントはパスワードを入力できない。
 * そのため中身を一切確認できず、「本番が古いデプロイのまま 14 時間気づかない」事故が
 * 実際に起きた。さらに「200 が返るか」だけの監視では、**古いデプロイが生きていても緑**
 * になることが 2026-08-18 に実証されている。
 *
 * そこでこのスクリプトは「応答があるか」ではなく「**何が**配信されているか」を見る:
 *   1. `GET /api/version`          → 配信中の commit SHA / ビルド時刻 / デプロイ ID
 *   2. 主要ルートの `x-elxea-build` → 各ルートが「同じビルド」で応答しているか
 *   3. サイトパスワード gate の健全性 → 保護が緩んでいないか (200 で中身が出ていないか)
 *
 * 使い方
 * ------
 *   node scripts/ops/verify-production.mjs
 *   node scripts/ops/verify-production.mjs --expect-sha "$(git rev-parse origin/main)"
 *   node scripts/ops/verify-production.mjs --max-age-hours 24 --json
 *
 * 終了コード (fail-closed)
 * ------------------------
 *   0 = 検証できて、期待どおり
 *   1 = 検証できて、期待と違う (ずれ / 保護の緩み / ルート異常)
 *   2 = **検証できなかった** (到達不能 / SHA が unknown)。成功として扱わないこと。
 */

const DEFAULT_BASE_URL = "https://elxea.com";

/**
 * 主要ルート。「サイトの入口として壊れていたら困る」ものだけを挙げる。
 * gate が有効な本番では 307 → /password になるのが正常。ここで見たいのは
 * ステータスそのものではなく「応答が返る」ことと「どのビルドが応答したか」。
 */
const KEY_ROUTES = ["/", "/ja", "/ja/products", "/ja/journal", "/ja/about"];

/** `/api/version` が返してよいキー。増えていたら「余計な情報を返している」ので落とす。 */
const ALLOWED_VERSION_KEYS = ["sha", "shaShort", "builtAt", "env", "deploymentId"];

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PRODUCTION_URL || DEFAULT_BASE_URL,
    expectSha: "",
    maxAgeHours: 0,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--expect-sha") args.expectSha = (argv[++i] || "").trim();
    else if (a === "--max-age-hours") args.maxAgeHours = Number(argv[++i] ?? 0);
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
      ["配信中の commit SHA が unknown (ビルドに焼き込まれていない) — 検証不能"],
      args,
    );
  }

  // ── 2. 期待する SHA と一致するか ──────────────────────────────────────────
  if (args.expectSha && version.sha !== args.expectSha) {
    findings.push(
      `配信中の SHA が期待と違う: live=${version.sha.slice(0, 7)} expected=${args.expectSha.slice(0, 7)}`,
    );
  }

  // ── 3. ビルドが古すぎないか ───────────────────────────────────────────────
  if (version.builtAt && version.builtAt !== "unknown") {
    const ageHours = (Date.now() - Date.parse(version.builtAt)) / 3600000;
    report.buildAgeHours = Number(ageHours.toFixed(2));
    if (args.maxAgeHours > 0 && ageHours > args.maxAgeHours) {
      findings.push(
        `本番のビルドが古い: ${ageHours.toFixed(1)}h 前 (上限 ${args.maxAgeHours}h)`,
      );
    }
  } else {
    findings.push("ビルド時刻が unknown (焼き込みが効いていない)");
  }

  // ── 4. 主要ルートが「同じビルドで」応答するか ─────────────────────────────
  for (const path of KEY_ROUTES) {
    let entry = { path };
    try {
      const res = await fetchWithTimeout(`${base}${path}`);
      entry.status = res.status;
      entry.build = res.headers.get("x-elxea-build") || "";
      entry.location = res.headers.get("location") || "";

      if (res.status >= 500) {
        findings.push(`${path} がサーバーエラー (${res.status})`);
      } else if (res.status === 404) {
        findings.push(`${path} が 404 (ルートが失われている)`);
      }

      // 応答したビルドが /api/version と食い違う = 配信面がまだ入れ替わっていない。
      if (entry.build && entry.build !== version.shaShort) {
        findings.push(
          `${path} が別ビルドで応答している: route=${entry.build} api=${version.shaShort}`,
        );
      }
      if (!entry.build) {
        findings.push(`${path} に x-elxea-build が無い (配信中のビルドを特定できない)`);
      }
    } catch (err) {
      entry.error = err.message;
      findings.push(`${path} に到達できない: ${err.message}`);
    }
    report.routes.push(entry);
  }

  // ── 5. サイトパスワード保護が緩んでいないか (本番のみ) ────────────────────
  // 本番で `/ja` が 200 を返すなら、gate が外れて中身が誰でも読める状態。
  // この検証経路は保護を弱めないことが前提なので、緩みを検知したら失敗させる。
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
    process.stdout.write(`base      : ${report.baseUrl}\n`);
    process.stdout.write(`result    : ${report.result}\n`);
    process.stdout.write(`sha       : ${v.sha || "-"}\n`);
    process.stdout.write(`builtAt   : ${v.builtAt || "-"}\n`);
    process.stdout.write(`env       : ${v.env || "-"}\n`);
    process.stdout.write(`deployment: ${v.deploymentId || "-"}\n`);
    for (const r of report.routes || []) {
      process.stdout.write(`  ${String(r.status ?? "ERR").padEnd(4)} ${r.path} (build=${r.build || "-"})\n`);
    }
    for (const f of findings) process.stdout.write(`  [FAIL] ${f}\n`);
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`verify-production: ${err.stack || err.message}\n`);
  process.exit(2);
});

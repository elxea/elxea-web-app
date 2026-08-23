#!/usr/bin/env node
// =============================================================================
// monitor-line-prod.mjs — LINE 連携・ログインの本番監視 (ログ検知 + ヘルスプローブ)
//
// 判定ロジックは scripts/ops/lib/line-log-monitor.mjs (純粋関数・単体テストあり)。
// ここは I/O だけ: vercel からログを引き、本番に 2 本プローブを撃ち、結果を書く。
//
// 使い方:
//   node scripts/ops/monitor-line-prod.mjs [--since 65m] [--limit 1000]
//                                          [--base-url https://elxea.com]
//                                          [--skip-logs] [--self-test]
//
// 終了コード: 0 異常なし / 1 異常検知 / 2 監視自体が失敗 (= 判断材料が無い)
//
// -----------------------------------------------------------------------------
// ## 取得できる時間窓 — ここが設計の制約 (実行間隔を変える前に読むこと)
//
// この Vercel プロジェクトは **Hobby (無料) プラン**で、Runtime Logs の保持は
// **1 時間**しかない (Pro で 1 日 / Enterprise で 3 日)。
//   https://vercel.com/docs/logs/runtime  ("Limits")
// Log Drains は Pro 以上の機能なので、無料のまま外へ流し続けることもできない。
//   https://vercel.com/docs/drains
//
// つまり「6 時間ごとに直近ログを見る」は成立しない。5 時間分は取得時点で消えて
// いる。よって cron は **30 分ごと**、取得窓は **65 分**にしてある (窓 > 間隔で
// 重ねるのは、GitHub の cron が数十分遅れて起動することがあるため)。
//
// それでも取りこぼしは原理的にゼロにはならない: GitHub Actions の schedule が
// 60 分以上遅れた場合、その差分のログは Vercel 側から既に消えている。ログ検知は
// **best-effort** であり、それを埋めるのが下のヘルスプローブ (毎回必ず実行され、
// 保持期間に依存しない)。この非対称を承知の上で運用すること。
//
// 恒久的に取りこぼしを無くしたいなら選択肢は 2 つだけ: Vercel Pro へ上げる
// (保持 1 日) か、Log Drain で外部に流す (Pro 以上)。どちらも課金が要る。
// -----------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import {
  decideOutcome,
  dedupeById,
  evaluateProbe,
  parseLogLines,
  scanLogEntries,
  summarize,
} from './lib/line-log-monitor.mjs';

const args = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const hasFlag = (name) => args.includes(name);

const SINCE = getOpt('--since', '65m');
const LIMIT = getOpt('--limit', '1000');
const BASE_URL = (getOpt('--base-url', process.env.MONITOR_BASE_URL || 'https://elxea.com')).replace(/\/$/, '');
const PROJECT = getOpt('--project', 'elxea-web-app');
const RESULT_PATH = process.env.MONITOR_RESULT_PATH || '';

/** `--since 65m` の "65" を取り出す (要約の表示用)。 */
const windowMinutes = (() => {
  const m = /^(\d+)\s*([mh])$/.exec(SINCE);
  if (!m) return SINCE;
  return m[2] === 'h' ? Number(m[1]) * 60 : Number(m[1]);
})();

// -----------------------------------------------------------------------------
// ヘルスプローブ — 設定破壊の即検知
//
// どちらも LINE には一切送信しない。
//   - /api/line-login は認可 URL を組み立てて 307 を返すだけ (LINE への通信なし)
//   - /api/user/line-link/init は未ログインなので 401 で即座に折り返す
//     (LINE を呼ぶ手前で終わる)
// つまりこのプローブが LINE 側に実トラフィックを生むことはない。
// -----------------------------------------------------------------------------
const PROBES = [
  {
    name: 'line-login-redirect',
    path: '/api/line-login',
    method: 'GET',
    expectedStatus: 307,
    // 行き先まで見る。307 だけ見ると、サイトのパスワード保護が前に出て
    // /password へ飛ばしている状態を緑と誤認する。
    expectedLocationHost: 'access.line.me',
    description: 'LINE ログイン開始が access.line.me へ 307 で渡していること',
  },
  {
    name: 'line-link-init-unauthorized',
    path: '/api/user/line-link/init',
    method: 'POST',
    // 未ログインで 401。503 に変わったら env 欠落かホスト未登録 (= 設定破壊)。
    expectedStatus: 401,
    description: '連携開始が未ログインを 401 で弾いていること (503 なら設定破壊)',
  },
];

async function runProbe(probe) {
  const url = `${BASE_URL}${probe.path}`;
  try {
    const res = await fetch(url, {
      method: probe.method,
      redirect: 'manual',
      headers: probe.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: probe.method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    return {
      status: res.status,
      location: res.headers.get('location'),
      error: null,
    };
  } catch (err) {
    return { status: null, location: null, error: String(err) };
  }
}

/**
 * ログの引き方 — 2 回に分けて引く理由 (絞り込みを変える前に読むこと)
 *
 * 素朴に全ログを引くと破綻する。このサイトは bot 込みで毎時 1 万行規模あり、
 * `--limit 1000` は 23 分で埋まった。上限まで埋まった取得は「古い方から静かに
 * 落ちる」ので、**窓の前半にあった LINE の失敗が消える**。それでも exit 0 に
 * なるため、壊れているのに緑になる。
 *
 * そこで CLI 側で絞る。ただし絞り込みの意味は**実測で確かめてから**使うこと。
 * 2026-08-23 に本番で対照実験した結果:
 *
 *   --status-code 307   → 200 行 (上限まで) …… 効く
 *   --status-code 5xx   → 0 行            …… 効く (実際に 5xx が無い)
 *   --query password    → 200 行 (上限まで) …… 効く
 *   --query line        → 9 行             …… 効く (LINE route だけが返る)
 *   --level info        → 3 行             …… **信用できない**
 *
 * 最後の 1 つが罠。絞らずに引いた行はほぼ全て `"level":"info"` なのに、
 * `--level info` は 3 行しか返さない。つまり `--level` は出力の level 項目とは
 * 別物を見ている。`--level error` が 0 でも「エラーが無い」証拠にならないので、
 * **この監視では --level を使わない**。
 *
 * 使うのは実測で挙動を確認できた 2 つだけ:
 *   A. --query line    … LINE の route は全て path に "line" を含む。message も
 *                        全文検索の対象なので、失敗ログの本文ごと拾える。
 *   B. --status-code 5xx … A が万一取り逃しても 5xx だけは別経路で拾う保険。
 *
 * 2 回引くと同じ行が両方に出るので、id で重複を落としてから判定する。
 */
const LOG_PASSES = [
  { name: 'line-routes', args: ['--query', 'line'] },
  { name: 'server-errors', args: ['--status-code', '5xx'] },
];

function runLogPass(pass) {
  const res = spawnSync(
    'npx',
    [
      '--yes',
      'vercel@50',
      'logs',
      '--project', PROJECT,
      '--environment', 'production',
      // ブランチ自動判定を切る。CI の checkout は監視対象ブランチとは限らず、
      // 既定のままだと「該当ブランチのログ 0 件」を異常なしと誤認する。
      '--no-branch',
      '--no-follow',
      '--since', SINCE,
      '--limit', LIMIT,
      '--json',
      ...pass.args,
    ],
    { encoding: 'utf8', timeout: 180_000, env: process.env },
  );

  if (res.error) return { ok: false, reason: `vercel CLI 起動失敗: ${res.error.message}`, lines: [] };
  if (res.status !== 0) {
    const stderr = (res.stderr || '').split('\n').slice(-5).join(' ').slice(0, 300);
    return { ok: false, reason: `vercel logs が exit ${res.status}: ${stderr}`, lines: [] };
  }

  return { ok: true, reason: null, lines: (res.stdout || '').split('\n') };
}

function fetchLogEntries() {
  // VERCEL_TOKEN は env 経由で CLI に渡る。コマンドラインに載せない
  // (プロセス一覧と Actions のログに出るため)。
  if (!process.env.VERCEL_TOKEN) {
    return { ok: false, reason: 'VERCEL_TOKEN が無い', entries: [], saturated: [] };
  }

  const all = [];
  const saturated = [];
  let unparsable = 0;

  for (const pass of LOG_PASSES) {
    const res = runLogPass(pass);
    // 片方でも引けなければ全体を fatal にする。半分だけ見て「異常なし」と
    // 言うのは、見ていない範囲を緑と report することになる。
    if (!res.ok) return { ok: false, reason: `${pass.name}: ${res.reason}`, entries: [], saturated: [] };

    const parsed = parseLogLines(res.lines);
    unparsable += parsed.unparsable;
    all.push(...parsed.entries);

    // 上限まで埋まった = 古い側が落ちている可能性がある。黙って通さない。
    if (parsed.entries.length >= Number(LIMIT)) saturated.push(pass.name);
    console.log(`[logs] ${pass.name}: ${parsed.entries.length} 行`);
  }

  return { ok: true, reason: null, entries: dedupeById(all), saturated, unparsable };
}

async function main() {
  const findings = [];
  let scanned = 0;
  let fatal = null;

  // --- 1. ログ検知 -----------------------------------------------------------
  if (hasFlag('--skip-logs')) {
    console.log('[logs] --skip-logs のため取得を省略');
  } else {
    const fetched = fetchLogEntries();
    if (!fetched.ok) {
      // ここを「異常なし」に倒さない。ログが引けない run は判断材料が無い run で
      // あって、平穏な run ではない。
      fatal = `ログを取得できなかった: ${fetched.reason}`;
      console.error(`[logs] ${fatal}`);
    } else {
      const scan = scanLogEntries(fetched.entries);
      scanned = scan.scanned;
      findings.push(...scan.findings);
      console.log(
        `[logs] 重複除去後 ${scan.scanned} 行を検査 (解析不能 ${fetched.unparsable} 行) / 検知 ${scan.findings.length} 件`,
      );

      // 取得が上限で頭打ちなら、窓の古い側を見ていない可能性がある。
      // 「異常なし」と言い切れないので、それ自体を異常として上げる。
      if (fetched.saturated.length > 0) {
        findings.push({
          kind: 'coverage',
          id: 'log-window-truncated',
          severity: 'error',
          description: `ログ取得が上限 ${LIMIT} 行で頭打ち (${fetched.saturated.join(', ')}) — 窓の古い側を検査できていない`,
          requestPath: '(log fetch)',
          statusCode: null,
          excerpt: '--limit を上げるか cron 間隔を短くすること',
        });
      }
    }
  }

  // --- 2. ヘルスプローブ -----------------------------------------------------
  for (const probe of PROBES) {
    const actual = await runProbe(probe);
    const finding = evaluateProbe(probe, actual);
    if (finding) {
      findings.push(finding);
      console.error(`[probe] FAIL ${probe.name}: ${finding.reason}`);
    } else {
      console.log(`[probe] OK   ${probe.name} (${actual.status})`);
    }
  }

  // --- 3. 自己診断 -----------------------------------------------------------
  // 通知経路 (Issue の起票・追記) が生きているかを、本物の異常を待たずに
  // 確かめるための入口。パターンを一時的に緩めて戻す運用より安全で、消し忘れも
  // 起きない。workflow_dispatch からのみ渡せる。
  if (hasFlag('--self-test')) {
    findings.push({
      kind: 'self-test',
      id: 'self-test',
      severity: 'error',
      description: '通知経路の疎通確認 (実際の障害ではない)',
      requestPath: '(self-test)',
      statusCode: null,
      excerpt: 'SELF-TEST: この検知は手動の疎通確認によるもので、本番は正常です',
    });
    console.log('[self-test] 合成の検知を 1 件追加した');
  }

  const result = { findings, scanned, windowMinutes, fatal };
  const { code, outcome } = decideOutcome(result);
  const summary = fatal ? `監視が実行できなかった: ${fatal}` : summarize(result);

  console.log(`\noutcome=${outcome} / ${summary}`);

  // 詳細行 (Issue 本文と Job Summary の材料)
  const detail = findings
    .map((f) => {
      const where = f.statusCode ? `${f.requestPath} (${f.statusCode})` : f.requestPath;
      const why = f.reason ?? f.excerpt ?? '';
      return `- [${f.severity}] ${f.id} — ${f.description}\n  ${where}${why ? `\n  ${why}` : ''}`;
    })
    .join('\n');

  if (detail) console.log(`\n${detail}`);

  if (RESULT_PATH) {
    writeFileSync(RESULT_PATH, JSON.stringify({ outcome, summary, detail, findings, scanned }, null, 2));
  }
  if (process.env.GITHUB_OUTPUT) {
    // 複数行は heredoc 形式でないと壊れる。
    const out = [
      `outcome=${outcome}`,
      `summary=${summary.replace(/\n/g, ' ')}`,
      `detail<<MONITOR_EOF\n${detail || '(なし)'}\nMONITOR_EOF`,
    ].join('\n');
    writeFileSync(process.env.GITHUB_OUTPUT, `${out}\n`, { flag: 'a' });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const body = `## LINE 本番監視\n\n${summary}\n\n${detail || '検知なし。'}\n`;
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, body, { flag: 'a' });
  }

  process.exit(code);
}

main().catch((err) => {
  console.error(`[fatal] ${err?.stack || err}`);
  process.exit(2);
});

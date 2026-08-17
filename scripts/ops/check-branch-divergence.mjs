#!/usr/bin/env node
// =============================================================================
// check-branch-divergence.mjs — P3: ブランチ乖離の機械監視
//
// 目的:
//   作業コピー(ブランチ)が本流(main)から離れすぎる状態を数値で見張り、
//   259 コミット乖離の再発を構造的に防ぐ。DORA 基準 (1日1回マージ・1週間超の
//   バッチは大きすぎる) に合わせ、しきい値を締めている。
//
// しきい値 (git-ops-review.md で厳格化):
//   warn: behind > 20 commits  または  age > 3 days
//   stop: behind > 50 commits  または  age > 7 days
//   (env BRANCH_WARN_COMMITS / BRANCH_WARN_DAYS / BRANCH_STOP_COMMITS /
//    BRANCH_STOP_DAYS で上書き可)
//
// 指標:
//   behind = main が持ち branch が持たないコミット数  (git rev-list branch..main)
//   ahead  = branch が持ち main が持たないコミット数   (git rev-list main..branch)
//   ageDays = branch 固有の最古コミットからの経過日数 (バッチ齢)。ahead=0 の
//             ときは branch tip からの経過日数。
//
// モード:
//   (既定) 監査: origin の全ブランチ(main と ignore パターン除く)のうち
//           未マージ(ahead>0)のものを対象に behind/age を測り分類。
//           --fail-on-stop 指定で stop 該当が 1 本でもあれば exit 1。
//   --branch <name>: 単一ブランチ監査 (CI の push ガード用)。
//           そのブランチが stop 超過なら exit 1。
//
// 前提: origin/main が fetch 済みであること。CI では fetch-depth: 0 +
//       `git fetch origin` を先に実行する。ローカルは `git fetch origin` 済み前提。
// =============================================================================

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const getFlag = (n) => args.includes(n);
const getOpt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const MAIN = process.env.MAIN_REF || 'origin/main';
const WARN_COMMITS = Number(process.env.BRANCH_WARN_COMMITS || 20);
const WARN_DAYS = Number(process.env.BRANCH_WARN_DAYS || 3);
const STOP_COMMITS = Number(process.env.BRANCH_STOP_COMMITS || 50);
const STOP_DAYS = Number(process.env.BRANCH_STOP_DAYS || 7);

// main にマージ済み or 監査対象外にするブランチ名パターン
const IGNORE = [/^origin\/main$/, /^origin\/HEAD$/, /^origin\/backup\//, /^backup\//];

function git(argv) {
  return execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function countRevs(range) {
  try {
    return Number(git(['rev-list', '--count', range]) || '0');
  } catch {
    return null;
  }
}

// バッチ齢: branch 固有の最古コミット日時 (ahead>0)。無ければ tip 日時。
function ageDays(branch, ahead) {
  let iso = null;
  try {
    if (ahead > 0) {
      const out = git(['log', '--reverse', '--format=%cI', `${MAIN}..${branch}`]);
      iso = out.split('\n')[0] || null;
    }
    if (!iso) iso = git(['log', '-1', '--format=%cI', branch]) || null;
  } catch {
    iso = null;
  }
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round((ms / 86400000) * 10) / 10);
}

function classify(behind, age) {
  const overStop = (behind != null && behind > STOP_COMMITS) || (age != null && age > STOP_DAYS);
  const overWarn = (behind != null && behind > WARN_COMMITS) || (age != null && age > WARN_DAYS);
  if (overStop) return 'stop';
  if (overWarn) return 'warn';
  return 'ok';
}

function measure(branch) {
  const behind = countRevs(`${branch}..${MAIN}`);
  const ahead = countRevs(`${MAIN}..${branch}`);
  const age = ageDays(branch, ahead || 0);
  return { branch, behind, ahead, ageDays: age, level: classify(behind, age) };
}

function listBranches() {
  const out = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((b) => !IGNORE.some((re) => re.test(b)));
}

function run() {
  const single = getOpt('--branch', null);
  let results;

  if (single) {
    // 単一ブランチ (push ガード)。ローカル/リモート名の両対応。
    let ref = single;
    try {
      git(['rev-parse', '--verify', `${ref}`]);
    } catch {
      ref = `origin/${single}`;
    }
    results = [measure(ref)];
  } else {
    const branches = listBranches();
    results = branches.map(measure).filter((r) => (r.ahead || 0) > 0); // 未マージのみ
    results.sort((a, b) => (b.behind || 0) - (a.behind || 0));
  }

  const summary = {
    schema: 'elxea-branch-divergence/v1',
    checkedAt: new Date().toISOString(),
    thresholds: {
      warn: { commits: WARN_COMMITS, days: WARN_DAYS },
      stop: { commits: STOP_COMMITS, days: STOP_DAYS },
    },
    counts: {
      total: results.length,
      warn: results.filter((r) => r.level === 'warn').length,
      stop: results.filter((r) => r.level === 'stop').length,
    },
    branches: results,
  };

  console.log(JSON.stringify(summary, null, 2));

  const stops = results.filter((r) => r.level === 'stop');
  if (single) {
    if (stops.length > 0) {
      const r = stops[0];
      console.error(
        `\n::error title=Branch too diverged::${r.branch} は main から behind=${r.behind} / age=${r.ageDays}d。` +
          `stop しきい値 (>${STOP_COMMITS} commits or >${STOP_DAYS} days) 超過。` +
          `main を取り込む (git merge origin/main / rebase) か、分割してマージしてから push し直してください。`
      );
      process.exitCode = 1;
    }
    return;
  }

  if (getFlag('--fail-on-stop') && stops.length > 0) {
    console.error(`\n${stops.length} branch(es) exceed the STOP threshold: ${stops.map((r) => r.branch).join(', ')}`);
    process.exitCode = 1;
  }
}

try {
  run();
} catch (e) {
  console.error('check-branch-divergence failed:', e.message || e);
  process.exitCode = 2;
}

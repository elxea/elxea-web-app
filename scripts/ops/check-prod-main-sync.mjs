#!/usr/bin/env node
// =============================================================================
// check-prod-main-sync.mjs — P2 / 追加(a): 本番(Vercel) と main の一致監視
//
// 目的:
//   「今の本番はどのコミットか」を機械で確認し、origin/main の HEAD と一致するかを
//   照合する。ズレ(認識割れ)を検知して状態ファイルに書き出し、全エージェント
//   セッションが起動時に同じ本番認識を得られるようにする。
//
//   これは *検知 (detection)* であって強制ではない。ズレたら runbook
//   (docs/ops/production-source-of-truth.md) に従い 24h 以内に是正する運用で担保する。
//
// SoT: 本番の正本は main。Vercel production は main から配信される
//   (docs/ops/production-source-of-truth.md)。
//
// データ源 (ブラウザ不要):
//   - main HEAD:  gh api  または  git ls-remote  (GH_TOKEN / gh CLI)
//   - 本番 SHA:   Vercel REST API (VERCEL_TOKEN)。deploy.yml が各本番デプロイに
//                 --meta githubCommitSha=<sha> を付けるので、その meta を読む。
//                 CLI の `vercel inspect` は meta を落とすため REST API を使う。
//
// 判定 (status):
//   in_sync            本番 SHA == origin/main HEAD
//   drift              本番 SHA != origin/main HEAD (認識割れ / 未反映 / 手動デプロイ)
//   rollback_suspected 本番が最新 READY デプロイでない (Vercel ロールバック仕様の疑い)
//   unknown            SHA を確定できない (token 無し / meta 未付与の旧デプロイ 等)
//
// 出力:
//   - stdout に JSON レポート
//   - --state-out <path> 指定時、状態ファイルを書き出す
//     (セッション配布用。既定の配布先は docs 参照。ローカル実行で使う)
//   - --fail-on-drift 指定時、status が in_sync / unknown 以外なら exit 1 (CI 用)
//
// 使い方:
//   node scripts/ops/check-prod-main-sync.mjs
//   node scripts/ops/check-prod-main-sync.mjs --state-out ~/.claude/progress/elxea-prod-main-sync.json
//   node scripts/ops/check-prod-main-sync.mjs --fail-on-drift    # CI / スケジュール
//
// 環境変数:
//   VERCEL_TOKEN       Vercel REST API トークン (必須。無ければ本番 SHA は unknown)
//   VERCEL_PROJECT_ID  既定 prj_sVwjaJwPAKxRcKu3wVejiqGPt5o6 (deploy.yml と同値)
//   VERCEL_ORG_ID      チーム ID (team scope の場合に付与)
//   GH_REPO            既定 elxea/elxea-web-app
// =============================================================================

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const getFlag = (name) => args.includes(name);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const GH_REPO = process.env.GH_REPO || 'elxea/elxea-web-app';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_sVwjaJwPAKxRcKu3wVejiqGPt5o6';
const VERCEL_ORG_ID = process.env.VERCEL_ORG_ID || '';

const expandHome = (p) => (p && p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^\/+/, '')) : p);

// ---------------------------------------------------------------------------
// main HEAD の取得 (gh CLI を優先、無ければ git ls-remote)
// ---------------------------------------------------------------------------
function getMainHeadSha() {
  try {
    const out = execFileSync('gh', ['api', `repos/${GH_REPO}/commits/main`, '--jq', '.sha'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
  } catch {
    /* fall through */
  }
  try {
    const out = execFileSync('git', ['ls-remote', `https://github.com/${GH_REPO}.git`, 'refs/heads/main'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const sha = out.split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    /* fall through */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vercel REST API
// ---------------------------------------------------------------------------
function vercelUrl(path, params = {}) {
  const u = new URL(`https://api.vercel.com${path}`);
  if (VERCEL_ORG_ID) u.searchParams.set('teamId', VERCEL_ORG_ID);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function vercelGet(path, params) {
  const res = await fetch(vercelUrl(path, params), {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Vercel API ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

// 本番として現在配信中のデプロイ (production alias が指すもの) と、最新 READY デプロイを返す
async function getProductionState() {
  // 1) 現在の production ターゲット (alias が指す live デプロイ)
  const project = await vercelGet(`/v9/projects/${VERCEL_PROJECT_ID}`);
  const liveTarget = project?.targets?.production || null;
  const liveId = liveTarget?.id || liveTarget?.deploymentId || null;
  const liveSha = liveTarget?.meta?.githubCommitSha || liveTarget?.meta?.gitCommitSha || null;

  // 2) 最新の READY production デプロイ (ロールバック検知用)
  const list = await vercelGet('/v6/deployments', {
    projectId: VERCEL_PROJECT_ID,
    target: 'production',
    limit: 20,
  });
  const deployments = list?.deployments || [];
  const ready = deployments.filter((d) => (d.readyState || d.state) === 'READY');
  const newest = ready[0] || deployments[0] || null;
  const newestId = newest?.uid || newest?.id || null;
  const newestSha = newest?.meta?.githubCommitSha || newest?.meta?.gitCommitSha || null;

  return {
    liveId,
    liveSha,
    newestId,
    newestSha,
    isLiveNewest: liveId && newestId ? liveId === newestId : null,
  };
}

// ---------------------------------------------------------------------------
// docs-only-ahead: main が prod より進んでいるが、その差分が deploy.yml の
// paths-ignore (**/*.md / docs/** / LICENSE) だけなら本番デプロイは意図的に
// スキップされている。この場合ズレは正常で drift ではない。
//
// 戻り値: { ahead, ignoredOnly, changed } / git で判定不能なら null
// ---------------------------------------------------------------------------
function isIgnoredPath(p) {
  return p.endsWith('.md') || p.startsWith('docs/') || p === 'LICENSE';
}

function mainAheadState(prodSha, mainSha) {
  try {
    // prod が main の祖先か (= main が prod より進んでいる)
    execFileSync('git', ['merge-base', '--is-ancestor', prodSha, mainSha], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // 非0 = 祖先でない (diverged / rollback) か、commit を解決できない
    return null;
  }
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${prodSha}..${mainSha}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const changed = out ? out.split('\n').filter(Boolean) : [];
    return { ahead: true, ignoredOnly: changed.length > 0 && changed.every(isIgnoredPath), changed };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
async function run() {
  const now = new Date().toISOString();
  const mainSha = getMainHeadSha();

  let prod = null;
  let prodError = null;
  if (VERCEL_TOKEN) {
    try {
      prod = await getProductionState();
    } catch (e) {
      prodError = String(e.message || e);
    }
  } else {
    prodError = 'VERCEL_TOKEN not set';
  }

  const prodSha = prod?.liveSha || null;

  let status;
  let reason;
  if (!mainSha) {
    status = 'unknown';
    reason = 'could not resolve origin/main HEAD (gh/git unavailable)';
  } else if (!prodSha) {
    status = 'unknown';
    reason = prodError
      ? `production SHA unavailable: ${prodError}`
      : 'production deployment has no git SHA meta yet (deploy.yml --meta must land + one deploy)';
  } else if (prod && prod.isLiveNewest === false) {
    status = 'rollback_suspected';
    reason = 'live production deployment is not the newest READY deployment (Vercel rollback turns off auto-assign)';
  } else if (prodSha === mainSha) {
    status = 'in_sync';
    reason = 'production SHA matches origin/main HEAD';
  } else {
    // main が prod より進んでいて、その差分が deploy.yml の paths-ignore
    // (docs/md/LICENSE) だけなら、本番デプロイは意図的にスキップされている =
    // 正常。false drift を防ぐ。git で判定できないときのみ drift 扱い。
    const ahead = mainAheadState(prodSha, mainSha);
    if (ahead && ahead.ignoredOnly) {
      status = 'in_sync';
      reason = `main is ahead of production by deploy-ignored paths only (docs/md/LICENSE); no deploy expected. changed=${ahead.changed.length}`;
    } else {
      status = 'drift';
      reason = 'production SHA differs from origin/main HEAD';
    }
  }

  const report = {
    schema: 'elxea-prod-main-sync/v1',
    checkedAt: now,
    repo: GH_REPO,
    status,
    reason,
    mainHeadSha: mainSha,
    productionSha: prodSha,
    productionDeploymentId: prod?.liveId || null,
    newestReadyDeploymentId: prod?.newestId || null,
    liveIsNewest: prod?.isLiveNewest ?? null,
    // SoT / runbook: docs/ops/production-source-of-truth.md
    sourceOfTruth: 'main',
    remediation:
      status === 'in_sync' || status === 'unknown'
        ? null
        : 'docs/ops/production-source-of-truth.md — 24h 以内に是正 (再デプロイ or Undo)。Boss へエスカレ',
  };

  console.log(JSON.stringify(report, null, 2));

  const stateOut = getOpt('--state-out', null);
  if (stateOut) {
    const p = expandHome(stateOut);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
    console.error(`state written: ${p}`);
  }

  if (getFlag('--fail-on-drift') && status !== 'in_sync' && status !== 'unknown') {
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error('check-prod-main-sync failed:', e);
  process.exitCode = 2;
});

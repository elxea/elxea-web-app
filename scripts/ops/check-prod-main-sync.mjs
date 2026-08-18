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
// 判定 (status) — 判定ロジックの実体は lib/prod-main-sync-verdict.mjs (純関数):
//   in_sync            本番 SHA == origin/main HEAD          (verified=true)
//   drift              本番 SHA != origin/main HEAD          (verified=true)
//   rollback_suspected 本番が最新 READY デプロイでない        (verified=true)
//   unverifiable       照合そのものができなかった            (verified=false)
//
//   重要: `unverifiable` は「異常なし」ではない。2026-08-18、VERCEL_TOKEN が
//   無い間この監視は旧 status=unknown を返し、--fail-on-drift 付きでも exit 0 を
//   返し続けていた。その結果 259 commit 分のズレが誰にも気付かれなかった。
//   「検証していない」を「検証して問題なかった」と同じ緑で表現しない。
//
// 出力:
//   - stdout に JSON レポート (schema v2: status に加えて verified / unverifiableCause)
//   - stderr に 1 行の見出し ([OK] / [FAIL] / [SKIP])
//   - --state-out <path> 指定時、状態ファイルを書き出す
//
// 終了コード:
//   0  in_sync (照合して一致)                     ※ --fail-on-drift 無しなら常に 0
//   1  drift / rollback_suspected (照合して異常)
//   2  スクリプト自体の例外
//   3  unverifiable (照合できなかった) — fail-closed の既定
//      --unverifiable-exit <n> で明示的に変更可 (例: 0 にすると従来の緑に戻るが、
//      その選択はコマンドラインに残り監査できる)
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

import {
  EXIT_CODES,
  classifySync,
  exitCodeFor,
  summarizeAhead,
  verdictBanner,
} from './lib/prod-main-sync-verdict.mjs';

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
// テスト用の seam: 既定は本番 API。VERCEL_API_BASE を差し替えるとローカルの
// スタブに向けられるので、実際の exit code (正常 / ずれあり / 検証不能) を
// 本番に触れずに end-to-end で実測できる。CI / 運用では未設定のまま。
const VERCEL_API_BASE = process.env.VERCEL_API_BASE || 'https://api.vercel.com';

function vercelUrl(path, params = {}) {
  const u = new URL(`${VERCEL_API_BASE}${path}`);
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
    return summarizeAhead(changed);
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

  // main が prod より進んでいて、その差分が deploy の paths-ignore
  // (docs/md/LICENSE) だけなら、本番デプロイは意図的にスキップされている = 正常。
  // false drift を防ぐ。git で判定できないときは null (= drift 扱い) にする。
  const aheadState = mainSha && prodSha && prodSha !== mainSha ? mainAheadState(prodSha, mainSha) : null;

  // 判定は純関数へ (scripts/ops/lib/prod-main-sync-verdict.mjs)。
  // I/O と分離してあるので fixture で 3 パターンを回帰テストできる。
  const verdict = classifySync({
    mainSha,
    prodSha,
    tokenPresent: Boolean(VERCEL_TOKEN),
    prodError,
    liveIsNewest: prod?.isLiveNewest ?? null,
    aheadState,
  });

  const report = {
    // v2: `unknown` を廃止し `unverifiable` + `verified` に分離した。
    // v1 の消費側は status==='unknown' を見ていたので schema を上げて気付かせる。
    schema: 'elxea-prod-main-sync/v2',
    checkedAt: now,
    repo: GH_REPO,
    status: verdict.status,
    // 「照合を実際に行ったか」。false のとき status は正常判定ではなく「不明」。
    verified: verdict.verified,
    unverifiableCause: verdict.unverifiableCause,
    reason: verdict.reason,
    mainHeadSha: mainSha,
    productionSha: prodSha,
    productionDeploymentId: prod?.liveId || null,
    newestReadyDeploymentId: prod?.newestId || null,
    liveIsNewest: prod?.isLiveNewest ?? null,
    // SoT / runbook: docs/ops/production-source-of-truth.md
    sourceOfTruth: 'main',
    // 検証不能にも必ず remediation が付く (v1 は null だったので放置されていた)。
    remediation: verdict.remediation,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(verdictBanner(verdict));

  const stateOut = getOpt('--state-out', null);
  if (stateOut) {
    const p = expandHome(stateOut);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
    console.error(`state written: ${p}`);
  }

  // ゲート実行 (--fail-on-drift) では検証不能を緑にしない = fail-closed。
  // 恒久的に武装できない環境で赤を出し続けたい場合だけ、呼び出し側が
  // --unverifiable-exit 0 を明示する (その判断がコマンドラインに残る)。
  const rawUnverifiableExit = getOpt('--unverifiable-exit', null);
  const unverifiableExit =
    rawUnverifiableExit !== null && /^\d+$/.test(rawUnverifiableExit)
      ? Number(rawUnverifiableExit)
      : EXIT_CODES.UNVERIFIABLE;

  process.exitCode = exitCodeFor(verdict, {
    failOnDrift: getFlag('--fail-on-drift'),
    unverifiableExit,
  });
}

run().catch((e) => {
  console.error('check-prod-main-sync failed:', e);
  process.exitCode = EXIT_CODES.CRASH;
});

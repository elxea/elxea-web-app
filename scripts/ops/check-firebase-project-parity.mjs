#!/usr/bin/env node
// =============================================================================
// check-firebase-project-parity.mjs — E6': 2 リポの Firebase 接続先契約を突合する
//
// 何をするか:
//   `.firebaserc` の projects.default (= web-app が見ている Firebase プロジェクト) と、
//   cx-agent の `GET /health/firebase` が返す project_id を突き合わせる。
//   **不一致でも未設定でも到達不能でも落とす** (fail-closed)。
//
// なぜ要るか・どの実害を止めるかは判定ロジック側の冒頭コメントに書いてある
// (scripts/ops/lib/firebase-project-parity.mjs)。二重に書かない。
//
// 使い方:
//   CX_AGENT_HEALTH_URL=https://.../health/firebase node scripts/ops/check-firebase-project-parity.mjs
//
// 返す情報について:
//   突き合わせるのはプロジェクト ID だけで、顧客の情報は 1 バイトも通らない。
//   プロジェクト ID は .firebaserc に平文でコミットされている値と同種のもので、
//   秘密ではない。だから cx-agent 側の口に認証を掛けていない —
//   掛けると「契約を検査するための鍵」を CI に配ることになり、
//   検査のために新しい漏洩面を作ることになる (割に合わない)。
//
// ネットワークの揺れについて:
//   一時的な失敗で赤くなると検査が信用されなくなるので、**到達できなかったとき
//   だけ** 数回やり直す。HTTP ステータスが返ってきた場合はやり直さない —
//   404 も 503 も「サーバがそう答えた」という確定した事実であって、揺れではない。
//
// CI:
//   static-checks ジョブに相乗りさせる (新規ジョブは作らない)。
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  evaluateFirebaseParity,
  readDefaultProjectId,
} from './lib/firebase-project-parity.mjs';

const ROOT = process.cwd();
const FIREBASERC = join(ROOT, '.firebaserc');

/** 到達不能のときだけやり直す回数と間隔。 */
const RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ヘルスエンドポイントを 1 回叩く。
 * 到達できたら status / body を、到達できなかったら error を返す。
 */
async function probeOnce(url) {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // expected-failure: JSON でない応答も「本文を読めなかった」として判定側で落とす。
    }
    return { status: res.status, body, error: null };
  } catch (err) {
    return {
      status: null,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probe(url) {
  let last = { status: null, body: null, error: 'not attempted' };
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    last = await probeOnce(url);
    // サーバが何かを答えたなら確定。やり直しても答えは変わらない。
    if (last.error === null) return last;
    if (attempt < RETRIES) {
      console.error(
        `[e6] 到達できませんでした (${attempt}/${RETRIES}): ${last.error} — ${RETRY_DELAY_MS}ms 後に再試行`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
  return last;
}

async function main() {
  let firebasercRaw = '';
  try {
    firebasercRaw = readFileSync(FIREBASERC, 'utf8');
  } catch {
    // expected-failure: 読めなかったことは判定側で firebaserc_missing として落とす。
  }
  const expectedProjectId = readDefaultProjectId(firebasercRaw);
  const healthUrl = process.env.CX_AGENT_HEALTH_URL?.trim() || null;

  const result = healthUrl
    ? await probe(healthUrl)
    : { status: null, body: null, error: null };

  const verdict = evaluateFirebaseParity({
    expectedProjectId,
    healthUrl,
    status: result.status,
    body: result.body,
    error: result.error,
  });

  if (verdict.verdict === 'ok') {
    console.log(`[e6] OK — ${verdict.message}`);
    return;
  }

  console.error('\n[e6] FAIL — Firebase 接続先の契約が確かめられません\n');
  console.error(`  reason: ${verdict.reason}`);
  console.error(`${verdict.message}\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[e6] 検査自体が落ちました:', err);
  process.exit(1);
});

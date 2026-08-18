/**
 * main-guard の判断ロジック (scripts/git-guard/main-guard-lib.sh の mg_decide) の unit test。
 *
 * なぜ shell を子プロセスで叩く形にしているか:
 *   赤経路 (「main に直接書こうとしたら拒否される」) を証明したいが、本物の main に
 *   commit / push して確かめるのは絶対にやってはいけない。判断を純関数に切り出し、
 *   そこへ「main だったら」という入力を直接与えることで、main に触れずに拒否を証明する。
 *
 * なぜ 1 プロセスにまとめているか:
 *   ケースごとに execFileSync すると同期呼び出しが vitest のワーカースレッドを占有し、
 *   全体実行時に他のテストをタイムアウトさせる。全ケースを 1 回の bash 実行で流し、
 *   結果表を作ってから各 it が引くだけにしてある。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const LIB = path.join(process.cwd(), 'scripts', 'git-guard', 'main-guard-lib.sh');

const PROTECTED = 'main,master';
const GOOD_REASON = '本番障害のホットフィックス対応のため';

const SEP = '\x1f';

type Case = [mode: string, ref: string, protectedBranches: string, reason: string, record: string];

/** 全ケースを 1 プロセスで評価し、"入力 -> 判定" の表にする。 */
function runAll(cases: Case[]): Map<string, string> {
  const script = [
    '. "$1"; shift',
    // タブ等の空白文字を IFS にすると連続する区切りが 1 個に潰れて空フィールドが
    // 消えてしまう。非空白の区切り文字 (US = \x1f) を使う。
    `while IFS=$'\\x1f' read -r mode ref prot reason record; do`,
    '  printf "%s\\n" "$(mg_decide "$mode" "$ref" "$prot" "$reason" "$record")"',
    'done',
  ].join('\n');
  const input = `${cases.map((c) => c.join(SEP)).join('\n')}\n`;
  const out = execFileSync('/bin/bash', ['-c', script, 'bash', LIB], {
    input,
    encoding: 'utf8',
  });
  const lines = out.split('\n');
  const table = new Map<string, string>();
  cases.forEach((c, i) => table.set(c.join(SEP), lines[i] ?? ''));
  return table;
}

const CASES: Case[] = [];
function c(
  mode: string,
  ref: string,
  protectedBranches: string = PROTECTED,
  reason = '',
  record = 'no',
): Case {
  const entry: Case = [mode, ref, protectedBranches, reason, record];
  CASES.push(entry);
  return entry;
}

const K = {
  commitMain: c('commit', 'main'),
  pushMain: c('push', 'main'),
  pushFullRef: c('push', 'refs/heads/main'),
  commitMaster: c('commit', 'master'),
  pushEmpty: c('push', ''),
  commitEmpty: c('commit', ''),
  badMode: c('sideways', 'feat/x'),
  emptyProtected: c('push', '', ''),
  commitFeat: c('commit', 'feat/local-main-guard'),
  pushFeat: c('push', 'refs/heads/fix/something'),
  mainExperiment: c('commit', 'main-experiment'),
  featureMain: c('commit', 'feature/main'),
  detached: c('commit', '__detached__'),
  noReason: c('commit', 'main', PROTECTED, '', 'yes'),
  shortReason: c('commit', 'main', PROTECTED, '緊急', 'yes'),
  notRecorded: c('commit', 'main', PROTECTED, GOOD_REASON, 'no'),
  fullBypass: c('commit', 'main', PROTECTED, GOOD_REASON, 'yes'),
  pushBypass: c('push', 'refs/heads/main', PROTECTED, GOOD_REASON, 'yes'),
  undeterminedBypass: c('push', '', PROTECTED, GOOD_REASON, 'yes'),
};

const RESULTS = runAll(CASES);

function decide(key: Case): string {
  const value = RESULTS.get(key.join(SEP));
  if (value === undefined) throw new Error(`no result for ${key.join(' ')}`);
  return value;
}

describe('mg_decide — 赤経路 (拒否されること)', () => {
  it('main への直接 commit を拒否する', () => {
    expect(decide(K.commitMain)).toBe('DENY:protected');
  });

  it('main への直接 push を拒否する', () => {
    expect(decide(K.pushMain)).toBe('DENY:protected');
  });

  it('refs/heads/main のような完全参照名でも拒否する', () => {
    expect(decide(K.pushFullRef)).toBe('DENY:protected');
  });

  it('master も保護対象として拒否する', () => {
    expect(decide(K.commitMaster)).toBe('DENY:protected');
  });
});

describe('mg_decide — fail-closed (分からないときは拒否)', () => {
  it('push 先が空 (PRE_COMMIT_REMOTE_BRANCH 不在) なら拒否する', () => {
    expect(decide(K.pushEmpty)).toBe('DENY:undetermined');
  });

  it('commit 対象が空なら拒否する', () => {
    expect(decide(K.commitEmpty)).toBe('DENY:undetermined');
  });

  it('mode が不明なら拒否する', () => {
    expect(decide(K.badMode)).toBe('DENY:undetermined');
  });

  it('保護リストが空でも、対象不明なら拒否する', () => {
    expect(decide(K.emptyProtected)).toBe('DENY:undetermined');
  });
});

describe('mg_decide — 青経路 (通ってよいもの)', () => {
  it('作業ブランチへの commit は通す', () => {
    expect(decide(K.commitFeat)).toBe('ALLOW');
  });

  it('作業ブランチへの push は通す', () => {
    expect(decide(K.pushFeat)).toBe('ALLOW');
  });

  it('main で始まるだけの別ブランチを巻き込まない', () => {
    expect(decide(K.mainExperiment)).toBe('ALLOW');
    expect(decide(K.featureMain)).toBe('ALLOW');
  });

  it('保護ブランチの先端でない detached HEAD は通す', () => {
    expect(decide(K.detached)).toBe('ALLOW');
  });
});

describe('mg_decide — 緊急バイパス (外せるが記録が要る)', () => {
  it('理由なしでは外せない', () => {
    expect(decide(K.noReason)).toBe('DENY:protected');
  });

  it('理由が短すぎると外せない', () => {
    expect(decide(K.shortReason)).toBe(
      'DENY:bypass-reason-too-short',
    );
  });

  it('理由があっても監査ログに記録が無ければ外せない', () => {
    expect(decide(K.notRecorded)).toBe(
      'DENY:bypass-not-recorded',
    );
  });

  it('十分な理由 + 監査ログへの記録が揃って初めて外れる', () => {
    expect(decide(K.fullBypass)).toBe('BYPASS');
  });

  it('push でも同じ条件で外れる', () => {
    expect(decide(K.pushBypass)).toBe('BYPASS');
  });

  it('対象不明の fail-closed も、記録付きバイパスなら外せる', () => {
    expect(decide(K.undeterminedBypass)).toBe('BYPASS');
  });
});

describe('mg_normalize_ref', () => {
  const normalized = execFileSync(
    '/bin/bash',
    ['-c', '. "$1"; mg_normalize_ref refs/heads/main; echo; mg_normalize_ref feat/x', 'bash', LIB],
    { encoding: 'utf8' },
  ).split('\n');

  it('refs/heads/ を落とす', () => {
    expect(normalized[0]).toBe('main');
  });

  it('素のブランチ名はそのまま', () => {
    expect(normalized[1]).toBe('feat/x');
  });
});

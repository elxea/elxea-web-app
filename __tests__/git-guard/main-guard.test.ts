/**
 * main-guard の判断ロジック (scripts/git-guard/main-guard-lib.sh の mg_decide) の unit test。
 *
 * なぜ shell を子プロセスで叩く形にしているか:
 *   赤経路 (「main に直接書こうとしたら拒否される」) を証明したいが、本物の main に
 *   commit / push して確かめるのは絶対にやってはいけない。判断を純関数に切り出し、
 *   そこへ「main だったら」という入力を直接与えることで、main に触れずに拒否を証明する。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const LIB = path.join(process.cwd(), 'scripts', 'git-guard', 'main-guard-lib.sh');

const PROTECTED = 'main,master';
const GOOD_REASON = '本番障害のホットフィックス対応のため';

/** mg_decide を 1 回呼んで判定コードを返す。 */
function decide(
  mode: string,
  ref: string,
  protectedBranches: string = PROTECTED,
  bypassReason = '',
  recordPresent = 'no',
): string {
  return execFileSync(
    '/bin/bash',
    [
      '-c',
      '. "$0"; mg_decide "$1" "$2" "$3" "$4" "$5"',
      LIB,
      mode,
      ref,
      protectedBranches,
      bypassReason,
      recordPresent,
    ],
    { encoding: 'utf8' },
  );
}

describe('mg_decide — 赤経路 (拒否されること)', () => {
  it('main への直接 commit を拒否する', () => {
    expect(decide('commit', 'main')).toBe('DENY:protected');
  });

  it('main への直接 push を拒否する', () => {
    expect(decide('push', 'main')).toBe('DENY:protected');
  });

  it('refs/heads/main のような完全参照名でも拒否する', () => {
    expect(decide('push', 'refs/heads/main')).toBe('DENY:protected');
  });

  it('master も保護対象として拒否する', () => {
    expect(decide('commit', 'master')).toBe('DENY:protected');
  });
});

describe('mg_decide — fail-closed (分からないときは拒否)', () => {
  it('push 先が空 (PRE_COMMIT_REMOTE_BRANCH 不在) なら拒否する', () => {
    expect(decide('push', '')).toBe('DENY:undetermined');
  });

  it('commit 対象が空なら拒否する', () => {
    expect(decide('commit', '')).toBe('DENY:undetermined');
  });

  it('mode が不明なら拒否する', () => {
    expect(decide('sideways', 'feat/x')).toBe('DENY:undetermined');
  });

  it('保護リストが空でも、対象不明なら拒否する', () => {
    expect(decide('push', '', '')).toBe('DENY:undetermined');
  });
});

describe('mg_decide — 青経路 (通ってよいもの)', () => {
  it('作業ブランチへの commit は通す', () => {
    expect(decide('commit', 'feat/local-main-guard')).toBe('ALLOW');
  });

  it('作業ブランチへの push は通す', () => {
    expect(decide('push', 'refs/heads/fix/something')).toBe('ALLOW');
  });

  it('main で始まるだけの別ブランチを巻き込まない', () => {
    expect(decide('commit', 'main-experiment')).toBe('ALLOW');
    expect(decide('commit', 'feature/main')).toBe('ALLOW');
  });

  it('保護ブランチの先端でない detached HEAD は通す', () => {
    expect(decide('commit', '__detached__')).toBe('ALLOW');
  });
});

describe('mg_decide — 緊急バイパス (外せるが記録が要る)', () => {
  it('理由なしでは外せない', () => {
    expect(decide('commit', 'main', PROTECTED, '', 'yes')).toBe('DENY:protected');
  });

  it('理由が短すぎると外せない', () => {
    expect(decide('commit', 'main', PROTECTED, '緊急', 'yes')).toBe(
      'DENY:bypass-reason-too-short',
    );
  });

  it('理由があっても監査ログに記録が無ければ外せない', () => {
    expect(decide('commit', 'main', PROTECTED, GOOD_REASON, 'no')).toBe(
      'DENY:bypass-not-recorded',
    );
  });

  it('十分な理由 + 監査ログへの記録が揃って初めて外れる', () => {
    expect(decide('commit', 'main', PROTECTED, GOOD_REASON, 'yes')).toBe('BYPASS');
  });

  it('push でも同じ条件で外れる', () => {
    expect(decide('push', 'refs/heads/main', PROTECTED, GOOD_REASON, 'yes')).toBe('BYPASS');
  });

  it('対象不明の fail-closed も、記録付きバイパスなら外せる', () => {
    expect(decide('push', '', PROTECTED, GOOD_REASON, 'yes')).toBe('BYPASS');
  });
});

describe('mg_normalize_ref', () => {
  function normalize(ref: string): string {
    return execFileSync('/bin/bash', ['-c', '. "$0"; mg_normalize_ref "$1"', LIB, ref], {
      encoding: 'utf8',
    });
  }

  it('refs/heads/ を落とす', () => {
    expect(normalize('refs/heads/main')).toBe('main');
  });

  it('素のブランチ名はそのまま', () => {
    expect(normalize('feat/x')).toBe('feat/x');
  });
});

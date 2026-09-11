import { describe, expect, it } from 'vitest';

import {
  EXIT_CODES,
  classifySync,
  exitCodeFor,
  isDeployIgnoredPath,
  summarizeAhead,
  verdictBanner,
} from '../../scripts/ops/lib/prod-main-sync-verdict.mjs';

// =============================================================================
// 本番 ↔ main 一致監視の判定テスト
//
// 2026-08-18 のインシデント: 本番が main より 259 commit 古い状態で配信されていた。
// 検知役の check-prod-main-sync.mjs は VERCEL_TOKEN が無い間 status=unknown を返し、
// --fail-on-drift 付きでも exit 0 (緑) だったため、誰も気付かなかった。
//
// このテストが守る不変条件は 1 つ:
//   「検証できなかった」が「検証して問題なかった」と同じ扱いにならないこと。
// =============================================================================

const MAIN = 'a'.repeat(40);
const PROD_OLD = 'b'.repeat(40);

/** 正常系: 武装済みで本番 SHA が main と一致 */
const ARMED_IN_SYNC = {
  mainSha: MAIN,
  prodSha: MAIN,
  tokenPresent: true,
  prodError: null,
  liveIsNewest: true,
  aheadState: null,
};

/** 異常系: 武装済みで本番が main と別 SHA (= 今回の事故そのもの) */
const ARMED_DRIFT = {
  ...ARMED_IN_SYNC,
  prodSha: PROD_OLD,
  aheadState: summarizeAhead(['app/page.tsx', 'lib/shopify/cart.ts']),
};

/** 検証不能: token が無く照合が一度も走らなかった */
const UNARMED = {
  mainSha: MAIN,
  prodSha: null,
  tokenPresent: false,
  prodError: 'VERCEL_TOKEN not set',
  liveIsNewest: null,
  aheadState: null,
};

describe('classifySync — 正常 / ずれあり / 検証不能の 3 パターン', () => {
  it('正常: 本番 SHA と main HEAD が一致したら in_sync かつ verified', () => {
    const v = classifySync(ARMED_IN_SYNC);
    expect(v.status).toBe('in_sync');
    expect(v.verified).toBe(true);
    expect(v.unverifiableCause).toBeNull();
    expect(v.remediation).toBeNull();
  });

  it('ずれあり: 本番 SHA が main と違えば drift かつ verified、remediation が付く', () => {
    const v = classifySync(ARMED_DRIFT);
    expect(v.status).toBe('drift');
    expect(v.verified).toBe(true);
    expect(v.remediation).toContain('production-source-of-truth.md');
  });

  it('検証不能: VERCEL_TOKEN が無いときは in_sync ではなく unverifiable になる', () => {
    const v = classifySync(UNARMED);
    // ここが回帰点。旧実装はここで status=unknown を返し、呼び出し側が
    // それを in_sync と同じ「緑」に丸めていた。
    expect(v.status).toBe('unverifiable');
    expect(v.status).not.toBe('in_sync');
    expect(v.verified).toBe(false);
    expect(v.unverifiableCause).toBe('missing_credentials');
  });

  it('検証不能でも remediation は必ず埋まる (放置できないようにする)', () => {
    for (const obs of [
      UNARMED,
      { ...UNARMED, tokenPresent: true, prodError: 'Vercel API /v9/projects -> HTTP 403' },
      { ...UNARMED, tokenPresent: true, prodError: null },
      { ...UNARMED, mainSha: null },
    ]) {
      const v = classifySync(obs);
      expect(v.verified).toBe(false);
      expect(v.remediation).toBeTruthy();
    }
  });
});

describe('classifySync — 検証不能の原因を 1 バケツにしない', () => {
  it.each([
    ['token 無し', UNARMED, 'missing_credentials'],
    [
      'API エラー',
      { ...UNARMED, tokenPresent: true, prodError: 'Vercel API /v6/deployments -> HTTP 500' },
      'production_api_error',
    ],
    ['SHA meta 無し', { ...UNARMED, tokenPresent: true, prodError: null }, 'production_sha_missing'],
    ['main HEAD 不明', { ...ARMED_IN_SYNC, mainSha: null }, 'main_head_unresolved'],
  ])('%s → cause=%s', (_label, observation, cause) => {
    const v = classifySync(observation);
    expect(v.status).toBe('unverifiable');
    expect(v.unverifiableCause).toBe(cause);
  });

  it('main HEAD が取れないときは token があっても検証扱いにしない', () => {
    const v = classifySync({ ...ARMED_IN_SYNC, mainSha: null, prodSha: MAIN });
    expect(v.verified).toBe(false);
  });
});

describe('classifySync — 既存の正常判定を壊さない (武装時は従来どおり)', () => {
  it('docs/md/LICENSE だけ main が先行しているのは drift ではない', () => {
    const v = classifySync({
      ...ARMED_DRIFT,
      aheadState: summarizeAhead(['docs/ops/production-source-of-truth.md', 'README.md', 'LICENSE']),
    });
    expect(v.status).toBe('in_sync');
    expect(v.verified).toBe(true);
  });

  it('deploy 対象のファイルが 1 つでも混ざれば drift', () => {
    const v = classifySync({
      ...ARMED_DRIFT,
      aheadState: summarizeAhead(['docs/x.md', 'app/layout.tsx']),
    });
    expect(v.status).toBe('drift');
  });

  it('live が最新 READY デプロイでなければ rollback_suspected (SHA 一致より優先)', () => {
    const v = classifySync({ ...ARMED_IN_SYNC, liveIsNewest: false });
    expect(v.status).toBe('rollback_suspected');
    expect(v.verified).toBe(true);
  });

  it('git で先行判定ができない (aheadState=null) なら安全側の drift', () => {
    const v = classifySync({ ...ARMED_DRIFT, aheadState: null });
    expect(v.status).toBe('drift');
  });
});

describe('exitCodeFor — 緑 / 赤 / 未検証を別の終了コードに分ける', () => {
  const gate = { failOnDrift: true };

  it('in_sync は 0', () => {
    expect(exitCodeFor(classifySync(ARMED_IN_SYNC), gate)).toBe(EXIT_CODES.IN_SYNC);
  });

  it('drift は 1', () => {
    expect(exitCodeFor(classifySync(ARMED_DRIFT), gate)).toBe(EXIT_CODES.DRIFT);
  });

  it('rollback_suspected も 1', () => {
    expect(exitCodeFor(classifySync({ ...ARMED_IN_SYNC, liveIsNewest: false }), gate)).toBe(
      EXIT_CODES.DRIFT,
    );
  });

  it('unverifiable は既定で 3 — 0 (緑) に丸めない', () => {
    const code = exitCodeFor(classifySync(UNARMED), gate);
    expect(code).toBe(EXIT_CODES.UNVERIFIABLE);
    expect(code).not.toBe(EXIT_CODES.IN_SYNC);
  });

  it('unverifiable を緑にできるのは呼び出し側が明示したときだけ', () => {
    expect(exitCodeFor(classifySync(UNARMED), { ...gate, unverifiableExit: 0 })).toBe(0);
  });

  it('--fail-on-drift 無しの情報取得実行はどの判定でも 0 (ゲートではない)', () => {
    for (const obs of [ARMED_IN_SYNC, ARMED_DRIFT, UNARMED]) {
      expect(exitCodeFor(classifySync(obs), { failOnDrift: false })).toBe(0);
    }
  });

  it('3 パターンの終了コードが互いに衝突しない', () => {
    const codes = [ARMED_IN_SYNC, ARMED_DRIFT, UNARMED].map((o) =>
      exitCodeFor(classifySync(o), gate),
    );
    expect(new Set(codes).size).toBe(3);
  });
});

describe('verdictBanner — ログを見た人間が区別できる', () => {
  it('検証不能は緑の語彙を使わず NOT VERIFIED と原因を出す', () => {
    const banner = verdictBanner(classifySync(UNARMED));
    expect(banner).toContain('[SKIP]');
    expect(banner).toContain('NOT VERIFIED');
    expect(banner).toContain('missing_credentials');
    expect(banner).not.toContain('[OK]');
  });

  it('正常と異常はそれぞれ [OK] / [FAIL]', () => {
    expect(verdictBanner(classifySync(ARMED_IN_SYNC))).toContain('[OK]');
    expect(verdictBanner(classifySync(ARMED_DRIFT))).toContain('[FAIL]');
  });
});

describe('isDeployIgnoredPath / summarizeAhead', () => {
  it.each([
    ['README.md', true],
    ['docs/ops/x.txt', true],
    ['LICENSE', true],
    ['app/page.tsx', false],
    ['scripts/ops/check-prod-main-sync.mjs', false],
  ])('%s → ignored=%s', (p, expected) => {
    expect(isDeployIgnoredPath(p)).toBe(expected);
  });

  it('差分ファイルが 0 件なら ignoredOnly にしない (in_sync に丸めない)', () => {
    expect(summarizeAhead([]).ignoredOnly).toBe(false);
  });
});

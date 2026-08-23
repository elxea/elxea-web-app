/**
 * LINE 本番監視の検知条件を固定する。
 *
 * 監視は「鳴らないこと」が常態なので、壊れても静かに壊れる。ここで実際の route が
 * 吐く文字列を現物のまま入力に使い、拾えることを機械で確かめておく。
 *
 * 入力の文字列は推測ではなく、以下の route の console.warn / console.error から
 * 取ってきた実物:
 *   app/api/user/line-link/callback/route.ts
 *   app/api/line-callback/route.ts
 *   app/api/user/line-link/init/route.ts
 */
import { describe, expect, it } from 'vitest';

import {
  BENIGN_PATTERNS,
  LOG_PATTERNS,
  decideOutcome,
  dedupeById,
  evaluateProbe,
  isWatchedPath,
  matchLogEntry,
  parseLogLines,
  scanLogEntries,
  scanLogLines,
  summarize,
} from '../../scripts/ops/lib/line-log-monitor.mjs';

/** `vercel logs --json` が実際に返す形。余分な項目は監視が使っていない。 */
const logLine = (over: Record<string, unknown> = {}) => ({
  id: 'abc-1',
  timestamp: 1787495409449,
  deploymentId: 'dpl_test',
  projectId: 'prj_test',
  level: 'warning',
  message: '',
  source: 'serverless',
  domain: 'elxea.com',
  requestMethod: 'GET',
  requestPath: '/api/user/line-link/callback',
  responseStatusCode: 307,
  environment: 'production',
  ...over,
});

describe('isWatchedPath', () => {
  it.each([
    '/api/line-login',
    '/api/line-login/init',
    '/api/line-callback',
    '/api/user/line-link/init',
    '/api/user/line-link/callback',
  ])('LINE 系の route を対象にする: %s', (path) => {
    expect(isWatchedPath(path)).toBe(true);
  });

  it.each(['/api/auth/login', '/ja/about', '/api/chat', ''])(
    '無関係な route は対象外: %s',
    (path) => {
      expect(isWatchedPath(path)).toBe(false);
    },
  );

  it('requestPath が無い行で落ちない', () => {
    expect(isWatchedPath(undefined as unknown as string)).toBe(false);
  });
});

describe('matchLogEntry — 実際に出る失敗文字列を拾う', () => {
  it('2026-08-22 の本番障害 (Channel Secret の末尾改行) を critical で拾う', () => {
    // resolveLinkChannelSecret の doc に記録された現物の症状。
    const finding = matchLogEntry(
      logLine({
        message:
          '[line-link/callback] token exchange failed: 400 invalid_client: client_secret does not match',
      }),
    );
    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('critical');
    // token-exchange-failed が先に当たる。invalid_client も同じ critical。
    expect(finding!.id).toBe('token-exchange-failed');
  });

  it('invalid_client 単独でも critical で拾う', () => {
    const finding = matchLogEntry(
      logLine({ message: '[line-callback] LINE auth error: invalid_client' }),
    );
    expect(finding?.id).toBe('invalid-client');
    expect(finding?.severity).toBe('critical');
  });

  it.each([
    ['[line-callback] Token exchange failed: FetchError', 'token-exchange-failed'],
    ['[line-link/callback] token exchange threw: TypeError', 'token-exchange-failed'],
    ['[line-callback] Profile fetch failed', 'profile-fetch-failed'],
    ['[line-callback] id_token rejected: aud mismatch', 'id-token-verify-failed'],
    ['[line-link/callback] id_token verification failed: nonce mismatch', 'id-token-verify-failed'],
    ['[line-link/callback] LINE_LIFF_CHANNEL_ID / _SECRET not configured', 'not-configured'],
    ['[line-link/callback] SYNC_API_SECRET not set; cannot link', 'not-configured'],
    ['[line-link/callback] cx-agent returned 401: unauthorized', 'cx-agent-link-failed'],
    ['[line-link/callback] cx-agent unreachable: ECONNREFUSED', 'cx-agent-link-failed'],
    ['[line-callback] Identity link failed: boom', 'cx-agent-link-failed'],
  ])('%s → %s', (message, expectedId) => {
    expect(matchLogEntry(logLine({ message }))?.id).toBe(expectedId);
  });

  it('503 の auth_not_configured (設定破壊) を拾う', () => {
    const finding = matchLogEntry(
      logLine({
        requestPath: '/api/line-login/init',
        responseStatusCode: 503,
        message: '{"error":"auth_not_configured"}',
      }),
    );
    expect(finding?.id).toBe('not-configured');
    expect(finding?.severity).toBe('critical');
  });

  it('本文が空でも 5xx なら拾う (文字列に頼らない保険)', () => {
    const finding = matchLogEntry(
      logLine({ requestPath: '/api/line-callback', responseStatusCode: 500, message: '' }),
    );
    expect(finding?.id).toBe('route-5xx');
    expect(finding?.severity).toBe('critical');
  });

  it('LINE 系でない route の 5xx は拾わない (この監視の担当外)', () => {
    expect(
      matchLogEntry(logLine({ requestPath: '/api/chat', responseStatusCode: 500 })),
    ).toBeNull();
  });

  it('正常な 200/307 は拾わない', () => {
    expect(matchLogEntry(logLine({ responseStatusCode: 200, message: '' }))).toBeNull();
    expect(matchLogEntry(logLine({ responseStatusCode: 307, message: '' }))).toBeNull();
  });

  it('本文を丸ごと転記しない (公開 issue へ流さないため 200 字で切る)', () => {
    const finding = matchLogEntry(
      logLine({ message: `[line-callback] Token exchange failed: ${'x'.repeat(500)}` }),
    );
    expect(finding!.excerpt.length).toBe(200);
  });
});

describe('matchLogEntry — 正常な離脱で鳴らない (誤報で無視される監視にしない)', () => {
  it.each([
    '[line-link/callback] line returned error: access_denied',
    '[line-link/callback] state rejected: expired',
    '[line-callback] State mismatch',
    '[line-link/callback] no authorization code',
    '[line-link/callback] no shopify session on return',
  ])('ユーザー起因の離脱は無視する: %s', (message) => {
    expect(matchLogEntry(logLine({ message }))).toBeNull();
  });

  it('BENIGN が LOG_PATTERNS より先に効く', () => {
    // キャンセルは 3xx で来るので、5xx フォールバックにも当たらないこと。
    const finding = matchLogEntry(
      logLine({ message: '[line-link/callback] line returned error: user_cancel', responseStatusCode: 307 }),
    );
    expect(finding).toBeNull();
  });
});

describe('scanLogLines', () => {
  it('JSON Lines を数えて検知だけ返す', () => {
    const lines = [
      JSON.stringify(logLine({ responseStatusCode: 200 })),
      JSON.stringify(logLine({ message: '[line-callback] Token exchange failed: x' })),
      '',
      'Vercel CLI 50.22.1', // CLI が stdout に混ぜる非 JSON 行
      JSON.stringify(logLine({ requestPath: '/ja/about', responseStatusCode: 200 })),
    ];
    const result = scanLogLines(lines);
    expect(result.scanned).toBe(3);
    expect(result.findings).toHaveLength(1);
    expect(result.unparsable).toBe(0);
  });

  it('壊れた JSON を黙って捨てず数える', () => {
    const result = scanLogLines(['{"broken": ']);
    expect(result.unparsable).toBe(1);
    expect(result.scanned).toBe(0);
  });

  it('ログが 0 行でも落ちない', () => {
    expect(scanLogLines([]).findings).toEqual([]);
  });
});

describe('dedupeById — 2 回引いたログを二重に数えない', () => {
  it('同じ id の行を 1 件にまとめる', () => {
    // --query line と --status-code 5xx の両方に出てくる行 (LINE route の 500)。
    const shared = logLine({ id: 'dup-1', responseStatusCode: 500 });
    const result = dedupeById([shared, { ...shared }, logLine({ id: 'other' })]);
    expect(result).toHaveLength(2);
  });

  it('id が無い行は timestamp+path+message で見分ける', () => {
    const a = { timestamp: 1, requestPath: '/api/line-login', message: 'x' };
    const b = { timestamp: 2, requestPath: '/api/line-login', message: 'x' };
    expect(dedupeById([a, { ...a }, b])).toHaveLength(2);
  });

  it('重複を除いた結果 1 件の障害が 1 件として数えられる', () => {
    const broken = logLine({
      id: 'dup-2',
      message: '[line-link/callback] token exchange failed: 400 invalid_client',
    });
    const scan = scanLogEntries(dedupeById([broken, { ...broken }]));
    expect(scan.findings).toHaveLength(1);
  });
});

describe('parseLogLines', () => {
  it('非 JSON 行 (CLI のバナー) を混入させない', () => {
    const { entries, unparsable } = parseLogLines([
      'Vercel CLI 50.22.1',
      'Fetching logs...',
      JSON.stringify(logLine()),
    ]);
    expect(entries).toHaveLength(1);
    expect(unparsable).toBe(0);
  });

  it('壊れた JSON は捨てずに数える', () => {
    expect(parseLogLines(['{"a":']).unparsable).toBe(1);
  });
});

describe('evaluateProbe — 設定破壊の即検知', () => {
  const loginProbe = {
    name: 'line-login-redirect',
    path: '/api/line-login',
    expectedStatus: 307,
    expectedLocationHost: 'access.line.me',
    description: 'LINE ログイン開始が access.line.me へ 307 で渡していること',
  };

  it('307 かつ行き先が access.line.me なら通す', () => {
    expect(
      evaluateProbe(loginProbe, {
        status: 307,
        location:
          'https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=2009473839',
      }),
    ).toBeNull();
  });

  it('307 でも行き先が LINE でなければ落とす (パスワード保護が前に出た場合)', () => {
    const finding = evaluateProbe(loginProbe, {
      status: 307,
      location: 'https://elxea.com/password',
    });
    expect(finding).not.toBeNull();
    expect(finding!.reason).toContain('elxea.com');
  });

  it('503 (設定破壊) を落とす', () => {
    const finding = evaluateProbe(loginProbe, { status: 503, location: null });
    expect(finding!.reason).toContain('503');
  });

  it('到達不能を落とす', () => {
    const finding = evaluateProbe(loginProbe, { status: null, location: null, error: 'timeout' });
    expect(finding!.reason).toContain('timeout');
  });

  it('Location が壊れていても例外にせず落とす', () => {
    const finding = evaluateProbe(loginProbe, { status: 307, location: 'not-a-url' });
    expect(finding).not.toBeNull();
  });

  it('連携開始は 401 を期待し、503 なら落とす', () => {
    const linkProbe = {
      name: 'line-link-init-unauthorized',
      path: '/api/user/line-link/init',
      expectedStatus: 401,
      description: '連携開始が未ログインを 401 で弾いていること',
    };
    expect(evaluateProbe(linkProbe, { status: 401, location: null })).toBeNull();
    expect(evaluateProbe(linkProbe, { status: 503, location: null })).not.toBeNull();
  });
});

describe('decideOutcome — ログが引けなかった run を「異常なし」と言わない', () => {
  it('異常なしは 0', () => {
    expect(decideOutcome({ findings: [], fatal: null })).toEqual({ code: 0, outcome: 'clean' });
  });

  it('検知は 1', () => {
    expect(decideOutcome({ findings: [{ id: 'x' }], fatal: null })).toEqual({
      code: 1,
      outcome: 'detected',
    });
  });

  it('監視自体の失敗は 2 (0 に倒さない)', () => {
    expect(decideOutcome({ findings: [], fatal: 'token 無し' })).toEqual({
      code: 2,
      outcome: 'fatal',
    });
  });
});

describe('summarize', () => {
  it('異常なしを検査量つきで言う (空回りと区別できるように)', () => {
    expect(summarize({ findings: [], scanned: 812, windowMinutes: 65 })).toContain('ログ 812 行');
  });

  it('検知は種別ごとに数える', () => {
    const summary = summarize({
      findings: [{ id: 'invalid-client' }, { id: 'invalid-client' }, { id: 'route-5xx' }],
      scanned: 100,
      windowMinutes: 65,
    });
    expect(summary).toContain('異常 3 件');
    expect(summary).toContain('invalid-client x2');
  });
});

describe('パターン表そのものの健全性', () => {
  it('id が重複していない', () => {
    const ids = LOG_PATTERNS.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('severity は critical か error のみ', () => {
    for (const p of LOG_PATTERNS as { severity: string }[]) {
      expect(['critical', 'error']).toContain(p.severity);
    }
  });

  it('BENIGN と LOG_PATTERNS が同じ文字列で衝突していない', () => {
    // 「拾いたい文字列」が BENIGN 側にも当たると、恒久的に沈黙する監視になる。
    const mustFire = [
      '[line-link/callback] token exchange failed: 400 invalid_client',
      '[line-callback] Profile fetch failed',
      '[line-callback] id_token rejected: aud mismatch',
    ];
    for (const message of mustFire) {
      expect(BENIGN_PATTERNS.some((p: RegExp) => p.test(message))).toBe(false);
    }
  });
});

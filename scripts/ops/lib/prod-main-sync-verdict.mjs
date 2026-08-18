// =============================================================================
// prod-main-sync-verdict.mjs — 本番 ↔ main 一致監視の「判定」だけを切り出した純関数
//
// なぜ切り出すか:
//   2026-08-18、本番が main より 259 commit / 約 14h 古い状態で配信されていた。
//   検知するはずの監視 (check-prod-main-sync.mjs) は VERCEL_TOKEN が無い間
//   status=unknown を返し、--fail-on-drift 付きでも exit 0 (=緑) だった。
//   「検証していない」が「検証して問題なかった」と同じ緑で表現されていたのが
//   見逃しの一因。判定を I/O から分離し、fixture でこの 3 パターン
//   (正常 / ずれあり / 検証不能) を回帰テストできるようにする。
//
// 中心となる区別:
//   verified=true   … 実際に本番 SHA と main HEAD を突き合わせた (結論に意味がある)
//   verified=false  … 突き合わせ自体ができなかった (結論は「不明」であって「正常」ではない)
// =============================================================================

/** 判定に使う status の全集合。`unknown` は v2 で `unverifiable` に改名した。 */
export const SYNC_STATUSES = Object.freeze([
  'in_sync',
  'drift',
  'rollback_suspected',
  'unverifiable',
]);

/** 検証不能の原因。運用者が「何を直せば武装できるか」を一意に引けるようにする。 */
export const UNVERIFIABLE_CAUSES = Object.freeze([
  'missing_credentials', // VERCEL_TOKEN 未設定 = 監視が未武装
  'production_api_error', // 武装済みだが Vercel API が答えなかった
  'production_sha_missing', // API は答えたが git SHA meta が無い
  'main_head_unresolved', // gh / git ls-remote のどちらでも main HEAD を取れない
]);

/** exit code の意味。CI 側が「赤」と「未検証」を取り違えないよう分ける。 */
export const EXIT_CODES = Object.freeze({
  IN_SYNC: 0,
  DRIFT: 1, // 検証した結果ずれていた (本物の異常)
  CRASH: 2, // 想定外の例外 (呼び出し側で使用)
  UNVERIFIABLE: 3, // 検証できなかった (fail-closed の既定)
});

const REMEDIATION_DRIFT =
  'docs/ops/production-source-of-truth.md — 24h 以内に是正 (再デプロイ or Undo)。Boss へエスカレ';

const REMEDIATION_BY_CAUSE = Object.freeze({
  missing_credentials:
    'VERCEL_TOKEN が無いため監視は未武装。secret を設定するまでこの監視は本番のずれを検知できない (docs/ops/production-source-of-truth.md)',
  production_api_error:
    'Vercel API に到達できず本番 SHA を確定できない。token の失効・権限・障害を確認する (docs/ops/production-source-of-truth.md)',
  production_sha_missing:
    '本番デプロイに git SHA meta が無い。deploy が --meta githubCommitSha を付けているか確認し、1 度本番デプロイを通す (docs/ops/production-source-of-truth.md)',
  main_head_unresolved:
    'gh / git ls-remote のいずれでも origin/main HEAD を解決できない。GH_TOKEN とネットワークを確認する (docs/ops/production-source-of-truth.md)',
});

/**
 * deploy ワークフローの paths-ignore と同じ判定。
 * ここに該当するファイルだけが差分なら本番デプロイは意図的に走らない。
 * @param {string} p
 * @returns {boolean}
 */
export function isDeployIgnoredPath(p) {
  return p.endsWith('.md') || p.startsWith('docs/') || p === 'LICENSE';
}

/**
 * 変更ファイル一覧から「deploy 対象外だけか」を判定する。
 * 空配列は「差分なし」であり ignoredOnly ではない (SHA 比較側で扱う)。
 * @param {string[]} changed
 * @returns {{ ahead: true, ignoredOnly: boolean, changed: string[] }}
 */
export function summarizeAhead(changed) {
  const files = Array.isArray(changed) ? changed.filter(Boolean) : [];
  return {
    ahead: true,
    ignoredOnly: files.length > 0 && files.every(isDeployIgnoredPath),
    changed: files,
  };
}

/**
 * @typedef {Object} SyncObservation
 * @property {string|null} mainSha            origin/main HEAD (取れなければ null)
 * @property {string|null} prodSha            本番 alias が指すデプロイの git SHA
 * @property {boolean} tokenPresent           VERCEL_TOKEN が存在したか (値は見ない)
 * @property {string|null} [prodError]        Vercel 参照時のエラー要約
 * @property {boolean|null} [liveIsNewest]    live が最新 READY デプロイか (不明なら null)
 * @property {{ ahead: boolean, ignoredOnly: boolean, changed: string[] }|null} [aheadState]
 */

/**
 * @typedef {Object} SyncVerdict
 * @property {'in_sync'|'drift'|'rollback_suspected'|'unverifiable'} status
 * @property {boolean} verified                本番 SHA と main HEAD を実際に突き合わせたか
 * @property {string|null} unverifiableCause   verified=false のときの原因 (それ以外 null)
 * @property {string} reason
 * @property {string|null} remediation
 */

/**
 * 観測結果から判定を下す。副作用なし・I/O なし。
 *
 * 設計上の要:
 *   「検証できなかった」を in_sync に丸めない。unverifiable は独立した status で、
 *   verified=false を必ず伴い、remediation も必ず持つ (null にしない)。
 *
 * @param {SyncObservation} observation
 * @returns {SyncVerdict}
 */
export function classifySync(observation) {
  const {
    mainSha = null,
    prodSha = null,
    tokenPresent = false,
    prodError = null,
    liveIsNewest = null,
    aheadState = null,
  } = observation || {};

  /** @type {(cause: string, reason: string) => SyncVerdict} */
  const unverifiable = (cause, reason) => ({
    status: 'unverifiable',
    verified: false,
    unverifiableCause: cause,
    reason,
    remediation: REMEDIATION_BY_CAUSE[cause] || REMEDIATION_DRIFT,
  });

  if (!mainSha) {
    return unverifiable(
      'main_head_unresolved',
      'could not resolve origin/main HEAD (gh/git unavailable) — comparison was NOT performed',
    );
  }

  if (!prodSha) {
    if (!tokenPresent) {
      return unverifiable(
        'missing_credentials',
        'VERCEL_TOKEN not set — the monitor is unarmed and the comparison was NOT performed',
      );
    }
    if (prodError) {
      return unverifiable(
        'production_api_error',
        `production SHA unavailable: ${prodError} — comparison was NOT performed`,
      );
    }
    return unverifiable(
      'production_sha_missing',
      'production deployment has no git SHA meta — comparison was NOT performed',
    );
  }

  if (liveIsNewest === false) {
    return {
      status: 'rollback_suspected',
      verified: true,
      unverifiableCause: null,
      reason:
        'live production deployment is not the newest READY deployment (Vercel rollback turns off auto-assign)',
      remediation: REMEDIATION_DRIFT,
    };
  }

  if (prodSha === mainSha) {
    return {
      status: 'in_sync',
      verified: true,
      unverifiableCause: null,
      reason: 'production SHA matches origin/main HEAD',
      remediation: null,
    };
  }

  if (aheadState && aheadState.ignoredOnly) {
    return {
      status: 'in_sync',
      verified: true,
      unverifiableCause: null,
      reason: `main is ahead of production by deploy-ignored paths only (docs/md/LICENSE); no deploy expected. changed=${aheadState.changed.length}`,
      remediation: null,
    };
  }

  return {
    status: 'drift',
    verified: true,
    unverifiableCause: null,
    reason: 'production SHA differs from origin/main HEAD',
    remediation: REMEDIATION_DRIFT,
  };
}

/**
 * 判定 → プロセス終了コード。
 *
 * fail-closed の要点: `--fail-on-drift` を付けたゲート実行では、unverifiable は
 * 0 を返さない (既定 3)。緑にしたい場合は呼び出し側が `--unverifiable-exit 0` を
 * 明示する必要があり、その選択がコマンドラインに残る。
 *
 * @param {SyncVerdict} verdict
 * @param {{ failOnDrift?: boolean, unverifiableExit?: number }} [options]
 * @returns {number}
 */
export function exitCodeFor(verdict, options = {}) {
  const { failOnDrift = false, unverifiableExit = EXIT_CODES.UNVERIFIABLE } = options;
  if (!failOnDrift) return EXIT_CODES.IN_SYNC;
  if (verdict.status === 'in_sync') return EXIT_CODES.IN_SYNC;
  if (verdict.status === 'unverifiable') return unverifiableExit;
  return EXIT_CODES.DRIFT;
}

/**
 * 人間 (と Actions ログ) が 1 行で読める見出し。PR #77 の skip 表示と同じ語彙。
 * @param {SyncVerdict} verdict
 * @returns {string}
 */
export function verdictBanner(verdict) {
  if (verdict.status === 'in_sync') return '[OK] verified: production matches main';
  if (verdict.status === 'unverifiable') {
    return `[SKIP] NOT VERIFIED (cause=${verdict.unverifiableCause}): ${verdict.reason}`;
  }
  return `[FAIL] verified: ${verdict.status} — ${verdict.reason}`;
}

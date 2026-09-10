// =============================================================================
// line-log-monitor.mjs — LINE 連携・ログイン系の本番異常を「ログの実物」から拾う
//
// ここには純粋な判定だけを置く (I/O は monitor-line-prod.mjs 側)。ネットワークも
// ファイルも触らないので、__tests__/ops/line-log-monitor.test.ts から実データ形の
// 入力を渡して端から端まで検証できる。検知条件をテストで固定できない監視は、
// 壊れても壊れたと分からない。
//
// ## なぜこの監視が要るのか (消す前に読むこと)
//
// LINE 連携は「本物の LINE」としか結合できない。偽 LINE を立てた E2E
// (e2e/line-linkage-flow.spec.ts) が守れるのは自分たちのコードの筋道までで、
// **本物との境界** — チャネルの鍵・redirect_uri の登録・LINE 側の仕様変更 — は
// 本番でしか壊れない。テスト用の個人 LINE アカウントは持たない方針 (Setaka 決定
// 2026-08-23) なので、その境界は「本番ログの監視による早期検知」で守る。
//
// 実在した壊れ方が根拠になっている:
//   - 2026-08-22 の本番障害。Channel Secret を保存したときに紛れ込んだ末尾改行
//     1 文字で、token 交換が毎回 `400 invalid_client` を返していた。コードは
//     1 行も壊れておらず、CI も E2E も緑のままだった。
//     (app/api/user/line-link/callback/route.ts の resolveLinkChannelSecret 参照)
//
// ## 検知の二本立て
//
//   1. ログ検知 (matchLogEntry) — 実際に落ちた人がいた痕跡を拾う。
//      壊れてから「誰かが踏むまで」は気付けない。
//   2. ヘルスプローブ (evaluateProbe / monitor-line-prod.mjs) — 誰も踏まなくても
//      設定破壊そのものを拾う。踏む人がいない夜間の破壊はこちらでしか出ない。
//
// 2 は 1 の穴を埋めるために居る。片方だけにしないこと。
// =============================================================================

/**
 * 監視対象の route。ログ行の `requestPath` がこの接頭辞のいずれかで始まるものだけを
 * 見る (それ以外の 5xx は、この監視の担当ではない)。
 *
 * `/api/line-login` は `/api/line-login/init` も兼ねる接頭辞になっている。
 */
export const WATCHED_PATH_PREFIXES = [
  '/api/line-login',
  '/api/line-callback',
  '/api/user/line-link',
];

/**
 * ログ本文に出る失敗の型。
 *
 * `pattern` は**実際にコードが出力している文字列**に合わせてある。推測で書くと
 * 「動いているのに何も拾わない監視」になるので、増やすときは必ず route の
 * console.warn / console.error を grep して現物と突き合わせること。
 *
 * severity:
 *   critical … 設定・鍵の破壊。全員が連携できない。放置すると被害が増え続ける。
 *   error    … その回の連携/ログインは失敗した。単発ならユーザー起因もありうる。
 *
 * `anyPath: true` … `WATCHED_PATH_PREFIXES` の縛りを免除する（既定は縛る）。
 *   連携の**読み取り**は route ではなく SSR の描画中に走るので、その失敗ログの
 *   `requestPath` は `/ja/account` のようなページ側になる。path で先に落とすと
 *   一行も拾えない。免除は**文字列が十分に固有な規則にだけ**付けること
 *   （`/cx-agent returned/` のような汎用語に付けると無関係な 401 で鳴り出す）。
 */
export const LOG_PATTERNS = [
  {
    id: 'token-exchange-failed',
    severity: 'critical',
    // [line-link/callback] token exchange failed: 400 invalid_client: ...
    // [line-callback] Token exchange failed: ...
    pattern: /token exchange (failed|threw)/i,
    description: 'LINE との token 交換に失敗 (鍵・redirect_uri の不一致が典型)',
  },
  {
    id: 'invalid-client',
    severity: 'critical',
    // 2026-08-22 の本番障害そのもの。Channel Secret の末尾改行で毎回これが出た。
    pattern: /invalid_client/i,
    description: 'client_id と client_secret の組み合わせが LINE に拒否されている',
  },
  {
    id: 'not-configured',
    severity: 'critical',
    // route が返す 503 の理由文字列。env が消えた / ホスト未登録。
    pattern: /(not configured|auth_not_configured|link_not_configured|auth_host_not_registered|SYNC_API_SECRET not set)/i,
    description: 'このデプロイに LINE 連携の設定が無い (env 欠落 / ホスト未登録)',
  },
  {
    id: 'id-token-verify-failed',
    severity: 'error',
    // [line-callback] id_token rejected: <reason>
    // [line-link/callback] id_token verification failed: <reason>
    pattern: /id_token (verification failed|rejected)|verify failed/i,
    description: 'id_token の検証に失敗 (nonce/aud/exp の不一致、LINE 側仕様変更の疑い)',
  },
  {
    id: 'profile-fetch-failed',
    severity: 'error',
    pattern: /profile fetch failed/i,
    description: 'LINE プロフィール取得に失敗 (access_token かスコープの問題)',
  },
  {
    id: 'cx-agent-link-failed',
    severity: 'error',
    // [line-link/callback] cx-agent returned 401: ... / cx-agent unreachable: ...
    pattern: /cx-agent (returned|unreachable)|identity link failed/i,
    description: '連携台帳 (cx-agent) への書き込みに失敗 — 連携行が立たない',
  },
  {
    id: 'linkage-read-failed',
    severity: 'error',
    // 台帳の**読み取り**が失敗した痕跡。現物 (grep 済み):
    //   [line-linkage-status] reverse lookup unknown: SYNC_API_SECRET not set
    //   [line-linkage-status] reverse lookup returned 401
    //   [line-linkage-status] reverse lookup: linked without customer id
    //   [line-linkage-status] reverse lookup unreachable: <reason>
    //   [line-linkage-status] forward lookup unknown: SYNC_API_SECRET not set
    //   [line-linkage-status] forward lookup unknown: unexpected response shape
    //   [line-linkage-status] forward lookup returned 401
    //   [line-linkage-status] forward lookup unreachable: <reason>
    //   [identity-link] line linkage ledger unreadable; skipping merge (source=...)
    // `:?` は "reverse lookup: linked without customer id" の 1 件のためだけに要る。
    //
    // **forward を足したのが今回の修正 (as-is D-15)。** 順引き
    // (`fetchLineLinkageStatus`) の失敗ログは以前 "[line-linkage-status] unreachable:"
    // 等で、"reverse lookup" を含まないためこの規則にも `cx-agent (returned|unreachable)`
    // にも当たらなかった。本番で順引きが timeout し続けても監視に一行も出ない状態
    // だった。web-app 側でログ文言を forward/reverse で揃え、ここで両方を拾う。
    pattern: /(reverse|forward) lookup:? (returned|unreachable|unknown|linked without)|ledger unreadable/i,
    // path 縛りを免除する。読み取りは SSR の描画中 (`/ja/account` 等) と
    // `auth-callback` から走るので、LINE 系 route の path には出ない。
    // **順引きの主発生源はまさに SSR の `/ja/account`** なので、この免除が無いと
    // 上の pattern を直しても一行も拾えない (D-15 の 3 段目)。
    anyPath: true,
    description:
      '連携台帳の読み取りに失敗 — 連携済みの人が未連携の棚に落ちる (お気に入りが消えたように見える) / 合体が見送られる',
  },
  {
    id: 'linkage-not-linked-after-write',
    severity: 'error',
    // [identity-link] line linkage ledger reports not linked; skipping merge (source=line-link-callback)
    //
    // 連携ボタン / LIFF は **台帳に行を立てた直後** にこの関数へ来る。そこで
    // 「連携が無い」と返るのは、書き込みが成立していないか、書いた鍵と読んだ鍵が
    // 食い違っているということ。利用者には「連携しました」と出たのにデータは
    // 移らない — 今回の本番症状そのもの。
    //
    // `source=line-link` に絞るのが肝。`source=auth-callback` の同じ行は
    // 「未連携の人がメールでログインした」だけで **正常**。絞らないとログイン数
    // だけ鳴って監視が無視されるようになる。
    pattern: /ledger reports not linked; skipping merge \(source=line-link/i,
    anyPath: true,
    description:
      '連携を書いた直後の確認で「連携が無い」と返っている — 画面には「連携しました」と出るのにデータが移らない',
  },
  {
    id: 'linkage-caller-bug',
    severity: 'error',
    // [identity-link] line linkage skipped: invalid input (source=...)
    // [identity-link] line linkage skipped: same key (source=...)
    //
    // どちらも利用者の操作では起こらない (識別子が空 / 仮の棚のキーを顧客 ID として
    // 渡した)。何も起きずに正常終了するので、出たら必ず配線の退行。
    pattern: /line linkage skipped: (invalid input|same key)/i,
    anyPath: true,
    description:
      '合体の呼び出し側が壊れている (識別子が空 / 同一キー) — 連携済みの人の合体が黙って飛ぶ',
  },
];

/**
 * `invalid_grant` と「ユーザーが LINE 側でキャンセルした」は**異常ではない**。
 * 拾ってしまうと、正常な離脱でアラートが鳴り続けて監視そのものが無視される。
 *
 * state 不一致も、cookie を消した人・10 分放置した人で普通に起きる。単発では
 * 異常と言えないので、ここでは黙らせて 5xx とプローブ側に判断を委ねる。
 */
export const BENIGN_PATTERNS = [
  /line returned error: (access_denied|user_cancel|disallowed)/i,
  /state rejected/i,
  /state mismatch/i,
  /no authorization code/i,
  /no shopify session on return/i,
];

/** 監視対象の route かどうか。 */
export function isWatchedPath(requestPath) {
  if (typeof requestPath !== 'string' || requestPath === '') return false;
  return WATCHED_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
}

/**
 * ログ 1 行を判定する。該当しなければ null。
 *
 * 入力は `vercel logs --json` の 1 行 (JSON Lines)。実際に返ってくる形:
 *   { timestamp, level, message, source, domain, requestMethod,
 *     requestPath, responseStatusCode, environment, deploymentId, id }
 */
export function matchLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  /* path 縛りはここで**落とさず**、規則ごとに適用する。連携台帳の読み取り失敗は
     LINE 系 route ではなく SSR ページの描画中に出るので、先に落とすと
     `anyPath` 規則が一件も当たらない。 */
  const onWatchedPath = isWatchedPath(entry.requestPath);

  const message = typeof entry.message === 'string' ? entry.message : '';

  // 正常な離脱を先に落とす。5xx より先に見るのは、キャンセルが 3xx で来るため。
  if (BENIGN_PATTERNS.some((p) => p.test(message))) return null;

  for (const rule of LOG_PATTERNS) {
    if (!onWatchedPath && !rule.anyPath) continue;
    if (rule.pattern.test(message)) {
      return {
        kind: 'log',
        id: rule.id,
        severity: rule.severity,
        description: rule.description,
        requestPath: entry.requestPath ?? null,
        statusCode: entry.responseStatusCode ?? null,
        timestamp: entry.timestamp ?? null,
        // 本文はそのまま持たせない。route 側は秘密を出さない作りだが、監視が
        // Issue に丸ごと転記すると公開リポジトリの issue に流れる。先頭だけ。
        excerpt: message.slice(0, 200),
      };
    }
  }

  /* 本文に何も出ていなくても 5xx は異常。init/callback が 500 を返している状態は
     「誰も連携できない」なので、文字列に頼らずステータスだけで拾う。

     ここは **path 縛りを外さない**。5xx は文字列を見ない規則なので、免除すると
     サイト全域の 5xx がこの監視の担当になってしまう（LINE 連携が壊れていない
     ときに鳴る監視は、やがて無視される）。 */
  if (!onWatchedPath) return null;

  const status = Number(entry.responseStatusCode);
  if (Number.isFinite(status) && status >= 500) {
    return {
      kind: 'log',
      id: 'route-5xx',
      severity: 'critical',
      description: 'LINE 系 route が 5xx を返している',
      requestPath: entry.requestPath,
      statusCode: status,
      timestamp: entry.timestamp ?? null,
      excerpt: message.slice(0, 200),
    };
  }

  return null;
}

/** JSON Lines を解析する。壊れた行は黙って飛ばさず数える (静かな欠測を作らない)。 */
export function parseLogLines(lines) {
  const entries = [];
  let unparsable = 0;

  for (const line of lines) {
    const trimmed = typeof line === 'string' ? line.trim() : '';
    // CLI は stdout に "Vercel CLI 50.22.1" 等の非 JSON も混ぜてくる。
    if (trimmed === '' || !trimmed.startsWith('{')) continue;

    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      unparsable += 1;
    }
  }

  return { entries, unparsable };
}

/**
 * 同じログ行を複数回数えない。
 *
 * 監視は 2 回に分けてログを引く (下の monitor-line-prod.mjs 参照) ので、両方に
 * 出てくる行がある。重複したまま数えると「1 件の障害が 2 件」に見える。
 */
export function dedupeById(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = entry?.id ?? `${entry?.timestamp}:${entry?.requestPath}:${entry?.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** 解析済みのログ行をまとめて判定する。 */
export function scanLogEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    const finding = matchLogEntry(entry);
    if (finding) findings.push(finding);
  }
  return { scanned: entries.length, findings };
}

/** JSON Lines をまとめて判定する (解析 + 判定のひとまとめ)。 */
export function scanLogLines(lines) {
  const { entries, unparsable } = parseLogLines(lines);
  const { scanned, findings } = scanLogEntries(entries);
  return { scanned, unparsable, findings };
}

/**
 * ヘルスプローブ 1 件の判定。
 *
 * これが「設定破壊の即検知」の本体。誰も LINE 連携を踏まなかった時間帯でも、
 * この 2 本が期待通りかどうかは必ず分かる。
 *
 * @param {object} probe   期待値 (name / expectedStatus / expectedLocationHost)
 * @param {object} actual  実測 ({ status, location, error })
 */
export function evaluateProbe(probe, actual) {
  const base = {
    kind: 'probe',
    id: `probe-${probe.name}`,
    severity: 'critical',
    description: probe.description,
    requestPath: probe.path,
  };

  if (actual.error) {
    return { ...base, reason: `到達できなかった: ${actual.error}`, statusCode: null };
  }

  if (actual.status !== probe.expectedStatus) {
    return {
      ...base,
      reason: `期待 ${probe.expectedStatus} に対し ${actual.status} が返った`,
      statusCode: actual.status,
    };
  }

  if (probe.expectedLocationHost) {
    // 307 が返っていても行き先が LINE でなければ意味がない。実際、サイト全体の
    // パスワード保護 (middleware) が前に出ると /password へ 307 が返る。
    // ステータスだけ見る監視はここを緑と誤認する。
    let host = null;
    try {
      host = new URL(actual.location ?? '').host;
    } catch {
      host = null;
    }
    if (host !== probe.expectedLocationHost) {
      return {
        ...base,
        reason: `リダイレクト先が ${probe.expectedLocationHost} ではなく ${host ?? '(不明)'} だった`,
        statusCode: actual.status,
      };
    }
  }

  return null;
}

/**
 * 資格情報ヘルスチェック (`/api/health/line`) の判定。
 *
 * ## 上の evaluateProbe と分けてある理由
 *
 * `evaluateProbe` は「期待したステータス/行き先が返ったか」しか見ない。この
 * エンドポイントは **本文に判定語を載せて返す**設計なので、ステータスだけを見ると
 * 「壊れている」と「LINE に到達できなかった」が同じ 5xx に潰れる。前者は今すぐ
 * 直さないと全員がログインできない状態、後者は判断材料が無いだけで、対処が違う。
 *
 * ## severity の付け方
 *
 *   misconfigured   … critical。**確定した設定破壊**。2026-08-22 / 2026-08-25 の
 *                     本番障害はどちらもこれで、放置した時間だけ被害が増えた。
 *   not-configured  … critical。env が無い = このデプロイでは LINE ログインが
 *                     動かない。「壊れている」と原因は違うが、利用者から見た結果は同じ。
 *   unknown         … error。LINE に到達できなかった等。異常なしではないが、
 *                     こちら側が壊れている証拠でもない。
 *   読めない応答    … error。ステータスは返ったのに JSON が読めない = サイト
 *                     パスワードの門や CDN のエラーページが前に出ている疑い。
 *                     200 でも緑にしない (ステータスだけ見る監視が踏む罠)。
 *
 * @param {object} probe   期待値 (name / path / description)
 * @param {object} actual  実測 ({ status, json, error })
 */
export function evaluateCredentialProbe(probe, actual) {
  const base = {
    kind: 'probe',
    id: `probe-${probe.name}`,
    description: probe.description,
    requestPath: probe.path,
    statusCode: actual.status ?? null,
  };

  if (actual.error) {
    return { ...base, severity: 'error', reason: `到達できなかった: ${actual.error}` };
  }

  const verdict = actual.json && typeof actual.json === 'object' ? actual.json.status : null;

  if (verdict === 'ok') return null;

  if (verdict === 'misconfigured') {
    return {
      ...base,
      severity: 'critical',
      reason:
        'LINE がチャネルの資格情報を拒否している (invalid_client) — 誰もログイン/連携できない。' +
        ` 内訳: ${describeChannels(actual.json)}`,
    };
  }

  if (verdict === 'not-configured') {
    return {
      ...base,
      severity: 'critical',
      reason: `このデプロイに LINE の資格情報が無い。内訳: ${describeChannels(actual.json)}`,
    };
  }

  if (verdict === 'unknown') {
    return {
      ...base,
      severity: 'error',
      reason: `資格情報の可否を判定できなかった。内訳: ${describeChannels(actual.json)}`,
    };
  }

  return {
    ...base,
    severity: 'error',
    reason:
      `判定を読めなかった (status=${actual.status})。` +
      'サイトパスワードの門や CDN のエラーページが前に出ている疑い',
  };
}

/** チャネル別の判定を 1 行にする。**秘密は元から入っていない** (route 側で保証)。 */
function describeChannels(json) {
  const channels = json && typeof json === 'object' ? json.channels : null;
  if (!channels || typeof channels !== 'object') return '(内訳なし)';
  return Object.entries(channels)
    .map(([name, v]) => `${name}=${v?.verdict ?? '?'} (${v?.detail ?? 'no detail'})`)
    .join(' / ');
}

/** 検知結果を 1 行の要約にする (Issue 本文と Job Summary の見出しに使う)。 */
export function summarize(result) {
  const { findings, scanned, windowMinutes } = result;
  if (findings.length === 0) {
    return `異常なし (直近 ${windowMinutes} 分 / ログ ${scanned} 行を検査、プローブ全通過)`;
  }
  const counts = new Map();
  for (const f of findings) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
  const detail = [...counts.entries()].map(([id, n]) => `${id} x${n}`).join(', ');
  return `異常 ${findings.length} 件 (直近 ${windowMinutes} 分 / ログ ${scanned} 行): ${detail}`;
}

/**
 * 終了コード。0 = 異常なし / 1 = 異常検知 / 2 = 監視自体が回らなかった。
 *
 * 2 を 0 と混ぜないのが肝心。ログを 1 行も取れなかった run を「異常なし」と
 * 報告する監視は、壊れたときに黙る。
 */
export function decideOutcome(result) {
  if (result.fatal) return { code: 2, outcome: 'fatal' };
  if (result.findings.length > 0) return { code: 1, outcome: 'detected' };
  return { code: 0, outcome: 'clean' };
}

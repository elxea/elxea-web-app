/**
 * LINE の token endpoint が返す失敗を「誰のせいか」で分類する、唯一の場所。
 *
 * ## なぜ分類が要るのか (2026-08-22 / 2026-08-25 の本番障害)
 *
 * `POST {api.line.me}/oauth2/v2.1/token` は失敗するとほぼ全て `400` で返る。中身は
 * OAuth 2.0 (RFC 6749 §5.2) の `error` コードだが、**原因の系統がまるで違うものが
 * 同じ 400 に畳まれている**:
 *
 *   - `invalid_client` … client_id と client_secret の組が拒否された。
 *     = **こちらの設定が壊れている**。誰が何回試しても必ず失敗する。
 *   - `invalid_grant`  … 認可コードが無効・期限切れ・使用済み。
 *     = **その 1 回の往復の問題**。次にやり直せば直る。
 *
 * 旧実装はこれを区別せず、どちらも `?error=TokenFailed` →
 * 「認証トークンの取得に失敗しました。もう一度お試しください。」に落としていた。
 * Channel Secret に改行が 1 文字紛れて全員が `invalid_client` になっていた間、
 * 画面はひたすら「もう一度お試しください」と言い続けた。**直らないことを、直る
 * かのように案内していた**。ユーザーは同じ失敗を繰り返し、こちらには「ログイン
 * できない」以上の情報が上がってこない。
 *
 * ## 判定の向き (保守的に倒す)
 *
 * LINE は token endpoint のエラーコード一覧を公開していない。よって
 * 「`invalid_client` が返ったか」だけを積極的な判定に使い、それ以外は
 * **資格情報が拒否されたとは言わない**。
 *
 *   - `invalid_client`      → `misconfigured-channel` (設定破壊。確定)
 *   - それ以外の 400        → `bad-grant` (資格情報は拒否されていない)
 *   - 400 以外 / 解析不能   → `unknown` (判定材料が無い。異常なしとは言わない)
 *
 * 逆向き (「`invalid_grant` が返ったときだけ資格情報 OK」) にしないのは、LINE が
 * 検査の順序を変えた日に **ヘルスチェックが恒常的に鳴り続ける** から。鳴りっぱなし
 * の監視は読まれなくなり、本物の `invalid_client` まで一緒に無視される。
 */
import * as Sentry from "@sentry/nextjs";

/** token 交換の失敗の系統。 */
export type TokenErrorKind =
  /** client_id / client_secret が拒否された。設定破壊。ユーザーの再試行では直らない。 */
  | "misconfigured-channel"
  /** 認可コード側の問題。その往復限りで、やり直せば直りうる。 */
  | "bad-grant"
  /** 判定できなかった (LINE が 5xx を返した / 本文が読めない等)。 */
  | "unknown";

export type TokenErrorClassification = {
  kind: TokenErrorKind;
  /** LINE が返した OAuth の `error` コード。読めなければ `null`。 */
  code: string | null;
};

/**
 * LINE の `error` コードとして受け付ける形。
 *
 * RFC 6749 の `error` は ASCII の限られた文字しか取らない。ここで縛るのは、
 * 分類結果をログ・Sentry のタグに載せるため — 本文をそのまま持ち回ると、
 * LINE が将来 `error_description` に識別子めいたものを混ぜたときに、それが
 * 公開リポジトリの issue まで流れうる。
 */
const OAUTH_ERROR_CODE = /^[a-z_]{1,40}$/;

/**
 * token endpoint の失敗レスポンスを分類する。
 *
 * @param status HTTP ステータス
 * @param body   レスポンス本文 (JSON 文字列を想定。壊れていてもよい)
 */
export function classifyTokenExchangeError(
  status: number,
  body: string,
): TokenErrorClassification {
  const code = readOAuthErrorCode(body);

  if (code === "invalid_client") {
    return { kind: "misconfigured-channel", code };
  }

  /* 400 で返ってきて、しかも `invalid_client` ではない = LINE は資格情報を理由に
     拒否していない。grant 側の問題として扱う。コードが読めなくても、400 である
     こと自体が「LINE まで到達し、LINE が判断を下した」証拠なので unknown には
     落とさない。 */
  if (status === 400) {
    return { kind: "bad-grant", code };
  }

  return { kind: "unknown", code };
}

/** 本文から OAuth の `error` コードだけを取り出す。読めなければ `null`。 */
export function readOAuthErrorCode(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // expected-failure: LINE の失敗応答は JSON とは限らず、読めないこと自体が「コード不明 (null)」という定義済みの答え。
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as { error?: unknown }).error;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return OAUTH_ERROR_CODE.test(trimmed) ? trimmed : null;
}

/**
 * 設定破壊 (`invalid_client`) を即座に人の目に届ける。
 *
 * ログだけでは足りない。この Vercel プロジェクトは Hobby プランで Runtime Logs の
 * 保持が **1 時間**しかなく、30 分ごとの監視でも取りこぼす区間がある
 * (`scripts/ops/monitor-line-prod.mjs` の冒頭)。Sentry は保持期間が別なので、
 * ログが消えたあとでも「いつから壊れていたか」が残る。
 *
 * ⚠ 秘密は一切載せない。client_id も channel secret も、`error_description` の
 * 本文も渡さない。載せるのは「どの経路で」「どのコードで」拒否されたかだけ。
 */
export function reportMisconfiguredChannel(params: {
  /** どの route から出たか (`line-callback` / `line-link-callback`)。 */
  source: string;
  /** どのチャネルの資格情報か (`login` / `link`)。 */
  channel: "login" | "link";
  /** LINE が返した OAuth の `error` コード。 */
  code: string | null;
}): void {
  const { source, channel, code } = params;

  console.error(
    `[${source}] LINE rejected the channel credentials (error=${code ?? "unknown"}, channel=${channel}). ` +
      `This does not recover on retry — the channel id/secret pair must be fixed.`,
  );

  Sentry.captureMessage("LINE channel credentials rejected (invalid_client)", {
    level: "error",
    tags: {
      subsystem: "identity-link",
      source,
      channel,
      line_error: code ?? "unknown",
    },
  });
}

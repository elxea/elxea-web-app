/**
 * 「LINE のチャネル資格情報が今この瞬間に通るか」を、**利用者を巻き込まずに**確かめる。
 *
 * ## 何を直しているのか
 *
 * 2026-08-22 と 2026-08-25、どちらも Channel Secret 側の設定破壊で token 交換が
 * 全滅した。コードは 1 行も壊れておらず、CI も E2E も緑のままだった。壊れたことが
 * 分かるのは **実際のお客さんがログインに失敗したとき**だけで、しかもその失敗は
 * 「もう一度お試しください」に化けていたので、こちらに上がってくるまでに時間がかかった。
 *
 * ログ監視 (`scripts/ops/lib/line-log-monitor.mjs`) は「落ちた人がいた痕跡」を拾うので、
 * **誰も踏まない時間帯の破壊は拾えない**。しかも Hobby プランのログ保持は 1 時間しか
 * ないので、拾えなかった区間は永久に消える。
 *
 * そこでこの関数を置く。**わざと無効な認可コード**で token 交換を叩き、LINE の返答が
 * `invalid_client` かどうかだけを見る。人間の LINE アカウントは要らない。誰も
 * ログインしていない夜中でも、設定破壊そのものを直接観測できる。
 *
 * ## なぜ「わざと無効なコード」で判定できるのか
 *
 * token endpoint は 2 つの独立した検査を持つ:
 *
 *   - **クライアント認証** — `client_id` + `client_secret` の組が正しいか
 *   - **グラント検証**     — `code` が有効・未使用・期限内か
 *
 * 前者が落ちれば `invalid_client`、後者が落ちれば `invalid_grant` (RFC 6749 §5.2)。
 * 認可コードは 1 回きりの使い捨てなので、**こちらが用意できるのは必ず無効なコード**
 * である。つまり「正しい資格情報 + 無効なコード」は必ずグラント側で落ちる。
 * `invalid_client` が返るなら、それは **コードに辿り着く前に資格情報で拒まれた**
 * ということで、原因は 100% こちら側の設定にある。
 *
 * 判定の向きは `lib/line/token-error.ts` に寄せてある（`invalid_client` だけを
 * 積極的な証拠として使い、それ以外は「資格情報は拒否されていない」に倒す）。
 * LINE は token endpoint のエラーコード一覧を公開しておらず、検査の順序を変える
 * 可能性があるため。逆向きに書くと、その日からヘルスチェックが鳴りっぱなしになる。
 *
 * ## LINE 側に負荷をかけないこと
 *
 *   - 送るのは常に固定の無効コード 1 本。認可フローは開始しない。
 *   - route 側 (`app/api/health/line/route.ts`) が判定結果を短時間キャッシュする。
 *   - 失敗が確定しているリクエストなので、LINE 側にセッションもトークンも作らない。
 */
import { lineApiBaseUrl } from "@/lib/line/endpoints";
import { classifyTokenExchangeError } from "@/lib/line/token-error";
import { logger } from "@/lib/log";

/** 資格情報 1 組の判定。 */
export type CredentialVerdict =
  /** LINE は資格情報を受け付けた（拒んだのはグラント側）。 */
  | "ok"
  /** LINE が資格情報を拒んだ。設定破壊。誰もログインできない。 */
  | "misconfigured"
  /** そもそも env が無い。「壊れている」とは別の事実として扱う。 */
  | "not-configured"
  /** 判定できなかった（LINE に到達できない / 想定外の応答）。異常なしではない。 */
  | "unknown";

export type CredentialProbeResult = {
  verdict: CredentialVerdict;
  /**
   * 人が読むための一行。**秘密は載せない** — LINE の `error` コードと HTTP
   * ステータスだけ。この文字列は公開エンドポイントの本文に出る。
   */
  detail: string;
};

/**
 * 資格情報が「必ず失敗する」ことは分かっているコード。LINE 側で意味を持たない形に
 * してあるので、万一の衝突で他人の認可コードを消費することはない。
 */
const DELIBERATELY_INVALID_CODE = "elxea-health-probe-not-a-real-code";

export type ProbeInput = {
  channelId: string | undefined;
  channelSecret: string | undefined;
  /** token 交換に載せる `redirect_uri`。route 側が本番の値を渡す。 */
  redirectUri: string;
  /** テストから差し替えるための注入口。既定は global fetch。 */
  fetchImpl?: typeof fetch;
  /** 応答を待つ上限 (ms)。 */
  timeoutMs?: number;
};

/**
 * 1 チャネル分の資格情報を検査する。
 *
 * この関数は**投げない**。ネットワーク障害も想定外の応答も `unknown` に畳む。
 * ヘルスチェックが例外で 500 になると、「設定は正常なのに監視だけが赤い」状態と
 * 「本当に壊れている」状態が区別できなくなる。
 */
export async function probeChannelCredentials(
  input: ProbeInput,
): Promise<CredentialProbeResult> {
  const { channelId, channelSecret, redirectUri } = input;

  if (!channelId || !channelSecret) {
    const missing = [
      channelId ? null : "channel id",
      channelSecret ? null : "channel secret",
    ]
      .filter(Boolean)
      .join(" / ");
    return {
      verdict: "not-configured",
      detail: `env missing: ${missing}`,
    };
  }

  const doFetch = input.fetchImpl ?? fetch;

  let status: number;
  let body: string;
  try {
    const res = await doFetch(`${lineApiBaseUrl()}/oauth2/v2.1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: DELIBERATELY_INVALID_CODE,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    /* ⚠ 例外の中身をそのまま出さない。fetch の TypeError は URL を含むことがあり、
       ここで組み立てた URL には `client_secret` は載らないものの、載らないことに
       依存した書き方はしない。出すのは種別だけ。 */
    /* `unknown` は「異常なし」ではない。検査そのものが届かなかったことを残す
       (公開する本文には出さないので、記録側にだけ詳細を渡す)。 */
    logger.error("line.credential-probe.request-failed", err, {
      operation: "token-exchange-probe",
      verdict: "unknown",
    });
    return {
      verdict: "unknown",
      detail: `could not reach LINE (${err instanceof Error ? err.name : "error"})`,
    };
  }

  /* 2xx は起こりえない。無効なコードで token が発行されたなら、こちらの前提
     （このコードは必ず無効）が崩れている。判定材料にならないので unknown。 */
  if (status >= 200 && status < 300) {
    return {
      verdict: "unknown",
      detail: `LINE accepted a deliberately invalid code (HTTP ${status}) — probe assumption broken`,
    };
  }

  const { kind, code } = classifyTokenExchangeError(status, body);

  if (kind === "misconfigured-channel") {
    return {
      verdict: "misconfigured",
      detail: `LINE rejected the channel credentials (HTTP ${status} ${code})`,
    };
  }

  if (kind === "bad-grant") {
    return {
      verdict: "ok",
      detail: `credentials accepted; grant rejected as expected (HTTP ${status} ${code ?? "no code"})`,
    };
  }

  return {
    verdict: "unknown",
    detail: `unexpected response from LINE (HTTP ${status} ${code ?? "no error code"})`,
  };
}

/** 判定の重さ。大きいほど悪い。全体判定を出すときの比較に使う。 */
const SEVERITY: Record<CredentialVerdict, number> = {
  ok: 0,
  unknown: 1,
  "not-configured": 2,
  misconfigured: 3,
};

/**
 * 複数チャネルの判定から全体判定を出す。**一番悪いものに倒す。**
 *
 * 平均や多数決にしない。ログインだけ通って連携が全滅している状態は「半分正常」では
 * なく、利用者から見れば壊れている。
 */
export function worstVerdict(verdicts: readonly CredentialVerdict[]): CredentialVerdict {
  if (verdicts.length === 0) return "unknown";
  return verdicts.reduce((worst, v) => (SEVERITY[v] > SEVERITY[worst] ? v : worst));
}

/**
 * 全体判定 → HTTP ステータス。
 *
 * 判定を本文の JSON だけに置かない。汎用の死活監視（ステータスしか見ない類）でも
 * 設定破壊が赤く出るようにしておく。
 */
export function verdictHttpStatus(verdict: CredentialVerdict): number {
  switch (verdict) {
    case "ok":
      return 200;
    case "unknown":
      // 「上流に問い合わせたが判断できなかった」= 502 が意味的に近い。
      return 502;
    case "not-configured":
    case "misconfigured":
      // このデプロイでは LINE ログインが機能しない = 503。
      return 503;
  }
}

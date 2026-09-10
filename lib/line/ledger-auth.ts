/**
 * 台帳 API（cx-agent）が共有鍵を拒否したことを、即座に人の目に届ける唯一の場所。
 *
 * ## なぜこれが要るのか（2026-08-30 の本番障害）
 *
 * web-app は連携の読み書きを全部 cx-agent の HTTP API に預けており、その認証は
 * `X-API-Key: SYNC_API_SECRET` 1 本である。この鍵が片側だけローテートされると、
 * **連携に関わる全経路が同時に、恒久的に落ちる**:
 *
 *   - `POST /api/identity/link-liff` … 連携そのもの（Web 発・ワンタップの両方）
 *   - `GET  /api/identity/linkage-status` … マイページの連携状態表示（順引き・逆引き）
 *
 * 2026-08-30 に実際に起きたのがこれで、Worker 側の secret が 13:05 に上書きされ、
 * 17 分後にオーナーが連携を試みて両方向とも失敗した。本番ログに残っていたのは
 *
 *   [line-link/callback] cx-agent returned 401: {"error":"Unauthorized"}
 *   [one-tap-link] cx-agent rejected the linkage (status=401)
 *   [line-linkage-status] forward lookup returned 401
 *
 * の 3 行だが、**いずれも `console.warn` / `console.error` 止まり**だった。この
 * Vercel プロジェクトは Runtime Logs の保持が短く、翌日にはもう読めない（実際、
 * 事故調査の時点で 08-29 分のログは失われていた）。結果、
 *
 *   - お客さまには「もう一度お試しください」＝ **やり直しても直らない案内**が出続け
 *   - こちらには「いつから壊れていたか」を示す記録がどこにも残らない
 *
 * という、2026-08-22 の Channel Secret 障害と**まったく同じ形**の壊れ方になった。
 * あちらは `reportMisconfiguredChannel`（`lib/line/token-error.ts`）で解決済みで、
 * これはその共有鍵版である。設計意図も対称に保つ:
 *
 *   **401 は「連携できなかった 1 件」ではなく「全員が連携できない」。**
 *   1 件の失敗としてログに流さず、設定破壊として上げる。
 *
 * ⚠ 秘密は一切載せない。鍵の値・長さ・先頭数文字はどれも渡さない。載せるのは
 *   「どの経路が」「どの状態で」拒否されたかだけ（`token-error.ts` と同じ方針）。
 */
import * as Sentry from "@sentry/nextjs";

import { logger } from "@/lib/log";

/** 共有鍵まわりの壊れ方。cx-agent 側の `[sync-auth] reason=` と語彙を揃える。 */
export type LedgerAuthFailure =
  /** 呼び出し側（web-app）に `SYNC_API_SECRET` が無い。呼ぶ前に諦めた。 */
  | "secret-missing"
  /** 鍵は送ったが台帳が 401 を返した。両側の値がずれている。 */
  | "key-rejected";

/**
 * 台帳 API の共有鍵が使えないことを報告する。
 *
 * @param source どの経路から出たか（`line-link-callback` / `one-tap-link` /
 *               `linkage-status-forward` / `linkage-status-reverse`）。
 */
export function reportLedgerAuthFailure(params: {
  source: string;
  failure: LedgerAuthFailure;
}): void {
  const { source, failure } = params;

  console.error(
    `[${source}] cx-agent shared secret unusable (${failure}). ` +
      `This does not recover on retry — SYNC_API_SECRET must match on both Vercel and the Worker.`,
  );

  Sentry.captureMessage("cx-agent shared secret rejected (SYNC_API_SECRET)", {
    level: "error",
    tags: {
      subsystem: "identity-link",
      source,
      failure,
    },
  });
}

/**
 * 共有鍵が**いまこの瞬間に通るか**を、人を介さずに確かめる。
 *
 * ## なぜログ監視では足りないのか
 *
 * ログ検知は「落ちた人がいた痕跡」しか拾えない。誰も連携を試さない時間帯に鍵が
 * ずれても分からず、Vercel のログ保持が短いので拾えなかった区間は消える。実際
 * 2026-08-30 の障害は、**オーナーが手で踏むまで誰も気付かなかった**。
 * この probe は踏む人がゼロでも必ず答えが出る（`/api/health/line` と同じ設計思想で、
 * あちらの `probeChannelCredentials` の共有鍵版）。
 *
 * ## 何を叩くか — 副作用のない読み取りだけ
 *
 * `GET /api/identity/linkage-status` は cx-agent 側で **読み取り専用**と宣言されて
 * いる口で、同じ `X-API-Key` ゲートを通る。連携を書く `POST /api/identity/link-liff`
 * は叩かない（監視が本番の台帳に行を書くことは絶対にあってはならない）。
 *
 * ## 判定の向き（保守的に倒す）
 *
 * **401 だけ**を「鍵が壊れている」と読む。それ以外の HTTP 応答は、内容が何であれ
 * 「認証は通った」証拠なので `ok` にする（400 でも 500 でもよい — この probe が
 * 見ているのは鍵であって台帳の健康ではない）。逆向きに「200 のときだけ ok」に
 * すると、台帳側の別の不調でこの監視が鳴り続け、読まれなくなる。
 */
export async function probeLedgerSharedSecret(params: {
  baseUrl: string;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ verdict: LedgerProbeVerdict; detail: string }> {
  const { baseUrl, secret } = params;
  const doFetch = params.fetchImpl ?? fetch;

  if (!secret) {
    return { verdict: "not-configured", detail: "SYNC_API_SECRET is not set" };
  }

  /* 実在しない顧客 ID。読み取り専用の口なので、当たっても外れても何も変わらない。 */
  const url = `${baseUrl}/api/identity/linkage-status?shopify_customer_id=0`;

  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: { "X-API-Key": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(params.timeoutMs ?? 5000),
    });

    if (isLedgerAuthRejection(res.status)) {
      return {
        verdict: "misconfigured",
        detail: "cx-agent rejected SYNC_API_SECRET (401)",
      };
    }
    return { verdict: "ok", detail: `cx-agent accepted the key (HTTP ${res.status})` };
  } catch (err) {
    /* `unknown` は「異常なし」ではない。検査そのものが届かなかったことを残す
       （公開する本文には種別しか出さないので、記録側にだけ詳細を渡す）。
       隣の `probeChannelCredentials` と同じ扱いにしてある。 */
    logger.error("line.ledger-probe.request-failed", err, {
      operation: "probeLedgerSharedSecret",
    });
    return {
      verdict: "unknown",
      detail: `cx-agent unreachable: ${err instanceof Error ? err.name : "error"}`,
    };
  }
}

/** `/api/health/line` の判定語彙と同じもの（`lib/line/credential-probe.ts`）。 */
export type LedgerProbeVerdict = "ok" | "misconfigured" | "not-configured" | "unknown";

/**
 * 台帳の応答が「共有鍵の問題」かどうか（純粋関数）。
 *
 * 401 だけを見る。403 を含めないのは、cx-agent が共有鍵の不一致に対して返すのが
 * 401 の 1 通りだと `src/lib/sync-auth.ts` が定めているためで、他の状態を混ぜると
 * 「設定破壊」の意味が薄まって通知が読まれなくなる。
 */
export function isLedgerAuthRejection(status: number): boolean {
  return status === 401;
}

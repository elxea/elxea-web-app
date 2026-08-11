/**
 * 定期便の督促 (dunning) 判定。
 *
 * この周期の課金がどこまで進んだかを、**課金試行の履歴だけ**から決める純関数群。
 * route (`app/api/cron/billing/route.ts`) は判断結果を受けて課金・停止するだけにし、
 * 判定そのものはここで閉じてテスト可能にしている。
 *
 * ## なぜ「窓」の設計が重要か (2026-08-11 の障害)
 *
 * 是正前は失敗の集計窓を `nextBillingDate -24h 〜 +96h` に固定していた。
 * ところが **課金が失敗した契約の `nextBillingDate` は前進しない**ため、請求日から
 * 96h を過ぎた契約は「窓の外」に落ち、失敗履歴が何件あっても `failureCount` が
 * 常に 0 と評価された。その結果:
 *
 *   - リトライ上限 (`MAX_RETRY_ATTEMPTS`) に永久に到達せず、契約が一時停止されない
 *   - 毎日「初回試行」として扱われ、課金試行と督促メールが無限に繰り返される
 *
 * 実例: 契約 25318162590 は請求日 04-19 に対して 07-12 にも試行が走っていた。
 *
 * ## 是正後の判定モデル
 *
 * 窓の上限を撤去し、基準を「請求日を起点とした**この周期の試行履歴**」に置き換えた。
 * 失敗中は `nextBillingDate` が動かないので、`請求日 - CYCLE_GRACE_HOURS` 以降の試行は
 * すべて「まだ支払われていない今の周期」のものと見なせる。上限が無いので、請求日から
 * 何日経っていても失敗は数え落とされず、上限到達で確実に停止に入る。
 *
 * 下限 (grace) は残す。これは前の周期の失敗を今の周期に持ち込まないための境界で、
 * タイムゾーン差やcronの実行遅れで請求日直前に落ちた試行を拾うための猶予でもある。
 *
 * ## 安全側の倒し方
 *
 * 実顧客の誤課金・誤停止を避けるため、判断がつかない場合は**課金しない**側に倒す。
 *
 *   - 完了した試行 (`errorCode` なし & `ready`) がこの周期にあれば、もう課金しない
 *   - 処理中の試行 (`errorCode` なし & `ready` でない) があっても、結果が出るまで課金しない
 *   - `createdAt` が読めない失敗は「この周期の失敗」として数える (課金を足す方向に倒さない)
 *   - 請求日が読めなければ何もしない (呼び出し側が skip する)
 */

/** 判定に必要な試行の最小形。`BillingAttempt` はこれを満たす。 */
export type DunningAttempt = {
  createdAt: string;
  errorCode: string | null;
  ready?: boolean;
};

/** 失敗を何件まで許して契約を一時停止するか。 */
export const MAX_RETRY_ATTEMPTS = 3;

/** リトライの最小間隔 (時間)。 */
export const RETRY_INTERVAL_HOURS = 24;

/**
 * 請求日より前に落ちた試行を「今の周期」として拾う猶予 (時間)。
 * これより前の試行は前の周期のものとして数えない。
 */
export const CYCLE_GRACE_HOURS = 24;

/**
 * 処理中の試行がこの時間を超えたら「詰まっている」と見なす閾値 (時間)。
 * 課金は行わないが、無音で止まり続けないよう呼び出し側が通知する。
 */
export const STALE_IN_FLIGHT_HOURS = 48;

export type BillingCycleState = {
  /** 請求日が日時として読めたか。false なら他の値は判定不能として扱う。 */
  billingDateValid: boolean;
  /** この周期の失敗件数 (上限なし)。 */
  failureCount: number;
  /** 直近の失敗時刻。失敗はあるが時刻が読めない場合は null。 */
  lastFailureAt: Date | null;
  /** この周期で課金が完了した試行の時刻 (`errorCode` なし & `ready`)。 */
  completedAt: Date | null;
  /** この周期で結果待ちの試行の時刻 (`errorCode` なし & `ready` でない)。 */
  inFlightAt: Date | null;
};

const HOUR_MS = 60 * 60 * 1000;

function parseMs(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 請求日を起点に、この周期の課金試行がどこまで進んだかを集計する。
 *
 * 窓は `[請求日 - CYCLE_GRACE_HOURS, ∞)`。**上限は設けない** —
 * 上限を設けると失敗中に前進しない `nextBillingDate` のせいで古い契約の失敗が
 * 数え落とされ、上限到達も停止も起きなくなる (このファイル冒頭の障害)。
 */
export function analyzeBillingCycle(
  attempts: DunningAttempt[],
  billingDate: string
): BillingCycleState {
  const billingDateMs = parseMs(billingDate);

  if (billingDateMs === null) {
    return {
      billingDateValid: false,
      failureCount: 0,
      lastFailureAt: null,
      completedAt: null,
      inFlightAt: null,
    };
  }

  const cycleStartMs = billingDateMs - CYCLE_GRACE_HOURS * HOUR_MS;

  let failureCount = 0;
  let lastFailureMs: number | null = null;
  let completedMs: number | null = null;
  let inFlightMs: number | null = null;

  for (const attempt of attempts) {
    const attemptMs = parseMs(attempt.createdAt);

    // createdAt が読めない試行は「今の周期のもの」として扱う。周期外だと決めつけると
    // 失敗を数え落として再課金してしまうため、課金を足さない側に倒す。
    if (attemptMs !== null && attemptMs < cycleStartMs) continue;

    if (attempt.errorCode) {
      failureCount += 1;
      if (attemptMs !== null && (lastFailureMs === null || attemptMs > lastFailureMs)) {
        lastFailureMs = attemptMs;
      }
      continue;
    }

    if (attempt.ready === true) {
      if (completedMs === null || (attemptMs !== null && attemptMs > completedMs)) {
        completedMs = attemptMs ?? completedMs ?? billingDateMs;
      }
      continue;
    }

    if (inFlightMs === null || (attemptMs !== null && attemptMs > inFlightMs)) {
      inFlightMs = attemptMs ?? inFlightMs ?? billingDateMs;
    }
  }

  return {
    billingDateValid: true,
    failureCount,
    lastFailureAt: lastFailureMs === null ? null : new Date(lastFailureMs),
    completedAt: completedMs === null ? null : new Date(completedMs),
    inFlightAt: inFlightMs === null ? null : new Date(inFlightMs),
  };
}

/**
 * 直近の失敗から `RETRY_INTERVAL_HOURS` 以上経ったか (リトライしてよいか)。
 */
export function isReadyForRetry(lastFailureAt: Date, now: Date): boolean {
  const hoursSinceFailure =
    (now.getTime() - lastFailureAt.getTime()) / HOUR_MS;
  return hoursSinceFailure >= RETRY_INTERVAL_HOURS;
}

/**
 * 結果待ちの試行が `STALE_IN_FLIGHT_HOURS` を超えて放置されているか。
 * 課金の可否には影響しない (待つ側に倒す)。通知の判断にだけ使う。
 */
export function isStaleInFlight(inFlightAt: Date, now: Date): boolean {
  const hoursSince = (now.getTime() - inFlightAt.getTime()) / HOUR_MS;
  return hoursSince >= STALE_IN_FLIGHT_HOURS;
}

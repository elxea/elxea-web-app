/**
 * 定期便の `nextBillingDate` を Shopify の billing cycle に整合させる。
 *
 * ## なぜこのファイルが必要か (無音の売上停止)
 *
 * `SubscriptionContract.nextBillingDate` は Shopify 公式に
 * "This field is managed by the apps" と明記されている **アプリ管理のフィールド**。
 * `subscriptionBillingAttemptCreate` は billing cycle を課金するだけで、
 * `nextBillingDate` には触れない。
 *
 * アプリ側に前進処理が無かったため、定期便は **1 回課金した時点で永久に停止**していた。
 * しかも止まり方が無音だった: `app/api/cron/billing/route.ts` の Case 1 が毎日
 * `action: "skipped"` を返し、`skipped` は `failureTotal` に数えられず Sentry にも
 * 上がらないため、売上が止まっていることが誰にも見えなかった。
 *
 * Ref: https://shopify.dev/docs/api/admin-graphql/latest/objects/SubscriptionContract
 * Ref: https://shopify.dev/docs/api/admin-graphql/latest/mutations/subscriptionContractSetNextBillingDate
 *
 * ## 中核の設計原則: 日付を計算しない。Shopify から導出する
 *
 *   nextBillingDate := status が UNBILLED かつ skipped でない billing cycle のうち
 *                      cycleIndex 最小のものの billingAttemptExpectedDate
 *
 * `+1 month` のような**算術を一切しない**。カレンダー演算 (月末・閏年・DST・
 * アンカー日) を自前で持つと Shopify の周期定義と必ず乖離するし、何より
 * 「今の値に 1 周期足す」設計は **走った回数だけ進む**ので、cron と webhook の
 * 二重発火や再実行で日付が飛ぶ。
 *
 * 導出は Shopify の状態だけの関数なので:
 *
 *   - 何回走らせても結果が同じ (冪等)。二重前進が**構造的に起こらない**
 *   - 課金が確定していない周期はまだ `UNBILLED` なので、導出値が現在値と一致し
 *     `noop` になる。つまり「未収の周期を飛び越えて先に送る」ことが原理的に起きない
 *
 * ## 5 つのガード
 *
 * 1. **差分時のみ書く** — 導出値 == 現在値なら mutation を呼ばず `noop`
 *    (`decideNextBillingDate`)
 * 2. **確定成功時のみ発火** — `pending` (Shopify 受理済み・結果未確定) では前進させない。
 *    この判定は**呼び出し側 (cron / webhook) の責務**で、本 lib は「呼ばれたら導出して
 *    整合させる」に徹する。ただし上記のとおり導出モデル自体が二重の安全網になっている:
 *    課金が確定するまで cycle は `UNBILLED` のままなので、誤って pending 中に呼んでも
 *    導出値は現在値と一致して `noop` に落ちる
 * 3. **前向き専用** — 導出値 < 現在値なら書かずに `blocked_backward` + Sentry warning。
 *    請求日の巻き戻りは「同じ周期をもう一度課金する」入口なので絶対に書かない
 * 4. **飛び幅トリップワイヤ** — 導出値が現在値より「1 周期 x
 *    `JUMP_TRIPWIRE_PERIOD_MULTIPLE`」を超えて先なら Sentry error を上げる。
 *    **止めない (warn して書く)**。値は Shopify 由来で信頼でき、ここで止めると
 *    「無音で前進しない」現在の停止状態を再生産するため
 * 5. **競合耐性** — 書く直前に read-then-compare する。cron と webhook が同時に
 *    走っても導出値は同一なので last-write-wins が無害。既に他方が書いていれば `noop`
 *
 * ## 実測した Shopify の挙動 (2026-08-12 / API 2026-07 / 本番 2 契約)
 *
 * - `billingAttemptExpectedDate` は `cycleEndAt` と同値だった (周期の終わりに課金)
 * - 一度も課金が通っていない契約は cycle 1 が `UNBILLED` のままで、その
 *   `billingAttemptExpectedDate` が契約の `nextBillingDate` と完全一致する
 *   → 導出しても動かない (`noop`)。ガード 1 が実データで成立している
 * - `subscriptionBillingCycles` は index / date どちらかの selector が必須。
 *   index を使う理由と実測した範囲上限は `admin-queries.ts` / `subscription-admin.ts` を参照
 */
import * as Sentry from "@sentry/nextjs";

import type {
  SubscriptionBillingCycle,
} from "./admin-types";
import {
  BILLING_CYCLE_INDEX_WINDOW,
  getBillingCycles,
  getContractNextBillingDate,
  setNextBillingDate,
  type PaginationOptions,
} from "./subscription-admin";

/**
 * 「1 周期 + マージン」の係数。導出値が `現在値 + 周期長 x この値` より先なら
 * トリップワイヤが発火する (Sentry error / ただし書き込みは行う)。
 *
 * 1.5 = 「1 周期分の前進は正常、2 周期分は異常」の中間。周期長は対象 cycle の
 * `cycleEndAt - cycleStartAt` から取るので、月の長さの違いを自前で扱わずに済む。
 */
export const JUMP_TRIPWIRE_PERIOD_MULTIPLE = 1.5;

/** index 窓を最大いくつ走査するか。25 x 8 = cycleIndex 1..200 を覆う。 */
export const BILLING_CYCLE_MAX_WINDOWS = 8;

export type AdvanceAction =
  /** 前進させた (mutation を実行した)。 */
  | "advanced"
  /** 導出値が現在値と同じ。mutation は呼んでいない。 */
  | "noop"
  /** UNBILLED cycle が無い。無変更。 */
  | "no_unbilled_cycle"
  /** 導出値が現在値より過去。巻き戻りを拒否した。無変更。 */
  | "blocked_backward"
  /** 導出・読み書きのいずれかが失敗。無変更 (書く前に失敗した場合)。 */
  | "failed";

export type AdvanceResult = {
  action: AdvanceAction;
  /** 判定時点の `nextBillingDate`。読めなかった場合は null。 */
  from: string | null;
  /** 導出した `nextBillingDate`。導出できなかった場合は null。 */
  to: string | null;
  /** `advanced` 以外では必ず入る。 */
  reason?: string;
  /** ガード 4 が発火したか (`advanced` のときだけ意味を持つ)。 */
  jumpExceeded?: boolean;
  /** 導出に使った cycle の index (観測用)。 */
  cycleIndex?: number;
};

export type DecideNextBillingDateInput = {
  cycles: SubscriptionBillingCycle[];
  currentNextBillingDate: string | null;
};

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 課金対象になりうる最小の cycle を選ぶ = `UNBILLED` かつ `skipped` でないもののうち
 * `cycleIndex` 最小。
 *
 * `sortKey: CYCLE_INDEX` で引いていても**ここで自前に最小を取る**。並び順を前提に
 * 「先頭」を採る実装は、クエリの sortKey を誰かが変えた瞬間に静かに壊れる
 * (壊れ方が「別の周期に課金する」なので、静かに壊れてはいけない)。
 */
export function selectEarliestUnbilledCycle(
  cycles: SubscriptionBillingCycle[]
): SubscriptionBillingCycle | null {
  let earliest: SubscriptionBillingCycle | null = null;

  for (const cycle of cycles) {
    if (cycle.status !== "UNBILLED") continue;
    if (cycle.skipped) continue;
    if (!Number.isFinite(cycle.cycleIndex)) continue;
    if (earliest === null || cycle.cycleIndex < earliest.cycleIndex) {
      earliest = cycle;
    }
  }

  return earliest;
}

/** 周期の長さ (ms)。読めない場合は null (トリップワイヤを見送る)。 */
function periodMsOf(cycle: SubscriptionBillingCycle): number | null {
  const startMs = parseMs(cycle.cycleStartAt);
  const endMs = parseMs(cycle.cycleEndAt);
  if (startMs === null || endMs === null) return null;
  const periodMs = endMs - startMs;
  return periodMs > 0 ? periodMs : null;
}

/**
 * 純粋な判定。副作用なし・時計に依存しない (`Date.now()` を読まない)。
 *
 * 時計を読まないのは意図的で、同じ入力なら**いつ実行しても同じ結論**になる。
 * 「今日以降か」を混ぜると、過去に置かれたまま未収の cycle を飛ばす判断が入り込む。
 */
export function decideNextBillingDate({
  cycles,
  currentNextBillingDate,
}: DecideNextBillingDateInput): AdvanceResult {
  const cycle = selectEarliestUnbilledCycle(cycles);

  if (cycle === null) {
    return {
      action: "no_unbilled_cycle",
      from: currentNextBillingDate,
      to: null,
      reason:
        `${cycles.length} 件の billing cycle に UNBILLED (skipped でない) が無い ` +
        `— 導出元が無いので nextBillingDate は動かさない`,
    };
  }

  const derived = cycle.billingAttemptExpectedDate;
  const derivedMs = parseMs(derived);

  if (derivedMs === null) {
    return {
      action: "failed",
      from: currentNextBillingDate,
      to: derived ?? null,
      reason:
        `cycle #${cycle.cycleIndex} の billingAttemptExpectedDate が日時として ` +
        `読めない (${JSON.stringify(derived)}) — 推測で書かない`,
      cycleIndex: cycle.cycleIndex,
    };
  }

  // 現在値が無い契約: 比較する基準が無いので前向き判定は行えないが、
  // 「請求日が無い = 課金されない」状態こそ是正対象なので導出値を書く。
  if (currentNextBillingDate === null || currentNextBillingDate === "") {
    return {
      action: "advanced",
      from: null,
      to: derived,
      reason: "現在の nextBillingDate が無いため導出値で初期化する",
      jumpExceeded: false,
      cycleIndex: cycle.cycleIndex,
    };
  }

  const currentMs = parseMs(currentNextBillingDate);

  if (currentMs === null) {
    return {
      action: "failed",
      from: currentNextBillingDate,
      to: derived,
      reason:
        `現在の nextBillingDate が日時として読めない ` +
        `(${JSON.stringify(currentNextBillingDate)}) — 前向き判定ができないので書かない`,
      cycleIndex: cycle.cycleIndex,
    };
  }

  // ガード 1: 差分時のみ書く。
  if (derivedMs === currentMs) {
    return {
      action: "noop",
      from: currentNextBillingDate,
      to: derived,
      reason: `導出値が現在値と一致 (cycle #${cycle.cycleIndex}) — mutation を呼ばない`,
      cycleIndex: cycle.cycleIndex,
    };
  }

  // ガード 3: 前向き専用。
  if (derivedMs < currentMs) {
    return {
      action: "blocked_backward",
      from: currentNextBillingDate,
      to: derived,
      reason:
        `導出値 ${derived} が現在値 ${currentNextBillingDate} より過去 ` +
        `(cycle #${cycle.cycleIndex}) — 請求日の巻き戻りは同じ周期の再課金につながるため拒否`,
      cycleIndex: cycle.cycleIndex,
    };
  }

  // ガード 4: 飛び幅トリップワイヤ。止めずに観測だけ足す。
  const periodMs = periodMsOf(cycle);
  const advanceMs = derivedMs - currentMs;
  const jumpExceeded =
    periodMs !== null && advanceMs > periodMs * JUMP_TRIPWIRE_PERIOD_MULTIPLE;

  return {
    action: "advanced",
    from: currentNextBillingDate,
    to: derived,
    jumpExceeded,
    cycleIndex: cycle.cycleIndex,
  };
}

export type AdvanceOptions = {
  /** index 窓の幅。既定 `BILLING_CYCLE_INDEX_WINDOW`。 */
  windowSize?: number;
  /** 走査する窓の最大数。既定 `BILLING_CYCLE_MAX_WINDOWS`。 */
  maxWindows?: number;
  /** `getBillingCycles` に渡すページング設定 (テストで待ち時間を 0 にする等)。 */
  pagination?: PaginationOptions;
};

/**
 * 契約の「cycleIndex 最小の UNBILLED cycle」を取る。
 *
 * index 窓を 1 から昇順に走査する。窓を昇順に見るので、**最初に見つかった窓の中の
 * 最小**が全体の最小になる。
 *
 * 見つからないまま窓を使い切った場合は **例外**にする (null で返さない)。
 * ここで静かに null を返すと呼び出し側は「UNBILLED が無い正常な契約」と区別できず、
 * 前進しない理由が再び無音になる — このファイルが存在する理由そのものを再生産する。
 */
export async function getEarliestUnbilledCycle(
  contractId: string,
  options: AdvanceOptions = {}
): Promise<SubscriptionBillingCycle | null> {
  const windowSize = options.windowSize ?? BILLING_CYCLE_INDEX_WINDOW;
  const maxWindows = options.maxWindows ?? BILLING_CYCLE_MAX_WINDOWS;

  for (let window = 0; window < maxWindows; window++) {
    const startIndex = 1 + window * windowSize;
    const endIndex = startIndex + windowSize - 1;

    const cycles = await getBillingCycles(
      contractId,
      { startIndex, endIndex },
      options.pagination ?? {}
    );

    const hit = selectEarliestUnbilledCycle(cycles);
    if (hit !== null) return hit;

    // 窓が埋まりきらなかった = 生成可能な cycle を使い切った。
    // これは「UNBILLED が本当に無い」正常系 (全周期が課金済み / スキップ済み)。
    if (cycles.length < windowSize) return null;
  }

  throw new Error(
    `getEarliestUnbilledCycle(${contractId}): cycleIndex 1..${maxWindows * windowSize} ` +
      `に UNBILLED cycle が無い — 推測で先送りせず失敗させる`
  );
}

function reportBlockedBackward(contractId: string, result: AdvanceResult): void {
  console.warn(
    `[next-billing-date] ${contractId}: 巻き戻りを拒否 ` +
      `(${result.from} -> ${result.to})`,
    result.reason
  );
  Sentry.captureMessage(
    "nextBillingDate advance blocked: derived date is earlier than current",
    {
      level: "warning",
      tags: { module: "next-billing-date", action: result.action },
      extra: {
        contractId,
        from: result.from,
        to: result.to,
        cycleIndex: result.cycleIndex,
        reason: result.reason,
      },
    }
  );
}

function reportJumpExceeded(contractId: string, result: AdvanceResult): void {
  console.error(
    `[next-billing-date] ${contractId}: 飛び幅が 1 周期 x ` +
      `${JUMP_TRIPWIRE_PERIOD_MULTIPLE} を超えた (${result.from} -> ${result.to})。` +
      `Shopify 由来の値なので書き込みは行う`
  );
  Sentry.captureMessage(
    "nextBillingDate advanced further than one billing period + margin",
    {
      level: "error",
      tags: { module: "next-billing-date", action: "advanced" },
      extra: {
        contractId,
        from: result.from,
        to: result.to,
        cycleIndex: result.cycleIndex,
        periodMultiple: JUMP_TRIPWIRE_PERIOD_MULTIPLE,
      },
    }
  );
}

function reportFailure(
  contractId: string,
  reason: string,
  error?: unknown
): void {
  console.error(`[next-billing-date] ${contractId}: ${reason}`, error ?? "");
  if (error === undefined) {
    Sentry.captureMessage("nextBillingDate advance could not be decided", {
      level: "error",
      tags: { module: "next-billing-date", action: "failed" },
      extra: { contractId, reason },
    });
    return;
  }
  Sentry.captureException(error, {
    tags: { module: "next-billing-date", action: "failed" },
    extra: { contractId, reason },
  });
}

/**
 * 契約の `nextBillingDate` を Shopify の billing cycle に整合させる。
 *
 * 呼び出し側 (cron / webhook) の責務:
 *
 *   - **課金が確定成功したときにだけ呼ぶ** (ガード 2)。`pending` では呼ばない
 *   - 戻り値の `failed` を必ず集計・通知に載せる。`skipped` と同じ扱いで
 *     捨てると、また無音で止まる
 *
 * 本関数は例外を投げない (`failed` に畳んで返す) が、**黙って畳まない** —
 * `failed` は必ず Sentry と console に出る。
 */
export async function advanceNextBillingDate(
  contractId: string,
  options: AdvanceOptions = {}
): Promise<AdvanceResult> {
  let observedFrom: string | null = null;

  try {
    const current = await getContractNextBillingDate(contractId);
    observedFrom = current;

    const cycle = await getEarliestUnbilledCycle(contractId, options);
    const cycles = cycle === null ? [] : [cycle];

    let decision = decideNextBillingDate({
      cycles,
      currentNextBillingDate: current,
    });

    if (decision.action === "blocked_backward") {
      reportBlockedBackward(contractId, decision);
      return decision;
    }
    if (decision.action === "failed") {
      reportFailure(contractId, decision.reason ?? "判定に失敗");
      return decision;
    }
    if (decision.action !== "advanced") {
      return decision;
    }

    // ガード 5: 書く直前に read-then-compare。
    // cron と webhook が同時に走ったとき、既に他方が書いていれば noop に落とす。
    // 導出値は Shopify の状態だけの関数なので、両者の結論は必ず一致する。
    const fresh = await getContractNextBillingDate(contractId);
    if (fresh !== current) {
      const redecided = decideNextBillingDate({
        cycles,
        currentNextBillingDate: fresh,
      });
      const concurrent = `並行更新を検知 (${current} -> ${fresh})`;

      if (redecided.action === "blocked_backward") {
        const annotated = {
          ...redecided,
          reason: `${redecided.reason} / ${concurrent}`,
        };
        reportBlockedBackward(contractId, annotated);
        return annotated;
      }
      if (redecided.action === "failed") {
        const annotated = {
          ...redecided,
          reason: `${redecided.reason} / ${concurrent}`,
        };
        reportFailure(contractId, annotated.reason);
        return annotated;
      }
      if (redecided.action !== "advanced") {
        return { ...redecided, reason: `${redecided.reason} / ${concurrent}` };
      }
      decision = redecided;
    }

    const target = decision.to;
    if (target === null) {
      const reason = "advanced と判定されたが書き込む日時が無い (到達不能)";
      reportFailure(contractId, reason);
      return { ...decision, action: "failed", reason };
    }

    if (decision.jumpExceeded) {
      reportJumpExceeded(contractId, decision);
    }

    await setNextBillingDate(contractId, target);

    console.info(
      `[next-billing-date] ${contractId}: ${decision.from} -> ${target} ` +
        `(cycle #${decision.cycleIndex})`
    );

    return decision;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    reportFailure(contractId, `nextBillingDate の整合に失敗: ${reason}`, error);
    return {
      action: "failed",
      from: observedFrom,
      to: null,
      reason,
    };
  }
}

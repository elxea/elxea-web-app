import * as Sentry from "@sentry/nextjs";

import { redact, redactError } from "./redact";

/**
 * 記録の単一経路（設計憲章 Wave 3 / R1 の全域展開）。
 *
 * ## 何を直しているか
 *
 * 記録の系統が 2 本あった。
 *
 *   1. `console.*` — 着手時点で `lib` `app` `components` `sanity` に **225 か所**。
 *      Vercel のログに落ちるだけで、集計もアラートも付いていない。
 *   2. `Sentry.captureException` — 着手時点で **22 か所**。`app/api` に 12 件、
 *      `lib/shopify` に 3 件、`lib/auth` に 2 件、その他 5 件。`lib/firebase`
 *      `lib/line` `components/**` は **0 件**。
 *
 * 2 本あること自体が問題ではなく、**どちらに載るかが書き手の気分で決まる**のが
 * 問題だった。実際、決済・会員資格の失敗が 1 の側にだけ載っていて、顧客には
 * 「ログアウト」「契約 0 件」と表示されながらアラートは鳴らなかった
 * （経緯は `lib/shopify/load-result.ts` 冒頭）。
 *
 * ここを通せば **error / fatal は必ず両方に載る**。どちらに載せるかを呼び出し側が
 * 決める余地を無くすのが要点である。
 *
 * ## 使い方
 *
 * ```ts
 * import { logger } from "@/lib/log";
 *
 * try {
 *   await chargeSubscription(id);
 * } catch (err) {
 *   logger.error("payment.subscription.charge-failed", err, { subscriptionId: id });
 *   return NextResponse.json({ error: "…" }, { status: 500 });
 * }
 * ```
 *
 * `event` は**安定した名前**にする（`区画.対象.できごと`）。Sentry はこれを
 * タグにして数えるので、テンプレート文字列で毎回変える名前を入れない。
 *
 * ## どこまで届くか
 *
 * | レベル | console | Sentry |
 * |---|---|---|
 * | `fatal` | error | あり (fatal) |
 * | `error` | error | あり (error) |
 * | `warn`  | warn  | **なし** |
 * | `info`  | info  | **なし** |
 *
 * `warn` / `info` を Sentry に載せないのは、載せると本当に鳴ってほしい error が
 * 埋もれるため。したがって lint（`no-silent-catch-at-boundary`）は `error` /
 * `fatal` だけを「調査できる形に残した」と数える。失敗を `warn` に落として
 * 静かにする逃げ道は用意しない。
 *
 * ## 個人情報
 *
 * 詰めた値は `./redact` を必ず通る。呼び出し側で気をつける運用にしない
 * （気をつけ忘れた 1 か所がそのまま外部送信になる）。
 */

/** 記録に添える文脈。値は `redact` を通ってから外に出る。 */
export type LogContext = Record<string, unknown>;

export type LogLevel = "fatal" | "error" | "warn" | "info";

/**
 * `区画.対象.できごと` の形を推奨する。区画 (先頭の 1 語) は Sentry の
 * `area` タグになり、「決済まわりだけ」を数えられるようにする。
 */
function areaOf(event: string): string {
  const head = event.split(".")[0];
  return head.length > 0 ? head : "unknown";
}

function toError(event: string, detail: unknown): Error {
  if (detail instanceof Error) return redactError(detail);

  /* Error でないものが投げられることは実際にある (文字列 / Response / undefined)。
     Sentry に stack を持たせるため Error に包み直し、元の値は extra に残す。 */
  return new Error(event);
}

/**
 * 記録そのものが例外を投げないようにする最後の砦。
 *
 * この logger は **catch の中から呼ばれるのが常態**である。ここで投げると
 * 呼び出し元の catch を素通りして上へ抜け、「可視化を足しただけ」のはずの
 * 変更が**動作を変える**。それは今回のいちばん重い禁則なので、機構の側で
 * 起こり得なくしておく。
 *
 * 現実に投げ得るのは 2 つ:
 *   - `redact` が値を辿るとき、getter を持つオブジェクトがその場で投げる
 *   - Sentry の送信側が初期化前などの理由で投げる
 *
 * どちらも「記録できなかった」であって、業務の失敗ではない。素の console に
 * 落として続行する (ここで黙ると記録の不調そのものが見えなくなる)。
 */
function emit(level: LogLevel, event: string, detail: unknown, context?: LogContext): void {
  try {
    emitUnsafe(level, event, detail, context);
  } catch (loggingError) {
    console.error(`[log.emit-failed] ${event}`, loggingError);
  }
}

function emitUnsafe(level: LogLevel, event: string, detail: unknown, context?: LogContext): void {
  const safeContext = (context ? redact(context) : undefined) as LogContext | undefined;
  const safeDetail = detail === undefined ? undefined : redact(detail);

  /* 開発中に手元で読めることは残す (console を捨てるのが目的ではない)。 */
  const line = `[${event}]`;
  if (level === "fatal" || level === "error") {
    console.error(line, safeDetail ?? "", safeContext ?? {});
  } else if (level === "warn") {
    console.warn(line, safeDetail ?? "", safeContext ?? {});
  } else {
    console.info(line, safeDetail ?? "", safeContext ?? {});
  }

  if (level !== "fatal" && level !== "error") return;

  Sentry.captureException(toError(event, detail), {
    level,
    tags: { event, area: areaOf(event) },
    extra: {
      ...safeContext,
      /* Error はそのまま渡してあるので二重に持たない。 */
      detail: detail instanceof Error ? undefined : safeDetail,
    },
  });
}

export const logger = {
  /** 復旧しないと売上・契約が壊れる。 */
  fatal(event: string, detail: unknown, context?: LogContext): void {
    emit("fatal", event, detail, context);
  },

  /** 失敗した。誰かが見に行く必要がある。 */
  error(event: string, detail: unknown, context?: LogContext): void {
    emit("error", event, detail, context);
  },

  /** 想定内だが気になる。Sentry には**載らない**。 */
  warn(event: string, context?: LogContext): void {
    emit("warn", event, undefined, context);
  },

  /** 手元とログのための記録。Sentry には**載らない**。 */
  info(event: string, context?: LogContext): void {
    emit("info", event, undefined, context);
  },
};

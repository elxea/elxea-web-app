import "server-only";

import { env, isProduction } from "@/lib/config";
import { logger } from "@/lib/log";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";

/**
 * events gateway への送り口（CDP 統合 Stage 1 / サーバ専用）。
 *
 * ## なぜ web-app から cx-agent を叩くのか
 *
 * L0（`customer_events`）は Supabase にあり、このアプリは Supabase クライアントを
 * 持たない（Firestore だけ）。web で起きた出来事を L0 に載せる経路は cx-agent 経由
 * しか無い。認証は既存の共有秘密（`SYNC_API_SECRET` / `X-API-Key`）をそのまま使う
 * — 新しい秘密を作ると本番への配布が判断事項になり、段がそこで止まるため。
 *
 * ## 契約の正本はこちらではない
 *
 * payload の形・冪等キーの作り方・語彙の扱いは cx-agent 側の
 * `docs/cdp-events-gateway-contract.md` が正本。ここはその送り口であって、
 * 契約の説明を二重に持たない。
 *
 * ## 失敗しても画面を壊さない
 *
 * 行動ログは誰も待っていない。到達不能・401・タイムアウトはすべて握って
 * `false` を返す（呼び出し側の応答は変えない）。ただし **握ったことは残す** —
 * 静かに落ちる経路をもう 1 本増やすのが、この段でいちばんやってはいけないこと。
 */

/** 行動ログは誰も待っていないので短く切る。 */
const REQUEST_TIMEOUT_MS = 2_000;

export interface GatewayEvent {
  /** L0 の型名。未知でもよい（cx-agent 側が schema_ok=false で受ける）。 */
  event_type: string;
  channel: string;
  identifier_kind: string;
  identifier_value: string;
  /** 同じ現実の出来事なら何度計算しても同じになる文字列。 */
  dedupe: string;
  source: string;
  occurred_at?: string;
  /** PII 禁止（生の識別子・メール・自由文の本文を入れない）。 */
  payload?: Record<string, unknown>;
}

/**
 * L0 に出来事を送る。**決して throw しない。**
 *
 * @returns 受理されたら true。それ以外（未設定・到達不能・拒否）は false。
 */
export async function sendToEventsGateway(
  events: GatewayEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (events.length === 0) return true;

  const secret = env("SYNC_API_SECRET");
  if (!secret) {
    /* fail-closed（送らない）。本番で起きているなら設定事故なので、
       chat proxy と同じく本番だけ声を上げる。 */
    if (isProduction()) {
      logger.error(
        "cdp.events-gateway.secret-missing",
        new Error("SYNC_API_SECRET not set; behavior facts are not reaching L0"),
        { count: events.length },
      );
    }
    return false;
  }

  try {
    const res = await fetchImpl(`${CX_AGENT_BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": secret },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      /* 応答は変えないが、届かなかったことは残す（憲章 R1）。
         中身ではなく種別だけを出す（出来事の内容はログに載せない）。 */
      logger.error(
        "cdp.events-gateway.rejected",
        new Error(`events gateway responded ${res.status}`),
        { status: res.status, count: events.length },
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error("cdp.events-gateway.unreachable", err, { count: events.length });
    return false;
  }
}

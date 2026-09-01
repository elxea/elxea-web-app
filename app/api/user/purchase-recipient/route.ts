/**
 * POST /api/user/purchase-recipient — 「誰のために買ったか」を受ける（第1段 ⑤）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ⑤ / §3「自分用と贈答は
 * 別モデル」。
 *
 * ## なぜ購入画面の中で聞かないのか
 *
 * 設計 §2 の表は「購入完了後（**購入画面の外**）」と指定している。決済は Shopify の
 * ホストする画面で完結していて、こちらから割り込む口がそもそも無い。よって
 * 「次に開いたときに 1 枚出す」形にしてある（§2 の到達 3 経路のうち 2 本目と同じ形）。
 *
 * ## 1 注文につき 1 回
 *
 * 冪等キーは `order:<orderId>` 1 本なので、2 回目は gateway が
 * `duplicate_idempotency_key` で静かに落とす（＝二重に数えられない）。押し間違いの
 * 訂正経路は第2段（§6 ⑧⑪）の仕事で、この段では作らない。
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import { toRecipientGatewayEvent } from "@/lib/cdp/cup-feedback";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { markOrderRecipient } from "@/lib/firebase/profile-store";
import { logger } from "@/lib/log";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { PurchaseRecipientBodySchema } from "@/lib/validation/profile-schema";
import { parseJsonBody } from "@/lib/validation/zod-helpers";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PurchaseRecipientBodySchema);
    if (!parsed.ok) {
      console.warn("[POST /api/user/purchase-recipient] rejected payload (schema drift?)");
      return parsed.response;
    }

    const occurredAt = new Date().toISOString();
    const subject = resolveBehaviorSubject(
      auth,
      undefined,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );
    if (subject.kind === null) {
      logger.error(
        "api.purchase-recipient.subject-unresolved",
        new Error("authenticated caller has no usable identifier"),
        { route: "POST /api/user/purchase-recipient", reason: subject.reason },
      );
      return NextResponse.json({ error: "subject_unresolved" }, { status: 409 });
    }

    const { orderId, scene } = parsed.data;
    const stored = await sendToEventsGateway([
      toRecipientGatewayEvent(subject, { orderRef: orderId, scene }, occurredAt),
    ]);
    if (!stored) {
      return NextResponse.json({ error: "not_recorded" }, { status: 503 });
    }

    /* 印は L0 に積めたときだけ（同じ注文を二度聞かないための状態であって、
       事実の正本ではない）。 */
    await markOrderRecipient(auth.userKey, orderId, scene);

    return NextResponse.json({ recorded: true });
  } catch (err) {
    logger.error("api.purchase-recipient.submit-failed", err, {
      route: "POST /api/user/purchase-recipient",
    });
    return NextResponse.json({ error: "purchase_recipient_failed" }, { status: 500 });
  }
}

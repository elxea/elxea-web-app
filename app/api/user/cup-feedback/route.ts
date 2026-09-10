/**
 * POST /api/user/cup-feedback — 届いた一杯への答えを受ける（第1段 ① / ⑦）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §6 第1段 ① / §7 択一 #4・#11。
 *
 * ## この口がやること
 *
 *   1. 答え（記述語 1 つ・合わなかったときは「どこが」1 つ）を **L0 に積む**
 *      （`rating.submitted`。数値の `score` はここで初めて現れる）。
 *   2. 「いまは答えない」は **`flow.survey_decline` で積む**。評価としては積まない
 *      （設計 §2「無回答は第 3 の値。否定信号にしない」）。
 *   3. L0 に積めたときだけ、同じ一杯を二度聞かないための印を Firestore に残す。
 *
 * ## ログインが要る（択一 #11 = (a) 正本維持）
 *
 * 同梱カードの QR は**全員同一**で、URL に個人を指すものは載らない。だから
 * 「誰の一杯か」はログインでしか決まらない。未ログインは 401 を返し、画面側が
 * ログインへ送る。署名付きリンク（無ログイン）は択一 #11 で**採らないと確定**した。
 *
 * ## 印を「積めたときだけ」付ける理由
 *
 * gateway が落ちているときに印だけ残ると、その一杯は二度と聞けないのに L0 には
 * 何も無い、という取り返しのつかない欠落になる（設計 §6「取り返せないのは生の
 * 出来事だけ」）。積めなければ印を付けず、次に開いたときにまた聞く。
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import {
  toFeedbackDeclinedGatewayEvent,
  toRatingGatewayEvent,
} from "@/lib/cdp/cup-feedback";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { markCupFeedback } from "@/lib/firebase/profile-store";
import { logger } from "@/lib/log";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { CupFeedbackBodySchema } from "@/lib/validation/profile-schema";
import { parseJsonBody } from "@/lib/validation/zod-helpers";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, CupFeedbackBodySchema);
    if (!parsed.ok) {
      /* 送り手と受け口がずれたことをサーバ側に残す（behavior route と同じ理由）。 */
      console.warn("[POST /api/user/cup-feedback] rejected payload (schema drift?)");
      return parsed.response;
    }

    /* 1 回の答えであることを表すので、時刻はここで 1 度だけ決める。 */
    const occurredAt = new Date().toISOString();
    const subject = resolveBehaviorSubject(
      auth,
      undefined,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );
    if (subject.kind === null) {
      /* ログイン済みなのに主体が出せないのは、連携の解決に失敗しているとき。
         握って 200 を返すと「答えたのに何も残っていない」になるので、理由を返す。 */
      logger.error(
        "api.cup-feedback.subject-unresolved",
        new Error("authenticated caller has no usable identifier"),
        { route: "POST /api/user/cup-feedback", reason: subject.reason },
      );
      return NextResponse.json({ error: "subject_unresolved" }, { status: 409 });
    }

    const body = parsed.data;
    const { productNo, issueRef } = body;
    const declined = "decline" in body;

    const stored = await sendToEventsGateway([
      "decline" in body
        ? toFeedbackDeclinedGatewayEvent(subject, productNo, occurredAt)
        : toRatingGatewayEvent(
            subject,
            {
              productNo,
              verdict: body.verdict,
              aspect: body.aspect,
              deliveryRef: issueRef,
            },
            occurredAt,
          ),
    ]);

    if (!stored) {
      /* 届かなかったことは `sendToEventsGateway` が既に残している。ここでは
         印を付けずに「受け取れていない」と返し、画面が言い直せるようにする。 */
      return NextResponse.json({ error: "not_recorded" }, { status: 503 });
    }

    await markCupFeedback(auth.userKey, productNo, {
      issueRef,
      at: occurredAt,
      declined,
    });

    return NextResponse.json({ recorded: true, declined });
  } catch (err) {
    /* 人が押して待っている応答なので 500 を返す（行動ログのような握り潰しはしない）。 */
    logger.error("api.cup-feedback.submit-failed", err, {
      route: "POST /api/user/cup-feedback",
    });
    return NextResponse.json({ error: "cup_feedback_failed" }, { status: 500 });
  }
}

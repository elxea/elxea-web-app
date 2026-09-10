/**
 * POST /api/diagnosis — 茶葉診断（Web 入口）の答えを受け、その場の結果を返す。
 *
 * CDP 統合 Stage 4 / 欠陥 D8（茶葉診断 Web 入口が未実装）。
 *
 * ## この口がやること
 *
 * 1. 答え 3 つを **L0 に積む**（events gateway 経由・`diagnosis.answer` 3 件）。
 * 2. その場に出す結果（persona）を返す。
 *
 * ## やらないこと（意図的）
 *
 * **カルテ（Firestore）には 1 行も書かない。** persona の書き手は cx-agent
 * `preference-pipeline` 1 本という決まりで（統合設計 T-1 / §6-3）、Stage 0 で
 * 撤去したばかりの 2 人目の書き手をここで復活させない。返す persona は
 * 「この 3 つの答えの中の勝者」であって、その人のカルテの primary ではない。
 *
 * L0 に積めなかったとき（同意が無い・gateway が届かない）も **結果は返す**。
 * 記録の可否と、答えた人に結果を見せることは別の話で、前者の失敗で後者を
 * 巻き添えにすると「同意しない人は診断を使えない」になる。積めたかどうかは
 * `recorded` で返し、積まなかった理由は握らず返す（憲章 R1: 静かに落とさない）。
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { logger } from "@/lib/log";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { DiagnosisBodySchema } from "@/lib/validation/diagnosis-schema";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import { scoreDiagnosis, toDiagnosisGatewayEvents } from "@/lib/cdp/diagnosis";

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();

    const limited = await enforceRateLimit(
      request,
      limiters.authedUser,
      auth.authenticated ? auth.userKey : "anon",
    );
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DiagnosisBodySchema);
    if (!parsed.ok) {
      /* 送り手と受け口がずれたことをサーバ側に残す（behavior route と同じ理由）。 */
      console.warn("[POST /api/diagnosis] rejected payload (schema drift?)");
      return parsed.response;
    }

    const { q1, q2, q3, anonymousId } = parsed.data;
    const answers = { q1, q2, q3 };

    /* 3 件が「1 回の診断」であることを表すので、時刻はここで 1 度だけ決める。 */
    const occurredAt = new Date().toISOString();
    const subject = resolveBehaviorSubject(
      auth,
      anonymousId,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );

    let recorded = false;
    if (subject.kind !== null) {
      recorded = await sendToEventsGateway(
        toDiagnosisGatewayEvents(subject, answers, occurredAt),
      );
    }

    return NextResponse.json({
      persona: scoreDiagnosis(answers),
      recorded,
      ...(subject.kind === null ? { reason: subject.reason } : {}),
    });
  } catch (err) {
    /* 結果を返せないので 500 を返す（行動ログと違い、これは人が待っている応答）。 */
    logger.error("api.diagnosis.submit-failed", err, {
      route: "POST /api/diagnosis",
    });
    return NextResponse.json({ error: "diagnosis_failed" }, { status: 500 });
  }
}

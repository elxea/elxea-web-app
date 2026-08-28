/**
 * POST /api/survey — AI ティーコンシェルジュ体験のアンケート（CSAT / NPS）を中継する。
 *
 * ## CDP 統合 Stage 4 で足したこと
 *
 * cx-agent へ素通しするだけだった経路に、**L0（`customer_events`）への追記**を
 * 足した。Stage 1 で行動ログは events gateway を通るようになったのに、アンケート
 * だけが通っておらず、「診断で何を選んだか」と「体験をどう評価したか」が同じ人の
 * 話として繋がらなかった（Stage 4 完了条件）。
 *
 * 追記は **cx-agent への送信が成功したあとにだけ** 行い、失敗しても応答は変えない
 * （L0 は誰も待っていない）。順序が逆だと、cx-agent が拒否したアンケートが L0 に
 * だけ残る。
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { env, isProduction } from "@/lib/config";
import { logger } from "@/lib/log";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { AnonymousIdSchema } from "@/lib/validation/behavior-schema";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveBehaviorSubject } from "@/lib/cdp/behavior-fact";
import { toSurveyGatewayEvents } from "@/lib/cdp/survey-fact";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      csat,
      would_use_again,
      best_aspects,
      improvement_suggestion,
      nps,
      round,
      anonymousId,
    } = body;

    // Basic validation
    if (typeof csat !== "number" || csat < 1 || csat > 5) {
      return NextResponse.json({ error: "csat must be 1-5" }, { status: 400 });
    }
    if (!["yes", "not_sure"].includes(would_use_again)) {
      return NextResponse.json({ error: "invalid would_use_again" }, { status: 400 });
    }
    if (!Array.isArray(best_aspects) || best_aspects.length === 0) {
      return NextResponse.json({ error: "best_aspects required" }, { status: 400 });
    }
    if (typeof nps !== "number" || nps < 0 || nps > 10) {
      return NextResponse.json({ error: "nps must be 0-10" }, { status: 400 });
    }

    // C: Forward X-API-Key so the cx-agent survey endpoint (fail-closed) accepts the request.
    // The worker rejects unauthenticated calls; this proxy holds the shared secret.
    const syncApiSecret = env("SYNC_API_SECRET");
    const isProd = isProduction();
    if (isProd && !syncApiSecret) {
      console.error(
        "[survey] SYNC_API_SECRET not set; cx-agent will reject the request (set in production)",
      );
    }
    const surveyHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (syncApiSecret) {
      surveyHeaders["X-API-Key"] = syncApiSecret;
    }

    const surveyRound = round ?? 1;

    const res = await fetch(`${CX_AGENT_BASE_URL}/api/survey`, {
      method: "POST",
      headers: surveyHeaders,
      body: JSON.stringify({
        csat,
        would_use_again,
        best_aspects,
        improvement_suggestion: improvement_suggestion || null,
        nps,
        round: surveyRound,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("Survey proxy error:", res.status, errorBody);
      return NextResponse.json(
        { error: "Failed to submit survey" },
        { status: res.status }
      );
    }

    const result = await res.json();

    /* L0 へ（CDP 統合 Stage 4）。**応答は変えない** — 積めなくてもアンケートは
       受理されている。誰の出来事として積むかの判断は behavior と同じ関数に任せ、
       同意していない匿名の人はここでも通らない（fail-closed の二重ゲート）。 */
    await recordSurveyFacts({
      anonymousId,
      facts: {
        csat,
        would_use_again,
        best_aspects,
        nps,
        round: surveyRound,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.survey.submit-failed", err, {
      route: "/api/survey",
      status: 500,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * アンケートの事実を L0 に積む。**決して throw しない**（呼び出し元の応答を変えない）。
 *
 * 自由文（`improvement_suggestion`）は引数に無い。契約 §6 で L0 の payload は PII を
 * 持たないと決めてあり、自由文はその約束を守れないため、写す関数が受け取らない形に
 * してある（`lib/cdp/survey-fact.ts`）。
 */
async function recordSurveyFacts({
  anonymousId,
  facts,
}: {
  anonymousId: unknown;
  facts: Parameters<typeof toSurveyGatewayEvents>[1];
}): Promise<void> {
  try {
    const auth = await resolveIdentity();
    const parsedAnonymousId = AnonymousIdSchema.safeParse(anonymousId);
    const subject = resolveBehaviorSubject(
      auth,
      parsedAnonymousId.success ? parsedAnonymousId.data : undefined,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );
    if (subject.kind === null) return;

    /* 4 件が 1 回のアンケートであることを表すので、時刻はここで 1 度だけ決める。 */
    const occurredAt = new Date().toISOString();
    await sendToEventsGateway(toSurveyGatewayEvents(subject, facts, occurredAt));
  } catch (err) {
    /* アンケート自体は受理済み。届かなかったことだけ残す（憲章 R1）。 */
    logger.error("api.survey.l0-record-failed", err, { route: "/api/survey" });
  }
}

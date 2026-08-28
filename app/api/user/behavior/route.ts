/**
 * POST /api/user/behavior
 *
 * Record a behavior event in the user's Firestore behaviorLog subcollection.
 * Called from client components (page views, article reads, product views, favorites).
 *
 * The endpoint is fire-and-forget from the client perspective — a 200 response
 * is returned even if Firestore write fails (non-critical analytics path).
 *
 * Body: { action, channel, metadata }
 *   action:   BehaviorAction — "view_content" | "view_product" | "tap_button" | "search" | ...
 *   channel:  BehaviorChannel — always "web" from this route
 *   metadata: BehaviorEventMetadata — { contentId?, productId?, query?, buttonLabel? }
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/log";
import { BehaviorBodySchema } from "@/lib/validation/behavior-schema";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { addBehaviorLog } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";
import { sendToEventsGateway } from "@/lib/cdp/events-gateway-client";
import { resolveBehaviorSubject, toBehaviorGatewayEvent } from "@/lib/cdp/behavior-fact";

export async function POST(request: NextRequest) {
  try {
    // Authentication — A5: `requireAuth()` (Shopify 専用) から `resolveIdentity()` に替えて LINE
    // ログインの行動も記録する。`userKey` は Shopify = 数値 ID / LINE = "line:<id>"
    // で名前空間が分かれており、どちらも `users/{userKey}/behaviorLog` に落ちる
    // (favorites・comments と同じ規則なのでデータ移行は不要)。
    const auth = await resolveIdentity();

    // CDP 統合 Stage 1 / 欠陥 D2: 未認証を **ここで捨てない**。
    //   これまでは未ログインを 1 行目で弾いていたので、「初めて来た人が何を見たか」
    //   が構造的に存在しなかった。開くのは L0 への道だけで、Firestore の
    //   behaviorLog（棚のキーが会員 ID）は従来どおり会員のときしか書かない。
    //   通すかどうかの最終判断は `resolveBehaviorSubject` が持つ（同意 cookie を
    //   サーバ側でもう一度見る fail-closed の二重ゲート）。
    const limited = await enforceRateLimit(
      request,
      limiters.authedUser,
      auth.authenticated ? auth.userKey : "anon",
    );
    if (limited) return limited;

    const parsed = await parseJsonBody(request, BehaviorBodySchema);
    if (!parsed.ok) {
      /* 受け口と送り手がずれても、これまでは**ブラウザの console にしか出ず**
         サーバ側は何も残らなかった。だから `durationSeconds` が弾かれ続けている
         ことに誰も気づけず、読了イベントが丸ごと欠けたまま何か月も走った
         (監査 P1-3)。次に項目が増えたときは、ここが本番ログに出る。 */
      console.warn("[POST /api/user/behavior] rejected payload (schema drift?)");
      return parsed.response;
    }

    /* L0（CDP の出来事の置き場）へ。会員も匿名もここを通る。
       同じ出来事を 1 回だけ数えられるよう、時刻は **ここで 1 度だけ**決める。 */
    const occurredAt = new Date().toISOString();
    const subject = resolveBehaviorSubject(
      auth,
      parsed.data.anonymousId,
      (await cookies()).get(COOKIE_NAME.cookieConsent)?.value ?? null,
    );
    if (subject.kind !== null) {
      await sendToEventsGateway([
        toBehaviorGatewayEvent(subject, parsed.data.action, parsed.data.metadata ?? {}, occurredAt),
      ]);
    }

    if (!auth.authenticated) {
      /* Firestore の behaviorLog は棚のキーが会員 ID なので、匿名では書けない。
         **書かなかった理由を返す**（従来の "not_authenticated" 一択から、
         同意が無かったのか ID が無かったのかを言い分けるようにした）。
         応答は 200 のまま — 未ログインでクライアント側のエラー処理を走らせない。 */
      return NextResponse.json({
        skipped: true,
        reason: subject.kind === null ? subject.reason : "not_authenticated",
        l0: subject.kind !== null,
      });
    }

    const result = await addBehaviorLog(
      auth.userKey,
      parsed.data.action,
      "web", // always web from this route
      parsed.data.metadata ?? {}
    );

    return NextResponse.json(result);
  } catch (err) {
    /* クライアントには 200 を返し続ける (行動記録の失敗で画面を壊さない) が、
       返し方が同じである以上、記録が落ちていることは**こちら側でしか気づけない**。
       アラートの鳴る側に載せる。応答は変えない。 */
    logger.error("api.user-behavior.record-failed", err, {
      route: "POST /api/user/behavior",
    });
    return NextResponse.json({ skipped: true, reason: "internal_error" });
  }
}

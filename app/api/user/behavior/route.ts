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
import { BehaviorBodySchema } from "@/lib/validation/behavior-schema";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { addBehaviorLog } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  try {
    // Authentication — silently skip if not logged in (behavior tracking is best-effort).
    // A5: `requireAuth()` (Shopify 専用) から `resolveIdentity()` に替えて LINE
    // ログインの行動も記録する。`userKey` は Shopify = 数値 ID / LINE = "line:<id>"
    // で名前空間が分かれており、どちらも `users/{userKey}/behaviorLog` に落ちる
    // (favorites・comments と同じ規則なのでデータ移行は不要)。
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      // Return 200 to avoid client-side error handling for non-logged-in users
      return NextResponse.json({ skipped: true, reason: "not_authenticated" });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
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

    const result = await addBehaviorLog(
      auth.userKey,
      parsed.data.action,
      "web", // always web from this route
      parsed.data.metadata ?? {}
    );

    return NextResponse.json(result);
  } catch (err) {
    // Non-critical: log but return 200 to avoid disrupting client UX
    console.error("[POST /api/user/behavior]", err);
    return NextResponse.json({ skipped: true, reason: "internal_error" });
  }
}

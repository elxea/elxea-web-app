import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { linkLineUser, unlinkLineUser } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

// LINE user IDs are opaque strings starting with "U" followed by 32 hex chars
// (total length 33). Accept a reasonable length range to be future-proof.
const LineLinkSchema = z.object({
  lineUserId: z
    .string()
    .min(10)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid lineUserId format"),
});

/**
 * POST /api/user/line-link
 * Links a LINE user ID to the authenticated Shopify customer's Firestore document.
 * Called from the LIFF page after LINE authentication.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, LineLinkSchema);
    if (!parsed.ok) return parsed.response;

    const result = await linkLineUser(auth.customerId, parsed.data.lineUserId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/line-link]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/line-link
 *
 * POST の対称操作 (連携解除)。同じリソース・同じ認証機構で、ログイン済みご本人の
 * 連携情報だけを外す。解除後は同じ経路で再連携できる (`unlinkLineUser` が
 * `lineUserId` フィールドごと消すため、再連携は「未連携からの新規連携」を通る)。
 *
 * 設計上の要点:
 *   - 解除対象は **サーバ認証済みセッション (requireAuth) で確定した customerId** の
 *     連携のみ。ブラウザからの customerId / lineUserId は一切受け取らない
 *     (body を読まない = 他人の連携を指定して外す経路が存在しない)。
 *   - 未ログインは 401 で、Firestore には触れない。
 *   - 冪等: 連携が無ければ 200 + `action: "not_linked"`。二重解除・再送を
 *     エラーにしない (解除は「連携が無い状態にする」操作)。
 *   - 解除 != データ削除。カルテ・注文履歴は消さない (削除は GDPR
 *     `customers/redact` webhook の担当)。
 *
 * 範囲の限界 (既知・別対応):
 *   LIFF 経路 (`/api/user/line-link-liff`) と LINE 純正 Account Link
 *   (`/{locale}/link`) が作る連携は cx-agent 側 (`customer_linkages`) に持たれる。
 *   cx-agent には現時点で解除用 HTTP エンドポイントが無い (`/api/erase` は
 *   連携解除ではなくデータ削除) ため、本 DELETE が外すのはこの route の POST が
 *   書いた Firestore 側の連携情報。cx-agent 側の解除は同 API 追加が前提。
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const result = await unlinkLineUser(auth.customerId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/line-link]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

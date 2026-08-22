import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { linkLineUser, unlinkLineUser } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { requestCxUnlink } from "@/lib/line/unlink";

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
 * ## 解除の実体は 2 か所にある — 順序が結果を決める
 *
 * LINE Bot が実際に読む連携台帳は cx-agent 側 (`customer_linkages`) にあり、
 * Firestore の `lineUserId` はその写しに過ぎない。以前の実装は Firestore しか
 * 消さずに 200 を返していたため、**解除したはずの人に LINE の配信が届き続けた**
 * (route 自身が「cx-agent には解除用 HTTP エンドポイントが無い」と自認していた)。
 *
 * 現在は cx-agent に `POST /api/identity/unlink` (既存 `clearCustomerLinkage` への
 * HTTP 入口) があるので、**必ず cx-agent を先に呼び、成功したときだけ Firestore を
 * 消す**。順序が逆だと、cx が失敗したときに写しだけ消えて「画面は未連携・実際は
 * 連携中」というより悪い割れ方になる。
 *
 * ## 成功偽装をしない (本 route の主旨)
 *
 * cx-agent が失敗したら **Firestore に触れず非 2xx を返す**。
 *   - 502 … cx-agent に届かない / 上流エラー
 *   - 503 … このデプロイに連携の設定が無い (`SYNC_API_SECRET` 未設定)
 * 呼び出し側 (マイページ) は非 2xx を「解除できませんでした」として出す。
 * ここで 200 を返すのは、今まさに直している嘘そのもの。
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    /* 1) 連携の正本 (cx-agent) を先に外す。ここが失敗したら Firestore は触らない。 */
    const cx = await requestCxUnlink(auth.customerId);
    if (!cx.ok) {
      const status = cx.reason === "not_configured" ? 503 : 502;
      return NextResponse.json(
        { error: "Failed to unlink LINE account" },
        { status },
      );
    }

    /* 2) 写し (Firestore) を消す。冪等なので cx 側が 0 件でも安全に通る。 */
    const result = await unlinkLineUser(auth.customerId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/line-link]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

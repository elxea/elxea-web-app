import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { verifyLiffIdToken } from "@/lib/line/verify-liff-token";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";

/**
 * POST /api/user/line-link-liff
 *
 * 案A（LIFF 連携）第1弾のサーバ側プロキシ。LIFF ページ（LINE アプリ内ブラウザ）から
 * 同一オリジンで呼ばれ、cx-agent の customer_linkages に「Messaging userId ↔ Shopify 顧客」の
 * 連携行を冪等に作らせる。
 *
 * なぜこの構成か（なりすまし不能性・詳細は verify-liff-token.ts）:
 *   1. Messaging userId は body の id_token（LINE 署名済み JWT）を **サーバで LINE verify API に
 *      かけて** 取り出した `sub`。ブラウザ自己申告の userId は一切信じない → 偽装不能。
 *   2. shopify_customer_id は **サーバ認証済み Shopify セッション**（requireAuth）由来。
 *      ブラウザが body で送る customer_id は使わない → 他人の顧客IDでの連携を塞ぐ。
 *   3. cx-agent へは SYNC_API_SECRET（X-API-Key）を **サーバ環境変数**から付ける。
 *      秘密はブラウザに出さない。
 *
 * 応答:
 *   200 { success: true }                  … 連携完了
 *   401 { error, needsShopifyLogin: true } … Shopify 未ログイン（LIFF 側でログイン導線を出す）
 *   401 { error: "line_verification_failed" } … id_token 検証失敗（偽装 / 期限切れ / 設定漏れ）
 *   502 { error }                          … cx-agent 到達失敗
 */

const LinkLiffSchema = z.object({
  // liff.getIDToken() の JWT。長さは緩めに許容（形式検証は LINE verify に委ねる）。
  idToken: z.string().min(20).max(4000),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Shopify セッション認証（サーバ側で customer_id を確定。ブラウザ自己申告は使わない）
    const auth = await requireAuth();
    if (!auth.authenticated) {
      // LIFF アプリ内ブラウザでは Shopify 未ログインが通常。連携前にログインが要る旨を返す。
      return NextResponse.json(
        { error: "shopify_login_required", needsShopifyLogin: true },
        { status: 401 },
      );
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, LinkLiffSchema);
    if (!parsed.ok) return parsed.response;

    // 2. LIFF id_token をサーバで検証 → Messaging userId（sub）を取り出す
    const channelId = process.env.LINE_LIFF_CHANNEL_ID;
    const verified = await verifyLiffIdToken(parsed.data.idToken, channelId);
    if (!verified.ok) {
      console.warn("[line-link-liff] id_token verification failed:", verified.reason);
      return NextResponse.json(
        { error: "line_verification_failed" },
        { status: 401 },
      );
    }

    // 3. cx-agent の customer_linkages upsert を server-to-server で呼ぶ（SYNC_API_SECRET）
    const secret = process.env.SYNC_API_SECRET;
    if (!secret) {
      // fail-closed: 秘密が無ければ連携を成立させない（cx-agent は 401 を返すため無駄打ちも避ける）
      console.error("[line-link-liff] SYNC_API_SECRET not set; cannot link.");
      return NextResponse.json({ error: "linking_unavailable" }, { status: 503 });
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${CX_AGENT_BASE_URL}/api/identity/link-liff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": secret,
        },
        body: JSON.stringify({
          line_messaging_user_id: verified.messagingUserId,
          shopify_customer_id: auth.customerId,
          shopify_email: verified.email,
        }),
      });
    } catch (err) {
      console.error("[line-link-liff] cx-agent unreachable:", err);
      return NextResponse.json({ error: "linking_upstream_unreachable" }, { status: 502 });
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(`[line-link-liff] cx-agent returned ${upstream.status}: ${detail}`);
      return NextResponse.json({ error: "linking_failed" }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/user/line-link-liff]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

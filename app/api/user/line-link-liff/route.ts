import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { applyLinkageEstablished } from "@/lib/auth/identity-link";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { verifyLineIdToken } from "@/lib/line/verify-liff-token";
import { resolveLinkChannelId } from "@/lib/line/link-flow";
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

    /* 2. LIFF id_token をサーバで検証 → Messaging userId（sub）を取り出す
     *
     * ここだけ `expectedNonce` を渡さない。LIFF のトークンは LINE アプリが発行し、
     * こちら側は認可 URL を組み立てていないので nonce を仕込む余地が無い（仕込めない値を
     * 「必須」にすると LIFF 連携が全滅する）。この経路のリプレイ束縛は
     * requireAuth（サーバ確定の Shopify セッション）+ サーバ側 verify が担う。
     * 認可 URL を自分で作る Web 発の経路（/api/user/line-link/callback）では必ず渡す。 */
    /* Web 発の経路と同じ読み取り（trim 付き）。ここで読んだ値は id_token の `aud` と
     * 等値比較されるので、末尾改行が 1 文字混じるだけで検証が必ず外れる。 */
    const channelId = resolveLinkChannelId();
    const verified = await verifyLineIdToken(parsed.data.idToken, channelId);
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

    /* 4. 台帳に行が立った。**同じ流れの中で**データも合体させる。
     *
     * ここが無かったせいで、LIFF から連携したお客さまは連携した瞬間に
     * お気に入りが消えたように見えていた（PR #100 の B3 と同じ根）。台帳の行が
     * 立つと `resolveIdentity` は LINE セッションを顧客の棚に解決するのに、
     * `line:` の棚に貯めた中身は運ばれないままなので、**どちらのログイン手段
     * からも読めない**場所に取り残される。
     *
     * **台帳を引き直さない**（M-2）。この経路は直前に自分で cx-agent へ書き、
     * その 200 を受け取っている — 書いた側より確かな情報源は無い。以前はここで
     * キャッシュを捨てて 3 秒タイムアウト付きの HTTP を投げ直しており、その
     * 一発が外れると「連携しました」と表示したまま合体だけが起きなかった。
     *
     * `applyLinkageEstablished` は throw しない。合体が転んでも連携自体は成立して
     * いるので 200 を返す — ここで 502 に倒すと、実際には連携できている人に
     * 失敗を告げることになる。 */
    await applyLinkageEstablished({
      lineUserId: verified.messagingUserId,
      shopifyCustomerId: auth.customerId,
      source: "line-link-liff",
    });

    // cx-agent の応答から「連携先に注文/定期便があるか」を受け取り、完了画面の過大約束回避に渡す（CX S2）。
    //   取得できない/未知は false（＝「ご注文・定期便を確認できます」と約束しない安全側コピーにフォールバック）。
    let hasPurchaseActivity = false;
    try {
      const data = (await upstream.json()) as { has_purchase_activity?: boolean };
      hasPurchaseActivity = data.has_purchase_activity === true;
    } catch {
      // 応答が JSON でない/欠落 → 過大約束しない安全側（false）のまま。
    }

    return NextResponse.json({ success: true, hasPurchaseActivity });
  } catch (err) {
    console.error("[POST /api/user/line-link-liff]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

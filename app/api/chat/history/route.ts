/**
 * GET /api/chat/history — cx-agent 履歴取得への proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat/history。
 * X-API-Key を付けることで cx-agent 側の ownsIdentity 判定が通り、ログイン済み
 * ユーザーのクロスチャネル (LINE / 別 session) 履歴が返る。
 *
 * [SEC-B] ブラウザ query の shopify_customer_id は透過しない。verify 済み値のみ付与。
 *
 * [SEC-C] **`session_id` も同じ扱いにする**。以前はブラウザのクエリをそのまま
 * 引き継いでいたので、他人の会話 ID を並べるだけでその会話が読めた。会話 ID は
 * `resolveChatSession()` が cookie の署名を検証して決めた値だけを使う。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth } from "@/lib/chat/proxy";
import { resolveChatSession, writeChatSessionCookie } from "@/lib/chat/session-server";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

/** ブラウザから引き継ぐ安全なクエリパラメータ (session_id / customer_id は含めない) */
const PASSTHROUGH_PARAMS = ["channel", "keyword", "from", "to", "limit", "offset"];

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams;

  const session = await resolveChatSession();
  const { headers, verifiedCustomerId, verifiedLineUserId, trusted } = await buildProxyAuth();

  /* 発行したてなら、この応答で cookie を渡す (成功・失敗のどちらの経路でも)。 */
  const finish = (response: NextResponse): NextResponse => {
    if (session.minted) writeChatSessionCookie(response, session);
    return response;
  };

  const qs = new URLSearchParams();
  for (const key of PASSTHROUGH_PARAMS) {
    const value = src.get(key);
    if (value) qs.set(key, value);
  }
  qs.set("session_id", session.sessionId);
  /* 署名は別フィールド。`session_id` は cx-agent の DB の主キーなので生のまま。 */
  if (session.proof) {
    qs.set("session_proof", session.proof);
  }
  // verify 済みのときだけ customer_id を付与 (ブラウザ自己申告は使わない)
  if (trusted && verifiedCustomerId) {
    qs.set("shopify_customer_id", verifiedCustomerId);
  }
  // LINE ログインで入っている人の identity (理由は /api/chat の同じ箇所を参照)
  if (trusted && verifiedLineUserId) {
    qs.set("line_user_id", verifiedLineUserId);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/chat/history?${qs.toString()}`, {
      method: "GET",
      headers,
    });
  } catch (err) {
    logger.error("api.chat-history.upstream-unreachable", err, {
      route: "/api/chat/history",
      status: 502,
    });
    return finish(NextResponse.json({ error: "Upstream unavailable" }, { status: 502 }));
  }

  const text = await upstream.text().catch(() => "");
  return finish(
    new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    }),
  );
}

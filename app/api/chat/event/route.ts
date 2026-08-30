/**
 * POST /api/chat/event — cx-agent 行動イベントへの proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat/event。
 * X-API-Key + verify 済み customer_id を付けることで、ログイン済みユーザーの行動イベントが
 * 匿名 session ではなく customer identity に紐付く。
 *
 * [SEC-B] ブラウザ body の shopify_customer_id は透過しない。verify 済み値のみ付与。
 *
 * [SEC-C] **`session_id` も同じ扱いにする**。ここだけブラウザ申告のままにすると
 * 「他人の会話の行動ログに書き込める」経路が 1 本残る。/api/chat と /api/chat/history
 * と同じく `resolveChatSession()` の値だけを転送する（装置を作って移行を半分で
 * 止めない = 憲章 R8）。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth } from "@/lib/chat/proxy";
import { resolveChatSession, writeChatSessionCookie } from "@/lib/chat/session-server";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { action?: unknown; metadata?: unknown };
  try {
    body = await request.json();
  } catch {
    // expected-failure: ブラウザが送る body が壊れているだけで、400 を返すのが答え。
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, metadata } = body ?? {};

  const session = await resolveChatSession();
  const { headers, verifiedCustomerId, trusted } = await buildProxyAuth();

  const finish = (response: NextResponse): NextResponse => {
    if (session.minted) writeChatSessionCookie(response, session);
    return response;
  };

  const forwardBody: Record<string, unknown> = {
    session_id: session.sessionId,
    action,
  };
  if (session.proof) forwardBody.session_proof = session.proof;
  if (metadata !== undefined) forwardBody.metadata = metadata;
  if (trusted && verifiedCustomerId) {
    forwardBody.shopify_customer_id = verifiedCustomerId;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/chat/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(forwardBody),
    });
  } catch (err) {
    logger.error("api.chat-event.upstream-unreachable", err, {
      route: "/api/chat/event",
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

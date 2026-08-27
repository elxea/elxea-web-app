/**
 * POST /api/chat — cx-agent chat への SSE proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat。
 * サーバ側で verify 済み customer_id を付与し X-API-Key で信頼させる。
 * cx-agent の SSE ストリームをそのまま中継する (既存 transport の挙動を維持)。
 *
 * [SEC-B] ブラウザ body の shopify_customer_id は透過しない。forward body は
 * message / session_id とサーバ導出 verifiedCustomerId のみから再構築する。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth, clientIpForwardHeaders } from "@/lib/chat/proxy";
import { logger } from "@/lib/log";

/* cookies() でセッションを参照し SSE を中継するため動的レンダリング固定。
   ランタイム指定は書かない — Route Handler の既定が nodejs なので
   `export const runtime = "nodejs"` は既定の再宣言でしかなく、
   「ここだけ特別な指定がある」という誤読を生む。 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { message?: unknown; session_id?: unknown };
  try {
    body = await request.json();
  } catch {
    // expected-failure: ブラウザが送る body が壊れているだけで、400 を返すのが答え。
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, session_id } = body ?? {};

  const { headers, verifiedCustomerId, trusted } = await buildProxyAuth();
  const ipHeaders = clientIpForwardHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trusted,
  );

  // forward body は信頼できる値だけで再構築 (ブラウザ自己申告の customer_id は捨てる)
  const forwardBody: Record<string, unknown> = { message, session_id };
  if (trusted && verifiedCustomerId) {
    forwardBody.shopify_customer_id = verifiedCustomerId;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers, ...ipHeaders },
      body: JSON.stringify(forwardBody),
    });
  } catch (err) {
    logger.error("api.chat.upstream-unreachable", err, {
      route: "/api/chat",
      status: 502,
    });
    return NextResponse.json({ error: "Upstream unavailable" }, { status: 502 });
  }

  // 非 2xx (SSE でない) はそのまま JSON/text として返す
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new NextResponse(text || JSON.stringify({ error: "Chat upstream error" }), {
      status: upstream.status || 502,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  // SSE ストリームを素通し中継
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

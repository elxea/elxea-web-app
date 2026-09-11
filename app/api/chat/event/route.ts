/**
 * POST /api/chat/event — cx-agent 行動イベントへの proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat/event。
 * X-API-Key + verify 済み customer_id を付けることで、ログイン済みユーザーの行動イベントが
 * 匿名 session ではなく customer identity に紐付く。
 *
 * [SEC-B] ブラウザ body の shopify_customer_id は透過しない。verify 済み値のみ付与。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth } from "@/lib/chat/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { session_id?: unknown; action?: unknown; metadata?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { session_id, action, metadata } = body ?? {};

  const { headers, verifiedCustomerId, trusted } = await buildProxyAuth();

  const forwardBody: Record<string, unknown> = { session_id, action };
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
    console.error("[chat/event proxy] upstream fetch failed:", err);
    return NextResponse.json({ error: "Upstream unavailable" }, { status: 502 });
  }

  const text = await upstream.text().catch(() => "");
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

/**
 * GET /api/chat/history — cx-agent 履歴取得への proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat/history。
 * X-API-Key を付けることで cx-agent 側の ownsIdentity 判定が通り、ログイン済み
 * ユーザーのクロスチャネル (LINE / 別 session) 履歴が返る。
 *
 * [SEC-B] ブラウザ query の shopify_customer_id は透過しない。verify 済み値のみ付与。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth } from "@/lib/chat/proxy";

export const dynamic = "force-dynamic";

/** ブラウザから引き継ぐ安全なクエリパラメータ (customer_id は含めない) */
const PASSTHROUGH_PARAMS = ["session_id", "channel", "keyword", "from", "to", "limit", "offset"];

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams;

  const { headers, verifiedCustomerId, trusted } = await buildProxyAuth();

  const qs = new URLSearchParams();
  for (const key of PASSTHROUGH_PARAMS) {
    const value = src.get(key);
    if (value) qs.set(key, value);
  }
  // verify 済みのときだけ customer_id を付与 (ブラウザ自己申告は使わない)
  if (trusted && verifiedCustomerId) {
    qs.set("shopify_customer_id", verifiedCustomerId);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/chat/history?${qs.toString()}`, {
      method: "GET",
      headers,
    });
  } catch (err) {
    console.error("[chat/history proxy] upstream fetch failed:", err);
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

/**
 * POST /api/chat/image — cx-agent 画像チャットへの proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat/image (multipart/form-data)。
 * X-API-Key + verify 済み customer_id を付けることで、ログイン済みユーザーの画像会話が
 * customer identity に紐付く。
 *
 * [SEC-B] ブラウザ form の shopify_customer_id は透過しない。forward form は
 * image / session_id / message とサーバ導出 verifiedCustomerId のみから再構築する。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth, clientIpForwardHeaders } from "@/lib/chat/proxy";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // expected-failure: multipart が壊れて届いただけで、400 を返すのが答え。
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const image = form.get("image");
  const sessionId = form.get("session_id");
  const message = form.get("message");

  const { headers, verifiedCustomerId, trusted } = await buildProxyAuth();
  const ipHeaders = clientIpForwardHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trusted,
  );

  // forward form は信頼できる値だけで再構築 (ブラウザ自己申告の customer_id は捨てる)
  const forwardForm = new FormData();
  if (image !== null) forwardForm.set("image", image as Blob);
  if (sessionId !== null) forwardForm.set("session_id", String(sessionId));
  if (message !== null) forwardForm.set("message", String(message));
  if (trusted && verifiedCustomerId) {
    forwardForm.set("shopify_customer_id", verifiedCustomerId);
  }

  let upstream: Response;
  try {
    // Content-Type は付けない (fetch が multipart boundary 付きで自動設定する)
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/chat/image`, {
      method: "POST",
      headers: { ...headers, ...ipHeaders },
      body: forwardForm,
    });
  } catch (err) {
    logger.error("api.chat-image.upstream-unreachable", err, {
      route: "/api/chat/image",
      status: 502,
    });
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

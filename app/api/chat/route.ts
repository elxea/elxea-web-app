/**
 * POST /api/chat — cx-agent chat への SSE proxy (B2: Web proxy 化)
 *
 * ブラウザ → 自サーバ (このルート) → cx-agent /api/chat。
 * サーバ側で verify 済み customer_id を付与し X-API-Key で信頼させる。
 * cx-agent の SSE ストリームをそのまま中継する (既存 transport の挙動を維持)。
 *
 * [SEC-B] ブラウザ body の shopify_customer_id は透過しない。forward body は
 * message とサーバ導出の値のみから再構築する。
 *
 * [SEC-C] **`session_id` も同じ扱いにする**。会話 ID はブラウザの自己申告ではなく
 * `resolveChatSession()` が cookie の署名を検証して決めた値だけを使う。以前は
 * body の `session_id` をそのまま転送していたため、他人の会話 ID を送るだけで
 * その会話ストリームに書き込めた（`lib/chat/session-token.ts` 冒頭）。
 */
import { NextRequest, NextResponse } from "next/server";
import { CX_AGENT_BASE_URL, buildProxyAuth, clientIpForwardHeaders } from "@/lib/chat/proxy";
import { resolveChatSession, writeChatSessionCookie } from "@/lib/chat/session-server";
import { logger } from "@/lib/log";

/* cookies() でセッションを参照し SSE を中継するため動的レンダリング固定。
   ランタイム指定は書かない — Route Handler の既定が nodejs なので
   `export const runtime = "nodejs"` は既定の再宣言でしかなく、
   「ここだけ特別な指定がある」という誤読を生む。 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    // expected-failure: ブラウザが送る body が壊れているだけで、400 を返すのが答え。
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message } = body ?? {};

  /* 会話 ID はサーバが決める。body に `session_id` が入っていても読まない
     (読んだ瞬間に「他人の会話に書き込める」に戻る)。 */
  const session = await resolveChatSession();

  const { headers, verifiedCustomerId, verifiedLineUserId, trusted } = await buildProxyAuth();
  const ipHeaders = clientIpForwardHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    trusted,
  );

  /* 発行したてなら、この応答で cookie を渡す。SSE でもエラーでも同じように
     載せる — 1 経路でも落とすと、その経路を通った人だけ毎回新しい会話になる。 */
  const finish = (response: NextResponse): NextResponse => {
    if (session.minted) writeChatSessionCookie(response, session);
    return response;
  };

  // forward body は信頼できる値だけで再構築 (ブラウザ自己申告の customer_id は捨てる)
  const forwardBody: Record<string, unknown> = {
    message,
    session_id: session.sessionId,
  };
  /* 署名は **別フィールド**で運ぶ。`session_id` は cx-agent の DB の主キーなので
     生の UUID のまま変えない (`lib/chat/session-token.ts`)。 */
  if (session.proof) {
    forwardBody.session_proof = session.proof;
  }
  if (trusted && verifiedCustomerId) {
    forwardBody.shopify_customer_id = verifiedCustomerId;
  }
  /* LINE ログインで入っている人の identity。顧客 ID を持たない人 (未連携の LINE
     ログイン) でも「誰か」は確定しているので、これを渡さないと cx-agent 側は
     匿名扱いにするしかない。customer_id と同じく **サーバ確定値のみ** 転送する。 */
  if (trusted && verifiedLineUserId) {
    forwardBody.line_user_id = verifiedLineUserId;
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
    return finish(NextResponse.json({ error: "Upstream unavailable" }, { status: 502 }));
  }

  // 非 2xx (SSE でない) はそのまま JSON/text として返す
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return finish(
      new NextResponse(text || JSON.stringify({ error: "Chat upstream error" }), {
        status: upstream.status || 502,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        },
      }),
    );
  }

  // SSE ストリームを素通し中継
  return finish(
    new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }),
  );
}

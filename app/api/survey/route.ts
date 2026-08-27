import { NextRequest, NextResponse } from "next/server";
import { env, isProduction } from "@/lib/config";

const CX_AGENT_BASE_URL = (
  env("NEXT_PUBLIC_CHAT_API_URL") ?? "http://localhost:8787/api/chat"
).replace(/\/api\/chat\/?$/, "");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { csat, would_use_again, best_aspects, improvement_suggestion, nps, round } = body;

    // Basic validation
    if (typeof csat !== "number" || csat < 1 || csat > 5) {
      return NextResponse.json({ error: "csat must be 1-5" }, { status: 400 });
    }
    if (!["yes", "not_sure"].includes(would_use_again)) {
      return NextResponse.json({ error: "invalid would_use_again" }, { status: 400 });
    }
    if (!Array.isArray(best_aspects) || best_aspects.length === 0) {
      return NextResponse.json({ error: "best_aspects required" }, { status: 400 });
    }
    if (typeof nps !== "number" || nps < 0 || nps > 10) {
      return NextResponse.json({ error: "nps must be 0-10" }, { status: 400 });
    }

    // C: Forward X-API-Key so the cx-agent survey endpoint (fail-closed) accepts the request.
    // The worker rejects unauthenticated calls; this proxy holds the shared secret.
    const syncApiSecret = env("SYNC_API_SECRET");
    const isProd = isProduction();
    if (isProd && !syncApiSecret) {
      console.error(
        "[survey] SYNC_API_SECRET not set; cx-agent will reject the request (set in production)",
      );
    }
    const surveyHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (syncApiSecret) {
      surveyHeaders["X-API-Key"] = syncApiSecret;
    }

    const res = await fetch(`${CX_AGENT_BASE_URL}/api/survey`, {
      method: "POST",
      headers: surveyHeaders,
      body: JSON.stringify({
        csat,
        would_use_again,
        best_aspects,
        improvement_suggestion: improvement_suggestion || null,
        nps,
        round: round ?? 1,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("Survey proxy error:", res.status, errorBody);
      return NextResponse.json(
        { error: "Failed to submit survey" },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Survey route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

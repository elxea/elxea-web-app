import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { getUserDashboardData } from "@/lib/firebase/server-actions";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

/**
 * GET /api/user/dashboard
 * Returns aggregated user data: favorites, follows, event registrations.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const data = await getUserDashboardData(auth.customerId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/user/dashboard]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

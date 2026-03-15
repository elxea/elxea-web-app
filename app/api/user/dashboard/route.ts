import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { getUserDashboardData } from "@/lib/firebase/server-actions";

/**
 * GET /api/user/dashboard
 * Returns aggregated user data: favorites, follows, event registrations.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const data = await getUserDashboardData(auth.customerId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/user/dashboard]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { linkLineUser } from "@/lib/firebase/server-actions";

/**
 * POST /api/user/line-link
 * Links a LINE user ID to the authenticated Shopify customer's Firestore document.
 * Called from the LIFF page after LINE authentication.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { lineUserId } = body;

    if (!lineUserId || typeof lineUserId !== "string") {
      return NextResponse.json(
        { error: "lineUserId is required" },
        { status: 400 }
      );
    }

    const result = await linkLineUser(auth.customerId, lineUserId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/line-link]", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

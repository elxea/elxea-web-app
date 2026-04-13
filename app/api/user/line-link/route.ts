import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { linkLineUser } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

// LINE user IDs are opaque strings starting with "U" followed by 32 hex chars
// (total length 33). Accept a reasonable length range to be future-proof.
const LineLinkSchema = z.object({
  lineUserId: z
    .string()
    .min(10)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid lineUserId format"),
});

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

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, LineLinkSchema);
    if (!parsed.ok) return parsed.response;

    const result = await linkLineUser(auth.customerId, parsed.data.lineUserId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/line-link]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

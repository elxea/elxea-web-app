/**
 * POST /api/user/behavior
 *
 * Record a behavior event in the user's Firestore behaviorLog subcollection.
 * Called from client components (page views, article reads, product views, favorites).
 *
 * The endpoint is fire-and-forget from the client perspective — a 200 response
 * is returned even if Firestore write fails (non-critical analytics path).
 *
 * Body: { action, channel, metadata }
 *   action:   BehaviorAction — "view_content" | "view_product" | "tap_button" | "search" | ...
 *   channel:  BehaviorChannel — always "web" from this route
 *   metadata: BehaviorEventMetadata — { contentId?, productId?, query?, buttonLabel? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { addBehaviorLog } from "@/lib/firebase/server-actions";
import type { BehaviorAction, BehaviorChannel, BehaviorEventMetadata } from "@/lib/firebase/types";

const VALID_ACTIONS: BehaviorAction[] = [
  "tap_button",
  "view_content",
  "view_product",
  "purchase",
  "line_message",
  "search",
];

export async function POST(request: NextRequest) {
  try {
    // Authentication — silently skip if not logged in (behavior tracking is best-effort)
    const auth = await requireAuth();
    if (!auth.authenticated) {
      // Return 200 to avoid client-side error handling for non-logged-in users
      return NextResponse.json({ skipped: true, reason: "not_authenticated" });
    }

    const body = await request.json();
    const { action, metadata } = body as {
      action: BehaviorAction;
      channel?: BehaviorChannel;
      metadata?: BehaviorEventMetadata;
    };

    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "Invalid or missing action field" },
        { status: 400 },
      );
    }

    const result = await addBehaviorLog(
      auth.customerId,
      action,
      "web", // always web from this route
      metadata ?? {},
    );

    return NextResponse.json(result);
  } catch (err) {
    // Non-critical: log but return 200 to avoid disrupting client UX
    console.error("[POST /api/user/behavior]", err);
    return NextResponse.json({ skipped: true, reason: "internal_error" });
  }
}

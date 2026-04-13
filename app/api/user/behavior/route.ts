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
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { addBehaviorLog } from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

const BehaviorActionSchema = z.enum([
  "tap_button",
  "view_content",
  "view_product",
  "purchase",
  "line_message",
  "search",
]);

// Explicit whitelist. Do NOT use .catchall() — behavior payloads come from
// untrusted client code and unbounded metadata defeats validation. If a new
// field is needed, add it here with an explicit length/type constraint.
const BehaviorMetadataSchema = z
  .object({
    contentId: z.string().max(300).optional(),
    productId: z.string().max(300).optional(),
    query: z.string().max(500).optional(),
    buttonLabel: z.string().max(300).optional(),
    targetUrl: z.string().max(2048).optional(),
    referrer: z.string().max(2048).optional(),
  })
  .strict();

const BehaviorBodySchema = z.object({
  action: BehaviorActionSchema,
  channel: z.enum(["web", "line", "shopify"]).optional(),
  metadata: BehaviorMetadataSchema.optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Authentication — silently skip if not logged in (behavior tracking is best-effort)
    const auth = await requireAuth();
    if (!auth.authenticated) {
      // Return 200 to avoid client-side error handling for non-logged-in users
      return NextResponse.json({ skipped: true, reason: "not_authenticated" });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, BehaviorBodySchema);
    if (!parsed.ok) return parsed.response;

    const result = await addBehaviorLog(
      auth.customerId,
      parsed.data.action,
      "web", // always web from this route
      parsed.data.metadata ?? {}
    );

    return NextResponse.json(result);
  } catch (err) {
    // Non-critical: log but return 200 to avoid disrupting client UX
    console.error("[POST /api/user/behavior]", err);
    return NextResponse.json({ skipped: true, reason: "internal_error" });
  }
}

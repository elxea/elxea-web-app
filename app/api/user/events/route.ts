import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  registerForEvent,
  cancelEventRegistration,
  getEventRegistrations,
  isRegisteredForEvent,
} from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

const SlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/, "Invalid slug format");

// eventDate is either:
//   - a full ISO-8601 datetime string, OR
//   - a short calendar-day token (e.g. "2026-05-01" or "2026/05/01"), OR
//   - null
// Both shapes are explicitly allowed; unknown formats are rejected.
const EventDateSchema = z
  .union([
    z.string().datetime(),
    z
      .string()
      .regex(
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
        "eventDate must be ISO datetime or YYYY-MM-DD date"
      )
      .max(50),
  ])
  .nullish();

const PostEventSchema = z.object({
  eventSlug: SlugSchema,
  eventTitle: z.string().min(1).max(300),
  eventDate: EventDateSchema,
  eventImageUrl: z.string().url().max(2048).nullish(),
});

const DeleteEventSchema = z.object({
  eventSlug: SlugSchema,
});

/**
 * GET /api/user/events
 * Query params: ?check=eventSlug (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const { searchParams } = request.nextUrl;
    const checkSlug = searchParams.get("check");

    if (checkSlug) {
      const registered = await isRegisteredForEvent(auth.customerId, checkSlug);
      return NextResponse.json({ registered });
    }

    const registrations = await getEventRegistrations(auth.customerId);
    return NextResponse.json({ registrations });
  } catch (err) {
    console.error("[GET /api/user/events]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/user/events
 * Body: { eventSlug, eventTitle, eventDate, eventImageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PostEventSchema);
    if (!parsed.ok) return parsed.response;

    const result = await registerForEvent(auth.customerId, {
      eventSlug: parsed.data.eventSlug,
      eventTitle: parsed.data.eventTitle,
      eventDate: parsed.data.eventDate ?? null,
      eventImageUrl: parsed.data.eventImageUrl ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/events]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/events
 * Body: { eventSlug }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DeleteEventSchema);
    if (!parsed.ok) return parsed.response;

    const result = await cancelEventRegistration(
      auth.customerId,
      parsed.data.eventSlug
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/events]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

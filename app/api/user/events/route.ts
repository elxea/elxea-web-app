import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import {
  registerForEvent,
  cancelEventRegistration,
  getEventRegistrations,
  isRegisteredForEvent,
} from "@/lib/firebase/server-actions";
import { logger } from "@/lib/log";
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
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const { searchParams } = request.nextUrl;
    const checkSlug = searchParams.get("check");

    if (checkSlug) {
      const registered = await isRegisteredForEvent(auth.userKey, checkSlug);
      return NextResponse.json({ registered });
    }

    const registrations = await getEventRegistrations(auth.userKey);
    return NextResponse.json({ registrations });
  } catch (err) {
    /* 申込済みが読めなかっただけなのに、画面では「申し込んでいない」と
       区別がつかない。届く側に載せる。 */
    logger.error("api.user-events.list-failed", err, {
      route: "GET /api/user/events",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/user/events
 * Body: { eventSlug, eventTitle, eventDate, eventImageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PostEventSchema);
    if (!parsed.ok) return parsed.response;

    const result = await registerForEvent(auth.userKey, {
      eventSlug: parsed.data.eventSlug,
      eventTitle: parsed.data.eventTitle,
      eventDate: parsed.data.eventDate ?? null,
      eventImageUrl: parsed.data.eventImageUrl ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    /* イベント申込が成立していない。当日の人数に直結するので必ず鳴らす。 */
    logger.error("api.user-events.register-failed", err, {
      route: "POST /api/user/events",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/events
 * Body: { eventSlug }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DeleteEventSchema);
    if (!parsed.ok) return parsed.response;

    const result = await cancelEventRegistration(
      auth.userKey,
      parsed.data.eventSlug
    );
    return NextResponse.json(result);
  } catch (err) {
    /* キャンセルが通っていない。申込は残ったままなので、
       当日の人数がずれる前に気づけるようにする。 */
    logger.error("api.user-events.cancel-failed", err, {
      route: "DELETE /api/user/events",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

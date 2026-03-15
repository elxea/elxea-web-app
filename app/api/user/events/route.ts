import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  registerForEvent,
  cancelEventRegistration,
  getEventRegistrations,
  isRegisteredForEvent,
} from "@/lib/firebase/server-actions";

/**
 * GET /api/user/events
 * Query params: ?check=eventSlug (optional)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = request.nextUrl;
  const checkSlug = searchParams.get("check");

  if (checkSlug) {
    const registered = await isRegisteredForEvent(auth.customerId, checkSlug);
    return NextResponse.json({ registered });
  }

  const registrations = await getEventRegistrations(auth.customerId);
  return NextResponse.json({ registrations });
}

/**
 * POST /api/user/events
 * Body: { eventSlug, eventTitle, eventDate, eventImageUrl }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const { eventSlug, eventTitle, eventDate, eventImageUrl } = body;

  if (!eventSlug || !eventTitle) {
    return NextResponse.json(
      { error: "Missing required fields: eventSlug, eventTitle" },
      { status: 400 }
    );
  }

  const result = await registerForEvent(auth.customerId, {
    eventSlug,
    eventTitle,
    eventDate: eventDate ?? null,
    eventImageUrl: eventImageUrl ?? null,
  });

  return NextResponse.json(result);
}

/**
 * DELETE /api/user/events
 * Body: { eventSlug }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const { eventSlug } = body;

  if (!eventSlug) {
    return NextResponse.json(
      { error: "Missing required field: eventSlug" },
      { status: 400 }
    );
  }

  const result = await cancelEventRegistration(auth.customerId, eventSlug);
  return NextResponse.json(result);
}

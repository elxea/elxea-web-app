import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  followFarmer,
  unfollowFarmer,
  getFollows,
  isFollowing,
} from "@/lib/firebase/server-actions";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

const PostFollowSchema = z.object({
  farmerSlug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/, "Invalid slug format"),
  farmerName: z.string().min(1).max(200),
  farmerImageUrl: z.string().url().max(2048).nullish(),
});

const DeleteFollowSchema = z.object({
  farmerSlug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/, "Invalid slug format"),
});

/**
 * GET /api/user/follows
 * Query params: ?check=farmerSlug (optional)
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
      const following = await isFollowing(auth.customerId, checkSlug);
      return NextResponse.json({ following });
    }

    const follows = await getFollows(auth.customerId);
    return NextResponse.json({ follows });
  } catch (err) {
    console.error("[GET /api/user/follows]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/user/follows
 * Body: { farmerSlug, farmerName, farmerImageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PostFollowSchema);
    if (!parsed.ok) return parsed.response;

    const result = await followFarmer(auth.customerId, {
      farmerSlug: parsed.data.farmerSlug,
      farmerName: parsed.data.farmerName,
      farmerImageUrl: parsed.data.farmerImageUrl ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/follows]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/follows
 * Body: { farmerSlug }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DeleteFollowSchema);
    if (!parsed.ok) return parsed.response;

    const result = await unfollowFarmer(auth.customerId, parsed.data.farmerSlug);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/follows]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

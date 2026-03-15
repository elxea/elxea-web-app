import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  followFarmer,
  unfollowFarmer,
  getFollows,
  isFollowing,
} from "@/lib/firebase/server-actions";

/**
 * GET /api/user/follows
 * Query params: ?check=farmerSlug (optional)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = request.nextUrl;
  const checkSlug = searchParams.get("check");

  if (checkSlug) {
    const following = await isFollowing(auth.customerId, checkSlug);
    return NextResponse.json({ following });
  }

  const follows = await getFollows(auth.customerId);
  return NextResponse.json({ follows });
}

/**
 * POST /api/user/follows
 * Body: { farmerSlug, farmerName, farmerImageUrl }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const { farmerSlug, farmerName, farmerImageUrl } = body;

  if (!farmerSlug || !farmerName) {
    return NextResponse.json(
      { error: "Missing required fields: farmerSlug, farmerName" },
      { status: 400 }
    );
  }

  const result = await followFarmer(auth.customerId, {
    farmerSlug,
    farmerName,
    farmerImageUrl: farmerImageUrl ?? null,
  });

  return NextResponse.json(result);
}

/**
 * DELETE /api/user/follows
 * Body: { farmerSlug }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const { farmerSlug } = body;

  if (!farmerSlug) {
    return NextResponse.json(
      { error: "Missing required field: farmerSlug" },
      { status: 400 }
    );
  }

  const result = await unfollowFarmer(auth.customerId, farmerSlug);
  return NextResponse.json(result);
}

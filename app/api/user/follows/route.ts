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
  try {
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
  } catch (err) {
    console.error("[GET /api/user/follows]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
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
  } catch (err) {
    console.error("[POST /api/user/follows]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
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
  } catch (err) {
    console.error("[DELETE /api/user/follows]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

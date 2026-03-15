import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  addFavorite,
  removeFavorite,
  getFavorites,
  isFavorited,
} from "@/lib/firebase/server-actions";
import type { FavoriteType } from "@/lib/firebase/types";

/**
 * GET /api/user/favorites
 * Query params: ?type=product|article (optional), ?check=targetId&checkType=product|article (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = request.nextUrl;
    const checkTarget = searchParams.get("check");
    const checkType = searchParams.get("checkType") as FavoriteType | null;

    // Check mode: is a specific item favorited?
    if (checkTarget && checkType) {
      const favorited = await isFavorited(auth.customerId, checkType, checkTarget);
      return NextResponse.json({ favorited });
    }

    // List mode: get all favorites
    const type = searchParams.get("type") as FavoriteType | undefined;
    const favorites = await getFavorites(auth.customerId, type || undefined);
    return NextResponse.json({ favorites });
  } catch (err) {
    console.error("[GET /api/user/favorites]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/favorites
 * Body: { type, targetId, title, imageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { type, targetId, title, imageUrl } = body;

    if (!type || !targetId || !title) {
      return NextResponse.json(
        { error: "Missing required fields: type, targetId, title" },
        { status: 400 }
      );
    }

    if (type !== "product" && type !== "article") {
      return NextResponse.json(
        { error: "Invalid type. Must be 'product' or 'article'" },
        { status: 400 }
      );
    }

    const result = await addFavorite(auth.customerId, {
      type,
      targetId,
      title,
      imageUrl: imageUrl ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/favorites]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/favorites
 * Body: { type, targetId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { type, targetId } = body;

    if (!type || !targetId) {
      return NextResponse.json(
        { error: "Missing required fields: type, targetId" },
        { status: 400 }
      );
    }

    const result = await removeFavorite(auth.customerId, type, targetId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/favorites]", err);
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

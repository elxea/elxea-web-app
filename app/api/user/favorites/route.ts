import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import {
  addFavorite,
  removeFavorite,
  getFavorites,
  isFavorited,
} from "@/lib/firebase/server-actions";
import type { FavoriteType } from "@/lib/firebase/types";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

const FavoriteTypeSchema = z.enum(["product", "article"]);

const PostFavoriteSchema = z.object({
  type: FavoriteTypeSchema,
  targetId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  imageUrl: z.string().url().max(2048).nullish(),
});

const DeleteFavoriteSchema = z.object({
  type: FavoriteTypeSchema,
  targetId: z.string().min(1).max(200),
});

/**
 * GET /api/user/favorites
 * Query params: ?type=product|article (optional), ?check=targetId&checkType=product|article (optional)
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
    const checkTarget = searchParams.get("check");
    const checkType = searchParams.get("checkType") as FavoriteType | null;

    // Check mode: is a specific item favorited?
    if (checkTarget && checkType) {
      const favorited = await isFavorited(auth.userKey, checkType, checkTarget);
      return NextResponse.json({ favorited });
    }

    // List mode: get all favorites
    const type = searchParams.get("type") as FavoriteType | undefined;
    const favorites = await getFavorites(auth.userKey, type || undefined);
    return NextResponse.json({ favorites });
  } catch (err) {
    console.error("[GET /api/user/favorites]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/user/favorites
 * Body: { type, targetId, title, imageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PostFavoriteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await addFavorite(auth.userKey, {
      type: parsed.data.type,
      targetId: parsed.data.targetId,
      title: parsed.data.title,
      imageUrl: parsed.data.imageUrl ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/user/favorites]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/favorites
 * Body: { type, targetId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveIdentity();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.userKey);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DeleteFavoriteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await removeFavorite(
      auth.userKey,
      parsed.data.type,
      parsed.data.targetId
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[DELETE /api/user/favorites]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

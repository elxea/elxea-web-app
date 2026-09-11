import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "@/lib/firebase/auth-guard";
import {
  addFavorite,
  removeFavorite,
  getFavorites,
  isFavorited,
} from "@/lib/firebase/server-actions";
import { FAVORITE_KINDS } from "@/lib/account-favorites";
import type { FavoriteType } from "@/lib/firebase/types";
import { parseJsonBody } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";

/**
 * 受け付ける種類は `lib/account-favorites.ts` の `FAVORITE_KINDS` が正本。
 *
 * ここに語をベタ書きすると、画面に種類を足したのに受け口だけ古いままになり
 * 「保存ボタンは出るのに押すと 400」という壊れ方をする。導出にしておけば
 * 正本に 1 語足すだけで受け口が追従する。
 */
const FavoriteTypeSchema = z.enum(FAVORITE_KINDS);

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

/** クエリ文字列の種類を 1 語だけ通す。知らない語・未指定は `null`。 */
function parseKind(value: string | null): FavoriteType | null {
  const parsed = FavoriteTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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
    /* 種類は POST / DELETE と同じ enum で通す。素の文字列を型注釈だけで
       `FavoriteType` に見せかけると、綴り違いがそのまま Firestore のクエリ条件に
       入り「1 件も無い」= 未登録として返ってしまう (未登録と区別がつかない)。 */
    const checkType = parseKind(searchParams.get("checkType"));

    // Check mode: is a specific item favorited?
    if (checkTarget && checkType) {
      const favorited = await isFavorited(auth.userKey, checkType, checkTarget);
      return NextResponse.json({ favorited });
    }

    // List mode: get all favorites
    const type = parseKind(searchParams.get("type"));
    const favorites = await getFavorites(auth.userKey, type ?? undefined);
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

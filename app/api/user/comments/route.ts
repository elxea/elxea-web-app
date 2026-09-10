import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { logger } from "@/lib/log";
import {
  addComment,
  getComments,
  deleteComment,
  getCommentById,
} from "@/lib/firebase/server-actions";
import type { CommentTargetType } from "@/lib/firebase/types";
import { parseJsonBody, formatZodError } from "@/lib/validation/zod-helpers";
import { enforceRateLimit, limiters, getClientIp } from "@/lib/ratelimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TargetTypeSchema = z.enum(["article", "farmer"]);

const PostCommentSchema = z.object({
  targetType: TargetTypeSchema,
  targetId: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
});

const DeleteCommentSchema = z.object({
  commentId: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// GET /api/user/comments
// Query params: targetType (article|farmer) & targetId (required)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Public endpoint — rate limit by client IP.
  const limited = await enforceRateLimit(request, limiters.publicRead, getClientIp(request));
  if (limited) return limited;

  const { searchParams } = request.nextUrl;
  const targetTypeRaw = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");
  const limitRaw = searchParams.get("limit") ?? "50";

  const parsed = z
    .object({
      targetType: TargetTypeSchema,
      targetId: z.string().min(1).max(200),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse({
      targetType: targetTypeRaw,
      targetId,
      limit: limitRaw,
    });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: formatZodError(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const comments = await getComments(
      parsed.data.targetType as CommentTargetType,
      parsed.data.targetId,
      parsed.data.limit
    );
    return NextResponse.json({ comments });
  } catch (err) {
    /* 読めなかったのに画面には「コメントなし」に見える。届く側に載せる。
       載せるのは対象の種類と ID だけで、本文は載せない。 */
    logger.error("api.user-comments.list-failed", err, {
      route: "GET /api/user/comments",
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/user/comments
// Body: { targetType, targetId, body }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, PostCommentSchema);
    if (!parsed.ok) return parsed.response;

    const result = await addComment(auth.customerId, {
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      authorName: auth.customerName,
      body: parsed.data.body,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    /* 投稿が保存されていない。本文・投稿者名は載せない (載せる必要が無い)。 */
    logger.error("api.user-comments.create-failed", err, {
      route: "POST /api/user/comments",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/user/comments
// Body: { commentId }
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
    if (limited) return limited;

    const parsed = await parseJsonBody(request, DeleteCommentSchema);
    if (!parsed.ok) return parsed.response;

    // Explicit BOLA check: fetch the comment and verify authorship BEFORE
    // calling deleteComment. Defense-in-depth on top of the check inside
    // deleteComment itself.
    const comment = await getCommentById(parsed.data.commentId);
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    if (comment.authorId !== auth.customerId) {
      return NextResponse.json(
        { error: "Not authorized to delete this comment" },
        { status: 403 }
      );
    }

    const result = await deleteComment(auth.customerId, parsed.data.commentId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "Not authorized to delete this comment" ? 403 : 404 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    /* 削除を頼まれて消えていない。本人には「失敗」と出るが、
       消し残りが起きたことはこちらが知る必要がある。 */
    logger.error("api.user-comments.delete-failed", err, {
      route: "DELETE /api/user/comments",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

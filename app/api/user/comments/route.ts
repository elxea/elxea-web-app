import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import {
  addComment,
  getComments,
  deleteComment,
} from "@/lib/firebase/server-actions";
import type { CommentTargetType } from "@/lib/firebase/types";

/**
 * GET /api/user/comments
 * Query params: targetType (article|farmer) & targetId (required)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const targetType = searchParams.get("targetType") as CommentTargetType | null;
  const targetId = searchParams.get("targetId");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  if (!targetType || !targetId) {
    return NextResponse.json(
      { error: "Missing required params: targetType, targetId" },
      { status: 400 }
    );
  }

  if (targetType !== "article" && targetType !== "farmer") {
    return NextResponse.json(
      { error: "Invalid targetType. Must be 'article' or 'farmer'" },
      { status: 400 }
    );
  }

  const comments = await getComments(targetType, targetId, limit);
  return NextResponse.json({ comments });
}

/**
 * POST /api/user/comments
 * Body: { targetType, targetId, body }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const reqBody = await request.json();
  const { targetType, targetId, body } = reqBody;

  if (!targetType || !targetId || !body) {
    return NextResponse.json(
      { error: "Missing required fields: targetType, targetId, body" },
      { status: 400 }
    );
  }

  if (targetType !== "article" && targetType !== "farmer") {
    return NextResponse.json(
      { error: "Invalid targetType. Must be 'article' or 'farmer'" },
      { status: 400 }
    );
  }

  const result = await addComment(auth.customerId, {
    targetType,
    targetId,
    authorName: auth.customerName,
    body,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}

/**
 * DELETE /api/user/comments
 * Body: { commentId }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const reqBody = await request.json();
  const { commentId } = reqBody;

  if (!commentId) {
    return NextResponse.json(
      { error: "Missing required field: commentId" },
      { status: 400 }
    );
  }

  const result = await deleteComment(auth.customerId, commentId);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Not authorized to delete this comment" ? 403 : 404 }
    );
  }

  return NextResponse.json(result);
}

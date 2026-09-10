import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/firebase/auth-guard";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { logger } from "@/lib/log";
import { getProfileSource } from "@/lib/profile/source";
import { TeaCategorySchema } from "@/lib/profile/contract";

/**
 * GET /api/profile/self?facet=tea&category=green|red|oolong
 *
 * 自分の傾向。認証必須 (Spec §「実データ契約」A)。1呼び出しにつき1カテゴリー
 * (D7: カテゴリーを跨いだ単一の重心は返さない)。
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
    if (searchParams.get("facet") !== "tea") {
      return NextResponse.json({ error: "facet must be 'tea'" }, { status: 400 });
    }
    const categoryParsed = TeaCategorySchema.safeParse(searchParams.get("category"));
    if (!categoryParsed.success) {
      return NextResponse.json(
        { error: "category is required (green|red|oolong)" },
        { status: 400 },
      );
    }

    const source = await getProfileSource();
    const data = await source.getSelf({
      facet: "tea",
      category: categoryParsed.data,
      userKey: auth.customerId,
    });

    // 自分の傾向は常に private (本人専用)。
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store", "X-Profile-Source": data.source },
    });
  } catch (err) {
    logger.error("api.profile-self.failed", err, {
      route: "GET /api/profile/self",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

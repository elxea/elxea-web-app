import { NextRequest, NextResponse } from "next/server";

import { resolveIdentity } from "@/lib/firebase/auth-guard";
import { enforceRateLimit, limiters, getClientIp } from "@/lib/ratelimit";
import { logger } from "@/lib/log";
import { env } from "@/lib/config";
import { getProfileSource } from "@/lib/profile/source";
import { ProfileFacetSchema, TeaCategorySchema } from "@/lib/profile/contract";
import { clampBboxToMinSize } from "@/lib/profile/words";
import { PROFILE_MIN_BBOX_SIZE } from "@/lib/profile/thresholds";
import { resolveProfileCacheControl } from "@/lib/profile/cache-policy";

/**
 * GET /api/profile/words?facet=&category=&bbox=x0,y0,x1,y1&z=
 *
 * 言葉の三層。`bbox` で見えている範囲だけを返す。`z` は細かさの段で、どの層まで
 * 分解して返すかを決める (粗い段は一般語だけ / 段が上がるほど共通語・個人語へ
 * 分解される。`lib/profile/words.ts#wordLayerDepth`)。
 *
 * `personal` は認証必須 (判断点 D6b の推奨どおり — 個人の一文は再識別リスクが
 * 最も高いデータ種のため)。未ログインでも 400 にはせず `personal` を空配列に
 * するだけ (欠損時の振る舞いと同じ経路)。実際には引用許可の仕組みが未実装
 * なので、認証の有無によらず現状は常に空配列になる (Spec §「実データ契約」C)。
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, limiters.publicRead, getClientIp(request));
    if (limited) return limited;

    const { searchParams } = request.nextUrl;
    const facetParsed = ProfileFacetSchema.safeParse(searchParams.get("facet"));
    if (!facetParsed.success) {
      return NextResponse.json({ error: "facet must be tea|reading|event" }, { status: 400 });
    }
    const facet = facetParsed.data;

    let category: "green" | "red" | "oolong" | undefined;
    if (facet === "tea") {
      const categoryParsed = TeaCategorySchema.safeParse(searchParams.get("category"));
      if (!categoryParsed.success) {
        return NextResponse.json(
          { error: "category is required for facet=tea (green|red|oolong)" },
          { status: 400 },
        );
      }
      category = categoryParsed.data;
    }

    const bboxParam = (searchParams.get("bbox") ?? "").split(",").map(Number);
    if (bboxParam.length !== 4 || bboxParam.some((n) => !Number.isFinite(n))) {
      return NextResponse.json({ error: "bbox must be 'x0,y0,x1,y1'" }, { status: 400 });
    }
    const bbox = clampBboxToMinSize(
      bboxParam as [number, number, number, number],
      PROFILE_MIN_BBOX_SIZE,
    );

    const zRaw = Number(searchParams.get("z") ?? "0");
    const z = Number.isFinite(zRaw) ? zRaw : 0;

    const identity = await resolveIdentity();
    const userKey = identity.authenticated ? identity.userKey : null;

    const source = await getProfileSource();
    const data = await source.getWords({ facet, category, bbox, z, userKey });

    const cacheControl = resolveProfileCacheControl(data.source, env("VERCEL_ENV"));

    return NextResponse.json(data, {
      headers: { "Cache-Control": cacheControl, "X-Profile-Source": data.source },
    });
  } catch (err) {
    logger.error("api.profile-words.failed", err, {
      route: "GET /api/profile/words",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

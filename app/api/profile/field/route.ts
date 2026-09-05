import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit, limiters, getClientIp } from "@/lib/ratelimit";
import { logger } from "@/lib/log";
import { env } from "@/lib/config";
import { getProfileSource } from "@/lib/profile/source";
import { ProfileFacetSchema, TeaCategorySchema } from "@/lib/profile/contract";
import { resolveProfileCacheControl } from "@/lib/profile/cache-policy";

/**
 * GET /api/profile/field?facet=tea|reading|event&category=&z=
 *
 * みんなの分布。個人の行を一切返さない。認証不要 (集計値のため)。
 *
 * `Cache-Control` は源で出し分ける — `source:"live"` かつ本番のときだけ
 * `public, s-maxage`。それ以外は常に `private, no-store` (Spec §「実データ契約」B)。
 * `Vary` は使わない (`source` はサーバー側の決定値であり、リクエストヘッダの
 * 差異ではないため CDN 側では効かない)。
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

    const zRaw = Number(searchParams.get("z") ?? "0");
    const z = Number.isFinite(zRaw) ? zRaw : 0;

    const source = await getProfileSource();
    const data = await source.getField({ facet, category, z });

    const cacheControl = resolveProfileCacheControl(data.source, env("VERCEL_ENV"));

    return NextResponse.json(data, {
      headers: { "Cache-Control": cacheControl, "X-Profile-Source": data.source },
    });
  } catch (err) {
    logger.error("api.profile-field.failed", err, {
      route: "GET /api/profile/field",
      status: 500,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

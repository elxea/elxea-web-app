import { NextResponse } from "next/server";

import { BUILD_HEADER, buildShaShort, getPublicBuildInfo } from "@/lib/build-info";

/**
 * `GET /api/version` — 認証なしで「いま何が配信されているか」だけを返す極小の面。
 *
 * 設計の要点:
 *
 *  1. **サイトパスワード保護を一切緩めない。** middleware の matcher は元から `/api` を
 *     除外している (`"/((?!studio|api|password|_next|.*\\..*).*)"`)。実測でも
 *     `/api/health/line` は 200、サイト本体は 307 → `/password` (2026-09-11)。
 *     この経路のために middleware を触る必要は無く、実際に触っていない。
 *
 *  2. **中身を返さない。** 返すのは状態 (SHA / 短縮 SHA / 環境) だけ。ページの内容・
 *     データ・環境変数は含めない。漏れても分かるのは「どのコミットが本番か」だけで、
 *     リポジトリは public なのでそれ自体は新たな露出にならない。
 *
 *  3. **返す値は allowlist。** キー集合は `__tests__/api-version.test.ts` が固定する。
 *     将来うっかり別の値を混ぜるとテストが落ちる。
 *
 *  4. **キャッシュしない。** 古い応答を CDN が返すと配信中の実体を見誤る。鮮度が
 *     要件そのものなので `no-store`。本番の前段には Cloudflare が居るため、ここを
 *     緩めると「キャッシュされた昔の SHA」を見て緑にする事故が起きる。
 *
 * 想定用途: `scripts/ops/verify-production.mjs`。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(getPublicBuildInfo(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      // 公開はするが公開面として宣伝はしない。
      "X-Robots-Tag": "noindex, nofollow",
      [BUILD_HEADER]: buildShaShort(),
    },
  });
}

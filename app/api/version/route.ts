import { NextResponse } from "next/server";
import { getPublicBuildInfo, BUILD_HEADER, BUILD_SHA_SHORT } from "@/lib/build-info";

/**
 * `GET /api/version` — 認証なしで「いま何が配信されているか」だけを返す極小の面。
 *
 * 設計の要点:
 *  1. **サイトパスワードを使わない**。middleware の matcher は元から `/api` を除外して
 *     いる (`"/((?!studio|api|password|_next|.*\\..*).*)"`) ので、この経路のために
 *     パスワード保護を緩める変更は一切していない。サイト本体の保護は不変。
 *  2. **中身を返さない**。返すのは状態 (SHA / ビルド時刻 / 環境 / デプロイ ID) だけで、
 *     ページの内容・データ・環境変数は一切含めない。漏れても被害は「どのコミットが本番か」
 *     が分かるだけ (公開リポジトリの多くが同等の情報を出している水準)。
 *  3. **返す値は allowlist**。`getPublicBuildInfo()` のキー集合はテストで固定してある。
 *     将来うっかり別の値を混ぜるとテストが落ちる。
 *  4. **キャッシュしない**。古い応答を CDN が返すと「配信中の実体」を見誤るため。
 *
 * 想定用途: `scripts/ops/verify-production.mjs` と `.github/workflows/prod-verify.yml`。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const info = getPublicBuildInfo();

  return NextResponse.json(info, {
    status: 200,
    headers: {
      // CDN・ブラウザともに保持させない (状態の鮮度が要件そのもの)。
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      // 検索エンジンに拾わせない (公開はするが、公開面として宣伝はしない)。
      "X-Robots-Tag": "noindex, nofollow",
      // ページ側 (307 含む) と同じヘッダーをここにも付け、突き合わせを 1 本にする。
      [BUILD_HEADER]: BUILD_SHA_SHORT,
    },
  });
}

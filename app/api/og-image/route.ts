import { OG_IMAGE, OG_SLOT_ID } from "@/lib/og-image";
import { logger } from "@/lib/log";
import { R2_PUBLIC_DOMAIN, getSiteAsset } from "@/lib/site-assets";

/**
 * 既定の共有カード画像 (`ogImages()` が指す `/api/og-image`)。
 *
 * 画像枠 `site:social-share:og-image-01` (public/site-slots.manifest.json で宣言) に
 * Asset hub から写真が当たっていれば、その切り抜き (R2・1200x630) を返す。当たっていない・
 * 読めない・R2 以外の URL のときは、今までの静的な画像 (`public/og-image.jpg`) を返す。
 * **どの場合も画像を返す** (og:image を 404 にしない)。
 *
 * 転送ではなく中身を返す: 共有カードを読む各社のクローラーがリダイレクトを追うかに頼らない。
 * 割当の変更は、ほかの画像枠と同じく約 5 分 (manifest の ISR) で反映される。
 */
const CACHE = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

/** R2 の公開ドメインの URL だけを取りに行く (manifest の値で任意の URL を中継しない)。 */
export function r2Only(url: string): string | null {
  return url.startsWith(`https://${R2_PUBLIC_DOMAIN}/`) ? url : null;
}

/** 枠に当たっている写真 (無ければ null)。枠 id は OG_SLOT_ID と同じ (テストで確かめる)。 */
async function slotImageUrl(): Promise<string | null> {
  return r2Only(await getSiteAsset("site:social-share:og-image-01", ""));
}

export { OG_SLOT_ID };

async function imageResponse(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    return new Response(res.body, { headers: { "content-type": type, "cache-control": CACHE } });
  } catch (e) {
    // 取れなければ呼び出し側が静的な画像に落とす (共有カードを 404 にしない)。調べられるように残す。
    logger.error("og-image: 画像を取れなかった", { url, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const fromSlot = await slotImageUrl();
  if (fromSlot) {
    const res = await imageResponse(fromSlot);
    if (res) return res;
  }
  const fallback = await imageResponse(new URL(OG_IMAGE.url, request.url).toString());
  if (fallback) return fallback;
  return Response.redirect(new URL(OG_IMAGE.url, request.url), 307);
}

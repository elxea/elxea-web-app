/**
 * 公開サイトの基準 URL を 1 箇所で正規化して返す。
 *
 * `NEXT_PUBLIC_SITE_URL` は Vercel のダッシュボードで人が貼る値なので、末尾の
 * 改行・空白・スラッシュが混ざる。実際 2026-08 の本番 sitemap は 172 件すべての
 * `<loc>` が `https://elxea.com\n/ja/...` になっていた。改行を含む URL は
 * sitemaps.org のスキーマ上不正なので、クローラから見ると 1 件も使える URL が
 * 無い sitemap だった。
 *
 * env 側の値を直すだけでは同じ貼り付けミスが何度でも再発する (しかも壊れ方は
 * 静かで、サイトは正常に見える)。読む側で毎回落とすほうが確実なので、URL を
 * 使う経路はすべてこの関数を通す。
 *
 * URL に空白が正当に入ることはないので、内部の空白も含めて全部落とす。
 */
const FALLBACK_SITE_URL = "https://elxea.com";

export function siteUrl(): string {
  const cleaned = (process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .replace(/\s+/g, "")
    .replace(/\/+$/, "");
  return cleaned || FALLBACK_SITE_URL;
}

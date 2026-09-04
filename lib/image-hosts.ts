/**
 * next/image で出してよい外部画像ホストの allowlist — **唯一の定義場所**。
 *
 * 読む側:
 * - `next.config.ts` `images.remotePatterns` (宣言として残す。custom loader 下では
 *   Next 自身は参照しないが、「どのホストの画像を出すか」の宣言点)
 * - `lib/image-loader.ts` (全 next/image に効く custom loader。ここに無いホストは
 *   変換せず拒否する)
 * - `lib/image-utils.ts` `sanitizeImageUrl` (Shopify metafield 等、外部データ由来の
 *   URL を描画前に落とす)
 *
 * 依存ゼロで書く (next.config とクライアントバンドルの両方から import されるため
 * `@/lib/config` の env() 等を持ち込まない)。
 */

/**
 * Asset Hub site-slot 画像の R2 公開ドメイン (既定値)。
 * elxea-asset-hub lib/r2.ts R2_PUBLIC_DOMAIN の写し。`lib/site-assets.ts` は
 * env `R2_PUBLIC_DOMAIN` で上書きできるが、allowlist はビルド時固定なので
 * 上書き先も出したいときは本ファイルにも足す。
 */
export const R2_PUBLIC_DOMAIN_DEFAULT = "pub-90a0485599904fee8228ef56bb51c2e6.r2.dev";

export interface ImageRemotePattern {
  protocol: "https";
  /** `*.example.com` の 1 段ワイルドカードを許す (next.config remotePatterns と同じ記法)。 */
  hostname: string;
}

export const IMAGE_REMOTE_PATTERNS: readonly ImageRemotePattern[] = [
  { protocol: "https", hostname: "cdn.shopify.com" },
  { protocol: "https", hostname: "*.shopify.com" },
  { protocol: "https", hostname: "cdn.sanity.io" },
  { protocol: "https", hostname: R2_PUBLIC_DOMAIN_DEFAULT },
];

function hostnameMatches(pattern: string, hostname: string): boolean {
  if (!pattern.startsWith("*.")) return pattern === hostname;
  const suffix = pattern.slice(1); // ".shopify.com"
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

/** `https://<allowlisted host>/...` か。protocol も見る (http は不可)。 */
export function isAllowedImageUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return IMAGE_REMOTE_PATTERNS.some((p) => hostnameMatches(p.hostname, url.hostname));
}

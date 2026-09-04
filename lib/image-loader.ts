import type { ImageLoaderProps } from "next/image";

/**
 * next/image の全画像に効くカスタム loader (`next.config.ts images.loaderFile`)。
 *
 * ## なぜ Vercel の画像変換 (`/_next/image`) を通さないのか
 *
 * 2026-09-05 本番障害: `/_next/image?url=...` が HTTP 402
 * `OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` (Vercel Image Optimization の
 * プラン上限超過) を返し、全 18 商品の写真と R2 の site slot 画像が真っ白になった。
 * Shopify / R2 / Sanity 側のデータは正常で、Vercel の変換段だけが落ちている。
 *
 * 外部 CDN (Shopify / Sanity) は自前でリサイズ API を持ち、R2 の site slot 画像は
 * asset-hub が面別 (`__sp` / `__pc` 等) に焼き済みなので、Vercel に変換させる
 * 利得は元々薄い。ここでホスト別に「CDN 自身のリサイズ URL」を返し、
 * `/_next/image` を一切経由しない。`sizes` / `srcSet` の幅候補は next/image が
 * 従来どおり組み立てる (`width` にその候補幅が来る) ので、レイアウト・LCP
 * (`priority` の preload) は変わらない。
 *
 * ## 分岐仕様
 *
 * | src                                   | 返す URL                                   |
 * |---------------------------------------|--------------------------------------------|
 * | 相対パス / data: / blob: (ローカル静的) | そのまま (`unoptimized` 相当)               |
 * | cdn.shopify.com / *.shopify.com       | `?width=<w>` を付与 (Shopify CDN がリサイズ) |
 * | cdn.sanity.io                         | `?w=<w>` (既存 `h` は比率を保って再計算)      |
 *                                         | + `auto=format` + `q=<quality>`             |
 * | R2 (`*.r2.dev`)                       | そのまま (面別に焼き済み)                    |
 * | それ以外                              | そのまま                                    |
 *
 * Shopify CDN は元画像より大きい幅を指定しても拡大しない (元サイズで返す) ので、
 * next/image が候補に出す w=3840 まで含めて安全。`format` は付けない
 * (Shopify は Accept ヘッダで WebP/AVIF を自動選択する。明示すると
 * 対応しないブラウザで壊れる余地があるため)。
 */

const SHOPIFY_HOST = /(^|\.)shopify\.com$/;
const SANITY_HOST = "cdn.sanity.io";
const R2_HOST = /\.r2\.dev$/;

function isAbsoluteHttp(src: string): boolean {
  return src.startsWith("https://") || src.startsWith("http://");
}

function shopifyUrl(url: URL, width: number): string {
  url.searchParams.set("width", String(Math.round(width)));
  return url.toString();
}

function sanityUrl(url: URL, width: number, quality?: number): string {
  const w = Math.round(width);
  const prevW = Number(url.searchParams.get("w"));
  const prevH = Number(url.searchParams.get("h"));
  // `urlFor(...).width(600).height(400)` のように比率を切っている URL は、
  // 幅だけ差し替えると比率が変わる (Sanity は w/h 両指定で crop)。高さも同じ倍率で
  // 追随させ、呼び出し側が決めた比率を保つ。
  if (prevW > 0 && prevH > 0) {
    url.searchParams.set("h", String(Math.max(1, Math.round((prevH * w) / prevW))));
  }
  url.searchParams.set("w", String(w));
  if (!url.searchParams.has("auto")) url.searchParams.set("auto", "format");
  if (quality && !url.searchParams.has("q")) url.searchParams.set("q", String(quality));
  return url.toString();
}

export default function elxeaImageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (!isAbsoluteHttp(src)) return src;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  const host = url.hostname;
  if (SHOPIFY_HOST.test(host)) return shopifyUrl(url, width);
  if (host === SANITY_HOST) return sanityUrl(url, width, quality);
  if (R2_HOST.test(host)) return src;
  return src;
}

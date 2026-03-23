/**
 * elxea Checkout Router — Cloudflare Worker
 *
 * Architecture: DNS points to Vercel (76.76.21.21, proxied via Cloudflare).
 * Vercel serves the Next.js app as the default origin.
 * This Worker intercepts Shopify-specific paths and proxies them to Shopify.
 *
 * Routing rules:
 *   Shopify (proxy to Shopify origin):
 *     /checkouts/*
 *     /cart/add, /cart/update, /cart/change, /cart/clear, /cart.js, /cart.json
 *     /services/*
 *     /.well-known/shopify/*
 *     /payments/*
 *     /wallets/*
 *     /admin/*
 *
 *   Vercel (passthrough — let Cloudflare route to origin normally):
 *     Everything else — the Next.js app
 */

export interface Env {
  SHOPIFY_ORIGIN: string;
}

/** Paths that Shopify must handle — proxy to Shopify origin */
const SHOPIFY_PATH_PREFIXES = [
  '/checkouts/',
  '/checkouts',
  '/cart/add',
  '/cart/update',
  '/cart/change',
  '/cart/clear',
  '/cart.js',
  '/cart.json',
  '/services/',
  '/.well-known/shopify/',
  '/payments/',
  '/wallets/',
  '/admin/',
  // Shopify CDN paths (served from Shopify's CDN when checkout pages reference them)
  '/cdn/',
];

function isShopifyPath(pathname: string): boolean {
  return SHOPIFY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Shopify paths — proxy to Shopify origin
    if (isShopifyPath(pathname)) {
      const shopifyUrl = new URL(pathname + url.search, env.SHOPIFY_ORIGIN);

      const shopifyRequest = new Request(shopifyUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
      });

      // Set Host header to the custom domain (Shopify recognizes it)
      shopifyRequest.headers.set('Host', url.host);
      shopifyRequest.headers.set('X-Forwarded-Host', url.host);
      shopifyRequest.headers.set('X-Forwarded-Proto', 'https');

      const response = await fetch(shopifyRequest);
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('x-elxea-router', 'shopify-proxy');
      return newResponse;
    }

    // Everything else — passthrough to Vercel origin (default DNS target)
    const response = await fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('x-elxea-router', 'vercel-passthrough');
    return newResponse;
  },
};

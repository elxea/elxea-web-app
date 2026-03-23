/**
 * elxea Checkout Router — Cloudflare Worker
 *
 * Architecture: Cloudflare O2O (Orange-to-Orange) with Shopify
 *
 * DNS points elxea.com A record to 23.227.38.65 (Shopify) with Cloudflare proxy.
 * Shopify is the default origin and handles /checkouts/* natively.
 * This Worker intercepts all other requests and forwards them to Vercel.
 *
 * Routing rules:
 *   Shopify (passthrough — do NOT fetch, just return):
 *     /checkouts/*
 *     /cart/* (Shopify cart API, distinct from the Next.js /cart page)
 *     /services/*
 *     /.well-known/shopify/*
 *     /payments/*
 *     /wallets/*
 *
 *   Vercel (rewrite origin):
 *     Everything else — the Next.js app
 *
 * Note on O2O: In Cloudflare O2O mode with Shopify, Workers may be disabled
 * on /checkout paths by Shopify's Cloudflare for SaaS configuration. This is
 * acceptable — Shopify handles checkout natively on the custom domain.
 */

export interface Env {
  VERCEL_ORIGIN: string;
}

/** Paths that Shopify must handle — do not intercept */
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
];

/** Paths that must always pass through to the origin (Shopify or ACME) */
const PASSTHROUGH_PREFIXES = [
  '/.well-known/acme-challenge/',
];

function isShopifyPath(pathname: string): boolean {
  return SHOPIFY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

function isPassthroughPath(pathname: string): boolean {
  return PASSTHROUGH_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix)
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

    // 1. ACME challenges must pass through for SSL certificate renewal
    if (isPassthroughPath(pathname)) {
      return fetch(request);
    }

    // 2. Shopify paths — let O2O handle natively (passthrough to Shopify origin)
    if (isShopifyPath(pathname)) {
      return fetch(request);
    }

    // 3. Everything else — rewrite to Vercel origin
    const vercelUrl = new URL(pathname + url.search, env.VERCEL_ORIGIN);

    const vercelRequest = new Request(vercelUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    // Set Host header to the Vercel deployment
    vercelRequest.headers.set('Host', new URL(env.VERCEL_ORIGIN).host);

    // Preserve the original host for the app to use (e.g., for canonical URLs)
    vercelRequest.headers.set('X-Forwarded-Host', url.host);
    vercelRequest.headers.set('X-Forwarded-Proto', 'https');

    const response = await fetch(vercelRequest);

    // Clone response to allow header modification
    const newResponse = new Response(response.body, response);

    // Remove any Vercel-specific headers that could leak origin info
    // but keep x-vercel-id for debugging
    newResponse.headers.delete('x-vercel-deployment-url');

    return newResponse;
  },
};

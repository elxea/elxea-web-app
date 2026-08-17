import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
      {
        protocol: "https",
        hostname: "*.shopify.com",
      },
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
      {
        // M33 Phase C: Asset Hub site-slot images (R2 managed public domain).
        // Mirrors elxea-asset-hub lib/r2.ts R2_PUBLIC_DOMAIN.
        protocol: "https",
        hostname: "pub-90a0485599904fee8228ef56bb51c2e6.r2.dev",
      },
    ],
  },
  // MS10.4: Webflow → Next.js redirects (old site URL structure → new)
  async redirects() {
    return [
      /* 会員制度 (階層プラン) の廃止に伴う URL 統合。
       *
       * elxea は会員制度を持たない — 会員かどうかは「roji 契約の有無」の二値であり、
       * ランク・ティア・特典階層は作らない (Setaka 確定 2026-08-17 / roji マスター
       * スペックが階層会員を明示禁止)。旧 `/membership` は フリー / スタンダード /
       * プレミアム の 3 階層比較表を出しており、この決定と正面から矛盾する。
       * プラン選択の導線は定期便 LP (`/ja/subscription`) に一本化する。
       *
       * ページ側の `permanentRedirect()` ではなく本ブロックで転送するのは、
       * App Router がシェルを流し始めたあとの redirect を 200 + クライアント遷移に
       * 畳んでしまい 308 にならないため。URL 統合は検索側にも伝える必要があるので、
       * Webflow 移行と同じ `redirects()` (308) に載せる。
       *
       * `/en/*` は middleware が先に 301 で `/ja/*` へ送るため ja だけで足りる。 */
      {
        source: "/ja/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      {
        source: "/membership",
        destination: "/ja/subscription",
        permanent: true,
      },
      // Webflow blog posts → journal
      {
        source: "/blog/:slug",
        destination: "/ja/journal/:slug",
        permanent: true,
      },
      {
        source: "/blog",
        destination: "/ja/journal",
        permanent: true,
      },
      // Webflow about → new about
      {
        source: "/about-us",
        destination: "/ja/about",
        permanent: true,
      },
      // Webflow contact
      {
        source: "/contact-us",
        destination: "/ja/contact",
        permanent: true,
      },
      // Webflow shop/store → products
      {
        source: "/shop",
        destination: "/ja/products",
        permanent: true,
      },
      {
        source: "/store",
        destination: "/ja/products",
        permanent: true,
      },
      // Webflow tea menus → tea-menu
      {
        source: "/tea-menus/:slug",
        destination: "/ja/tea-menu/:slug",
        permanent: true,
      },
      {
        source: "/tea-menus",
        destination: "/ja/tea-menu",
        permanent: true,
      },
      // Webflow experience → playlists
      {
        source: "/experience/:slug",
        destination: "/ja/playlists/:slug",
        permanent: true,
      },
      {
        source: "/experience",
        destination: "/ja/playlists",
        permanent: true,
      },
      // Webflow elxea journals
      {
        source: "/elxea-journals/:slug",
        destination: "/ja/elxea-journal/:slug",
        permanent: true,
      },
      {
        source: "/elxea-journals",
        destination: "/ja/elxea-journal",
        permanent: true,
      },
      // Webflow people → people
      {
        source: "/people/:slug",
        destination: "/ja/people/:slug",
        permanent: true,
      },
      // Webflow post categories
      {
        source: "/blog/category/:slug",
        destination: "/ja/journal?category=:slug",
        permanent: true,
      },
      // Webflow privacy/terms
      {
        source: "/privacy-policy",
        destination: "/ja/legal/privacy",
        permanent: true,
      },
      {
        source: "/terms-of-service",
        destination: "/ja/legal/terms",
        permanent: true,
      },
      {
        source: "/terms",
        destination: "/ja/legal/terms",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "elxea",
  project: "elxea-web",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});

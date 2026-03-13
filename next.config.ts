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
        hostname: "cdn.sanity.io",
      },
    ],
  },
  // MS10.4: Webflow → Next.js redirects (old site URL structure → new)
  async redirects() {
    return [
      // Shopify checkout: DNS now points to Vercel, redirect to Shopify
      {
        source: "/cart/c/:path*",
        destination: "https://elxea.myshopify.com/cart/c/:path*",
        permanent: false,
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

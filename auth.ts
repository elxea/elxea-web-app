/**
 * Auth.js v5 configuration.
 *
 * I2: LINE Provider removed — LINE Login uses direct OAuth via
 * /api/line-login + /api/line-callback instead. Auth.js is retained
 * for potential future providers (e.g. Shopify Customer Account).
 *
 * No providers are currently configured. Auth.js handlers remain
 * available for session management infrastructure.
 */
import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow relative and same-origin redirects
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
  pages: {
    signIn: "/login",
  },
});

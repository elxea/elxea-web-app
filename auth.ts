/**
 * Auth.js v5 configuration for LINE Login.
 *
 * Provides LINE OAuth provider with bot_prompt=aggressive
 * to complete LINE friend addition during login.
 * On successful sign-in, links the LINE user_id to the
 * user_identity_map in cx-agent via POST /api/identity/link-line.
 *
 * LINE Login uses OIDC; profile.sub contains the LINE userId
 * which MUST match the Messaging API userId when both channels
 * belong to the same LINE provider. If they differ, verify that
 * the LINE Login channel and Messaging API channel share the
 * same provider in LINE Developer Console.
 *
 * IMPORTANT: Explicit endpoint URLs are provided to avoid runtime
 * OIDC discovery fetch to access.line.me, which hangs in Vercel
 * serverless functions causing a Configuration error. Endpoints
 * are from LINE's /.well-known/openid-configuration.
 */
import NextAuth from "next-auth";
import type { OAuthConfig } from "next-auth/providers";
import { cookies } from "next/headers";

/**
 * LINE provider with explicit endpoints (no runtime discovery).
 *
 * The built-in LINE provider (next-auth/providers/line) uses type: "oidc"
 * which triggers a runtime discovery fetch to access.line.me. In Vercel
 * serverless functions, this fetch hangs causing a Configuration error.
 *
 * This custom provider uses type: "oauth" with explicit endpoints from
 * LINE's OIDC discovery document, avoiding the runtime fetch entirely.
 *
 * LINE signs id_tokens with HS256 (HMAC-SHA256 using the channel secret).
 */
interface LineProfile {
  /** LINE user ID (same as Messaging API userId when channels share a provider) */
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
}

function LINEProvider(options: {
  clientId?: string;
  clientSecret?: string;
  authorization?: {
    url: string;
    params?: Record<string, string>;
  };
}): OAuthConfig<LineProfile> {
  return {
    id: "line",
    name: "LINE",
    type: "oauth",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    // Explicit endpoints from https://access.line.me/.well-known/openid-configuration
    authorization: options.authorization ?? {
      url: "https://access.line.me/oauth2/v2.1/authorize",
      params: { scope: "profile openid email" },
    },
    token: "https://api.line.me/oauth2/v2.1/token",
    userinfo: "https://api.line.me/oauth2/v2.1/userinfo",
    client: {
      id_token_signed_response_alg: "HS256",
    },
    // State-only checks (matches latest upstream LINE provider).
    checks: ["state"],
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? profile.sub,
        email: profile.email ?? null,
        image: profile.picture ?? null,
      };
    },
    style: { bg: "#00C300", text: "#fff" },
  };
}

const CHAT_API_BASE = (
  process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
)
  .trim()
  .replace(/\/api\/chat\/?$/, "");

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    LINEProvider({
      clientId: process.env.AUTH_LINE_ID,
      clientSecret: process.env.AUTH_LINE_SECRET,
      authorization: {
        url: "https://access.line.me/oauth2/v2.1/authorize",
        params: {
          bot_prompt: "aggressive",
          scope: "profile openid email",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "line") {
        // profile.sub is the LINE userId from the OIDC id_token.
        // account.providerAccountId should be the same value.
        // Use profile.sub as primary, fall back to providerAccountId.
        const lineUserId = profile?.sub ?? account.providerAccountId;

        if (lineUserId) {
          // Read session_id from cookie (set by login page before redirect)
          const cookieStore = await cookies();
          const chatSessionId = cookieStore.get("chat_session_id")?.value;

          try {
            await fetch(`${CHAT_API_BASE}/api/identity/link-line`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                line_user_id: lineUserId,
                email: user.email ?? null,
                display_name: user.name ?? null,
                session_id: chatSessionId ?? null,
              }),
            });
          } catch (e) {
            console.error("[auth] Identity link failed:", e);
            // Do not block sign-in on link failure
          }
        }
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      // Persist line_user_id in the JWT on first sign-in
      if (account?.provider === "line") {
        const lineUserId = profile?.sub ?? account.providerAccountId;
        if (lineUserId) {
          token.lineUserId = lineUserId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      // Expose line_user_id on the session
      if (token.lineUserId) {
        (session.user as unknown as Record<string, unknown>).lineUserId =
          token.lineUserId;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Allow relative and same-origin redirects (including /login/complete)
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
  pages: {
    signIn: "/login",
  },
});

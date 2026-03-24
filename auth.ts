/**
 * Auth.js v5 configuration for LINE Login.
 *
 * Provides LINE OAuth provider with bot_prompt=aggressive
 * to complete LINE friend addition during login.
 * On successful sign-in, links the LINE user_id to the
 * user_identity_map in cx-agent via POST /api/identity/link.
 */
import NextAuth from "next-auth";
import LINE from "next-auth/providers/line";

const CHAT_API_BASE = (
  process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
)
  .trim()
  .replace(/\/api\/chat\/?$/, "");

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    LINE({
      clientId: process.env.AUTH_LINE_ID,
      clientSecret: process.env.AUTH_LINE_SECRET,
      authorization: {
        params: {
          bot_prompt: "aggressive",
          scope: "profile openid email",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "line" && profile?.sub) {
        // Call cx-agent /api/identity/link to register the mapping
        try {
          await fetch(`${CHAT_API_BASE}/api/identity/link-line`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              line_user_id: profile.sub,
              email: user.email ?? null,
              display_name: user.name ?? null,
            }),
          });
        } catch (e) {
          console.error("[auth] Identity link failed:", e);
          // Do not block sign-in on link failure
        }
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      // Persist line_user_id in the JWT on first sign-in
      if (account?.provider === "line" && profile?.sub) {
        token.lineUserId = profile.sub;
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
  },
  pages: {
    signIn: "/ja/login",
  },
});

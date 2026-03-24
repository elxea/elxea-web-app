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
 */
import NextAuth from "next-auth";
import LINE from "next-auth/providers/line";
import { cookies } from "next/headers";

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
          // LINE のデフォルト挙動:
          // モバイル: 「LINEアプリでログイン」ボタン + メール/パスワード
          // PC: QRコード + メール/パスワード
          // initial_amr_display は設定しない（モバイルで QR が出てしまうため）
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

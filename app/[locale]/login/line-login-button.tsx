"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Client component that:
 * 1. Saves the chat session_id from localStorage to a cookie before LINE Login redirect
 * 2. Submits the server action form for LINE signIn
 *
 * The cookie is read by auth.ts signIn callback (server-side) and forwarded
 * to the cx-agent identity link API for anonymous session merging.
 */
export function LineLoginButton({
  children,
  signInAction,
}: {
  children: React.ReactNode;
  signInAction: () => Promise<void>;
}) {
  // On mount, pre-save session_id to cookie so it's available during redirect
  useEffect(() => {
    try {
      const sessionId = localStorage.getItem("elxea-chat-session-id");
      if (sessionId) {
        document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax`;
      }
    } catch {
      // localStorage not available (SSR, privacy mode)
    }
  }, []);

  return (
    <form
      action={signInAction}
      onSubmit={() => {
        // Also save just before submit in case localStorage changed
        try {
          const sessionId = localStorage.getItem("elxea-chat-session-id");
          if (sessionId) {
            document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax`;
          }
        } catch {
          // noop
        }
      }}
    >
      <Button
        type="submit"
        size="lg"
        className="w-full bg-[#06C755] text-white hover:bg-[#06C755]/90 active:bg-[#06C755]/80"
      >
        {children}
      </Button>
    </form>
  );
}

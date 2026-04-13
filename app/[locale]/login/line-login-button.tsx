"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * LINE Login button — Direct OAuth 2.0 via <a href> to access.line.me.
 *
 * CRITICAL DESIGN DECISIONS (do not change without reading):
 *
 * 1. The <a href> must point DIRECTLY at access.line.me, not at an
 *    elxea-owned endpoint that server-redirects. Chrome iOS will not fire
 *    LINE's Universal Link through a 302 from a first-party URL; Safari iOS
 *    is more lenient but we standardize on the strict path.
 *    We fetch the fully-formed authorize URL from POST /api/line-login/init
 *    on mount (which also sets the HttpOnly state cookie).
 *
 * 2. DO NOT use LIFF SDK (liff.login())
 *    - LIFF SDK does NOT open the LINE app from external browsers.
 *
 * 3. DO NOT use JavaScript redirects (window.location, router.push)
 *    - iOS/Android Universal Links only fire on user-initiated <a> taps.
 *
 * 4. DO NOT use form action / server action
 *    - Server-side redirects from form submissions don't trigger Universal Links.
 *
 * 5. The button is disabled until the init fetch resolves. The fetch is fast
 *    (single HTTP round-trip, no external I/O), typically <100ms on good
 *    networks, so users almost never see the disabled state.
 */
export function LineLoginButton({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Save chat session_id cookie for identity linking in the Auth.js callback.
    try {
      const sessionId = localStorage.getItem("elxea-chat-session-id");
      if (sessionId) {
        document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax;Secure`;
      }
    } catch {
      // localStorage not available
    }

    fetch("/api/line-login/init", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { authUrl?: string }) => {
        if (!cancelled && data.authUrl) setAuthUrl(data.authUrl);
      })
      .catch(() => {
        // Silent fail — button stays disabled; user can refresh to retry.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = () => {
    // Refresh session_id cookie immediately before navigation.
    try {
      const sessionId = localStorage.getItem("elxea-chat-session-id");
      if (sessionId) {
        document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax;Secure`;
      }
    } catch {
      // noop
    }
  };

  if (!authUrl) {
    return (
      <Button
        size="lg"
        disabled
        aria-busy="true"
        className="w-full bg-[#06C755] text-white hover:bg-[#06C755]/90 active:bg-[#06C755]/80 disabled:opacity-70 disabled:bg-[#06C755]"
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      asChild
      size="lg"
      className="w-full bg-[#06C755] text-white hover:bg-[#06C755]/90 active:bg-[#06C755]/80"
    >
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Intentional: <a> with external href required for Universal Links to open LINE app. Must NOT be <Link>. */}
      <a href={authUrl} onClick={handleClick}>
        {children}
      </a>
    </Button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * LINE Login button — Direct OAuth 2.0 via <a href> to access.line.me.
 *
 * 見た目は Figma【R2: 確定版】6893:17349 (ログイン) に従う = primary 塗り / h36 /
 * ラベルのみ。R2 で LINE ブランド緑 (#06C755) とブランドアイコンは廃止された。
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
export function LineLoginButton({ children }: { children: React.ReactNode }) {
  const t = useTranslations("login");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  /* Distinguishes "still loading" from "this deployment cannot do LINE login".
   * Both used to render the same permanently-disabled button with a spinner
   * that never resolved, which reads as a hang rather than as a state. */
  const [unavailable, setUnavailable] = useState(false);

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
      .catch((status: unknown) => {
        /* 503 is the server saying "not configured / host not registered here" —
         * a settled state, not a transient failure, so stop showing a busy
         * control the user can never complete. Anything else keeps the previous
         * behaviour (stay busy; a refresh may succeed). */
        if (!cancelled && status === 503) setUnavailable(true);
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

  if (unavailable) {
    return (
      <Button disabled className="w-full shadow-xs">
        {t("lineButtonUnavailable")}
      </Button>
    );
  }

  if (!authUrl) {
    return (
      <Button disabled aria-busy="true" className="w-full shadow-xs">
        {children}
      </Button>
    );
  }

  return (
    <Button asChild className="w-full shadow-xs">
      {/* Intentional: <a> with external href (authUrl) required for Universal Links to open the LINE app. Must NOT be <Link>. no-html-link-for-pages does not fire here (external href), so no disable directive is needed. */}
      <a href={authUrl} onClick={handleClick}>
        {children}
      </a>
    </Button>
  );
}

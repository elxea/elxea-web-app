"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  initLiff,
  isMobile,
  isLiffLoggedIn,
  getLiffAccessToken,
  getLiffIdToken,
  getLiffProfile,
  startLiffLogin,
} from "@/lib/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

/**
 * LINE Login button with dual-path authentication:
 *
 * Mobile: Uses LIFF SDK to open the LINE app directly via Universal Links
 * (iOS) / App Links (Android). One-tap authentication without browser
 * login screen.
 *
 * Desktop: Uses Auth.js LINE Provider which shows QR code login.
 *
 * Flow (mobile):
 * 1. User taps button -> LIFF SDK redirects to LINE app
 * 2. User authorizes in LINE app -> redirect back to login page with LIFF session
 * 3. On mount, detect LIFF session -> call /api/auth/liff-callback
 * 4. Redirect to /login/complete
 *
 * Flow (desktop):
 * 1. User clicks button -> Auth.js signIn("line") -> access.line.me QR code
 * 2. User scans QR -> Auth.js callback -> /login/complete
 */
export function LineLoginButton({
  children,
  signInAction,
}: {
  children: React.ReactNode;
  signInAction: () => Promise<void>;
}) {
  const locale = useLocale();
  const [isProcessing, setIsProcessing] = useState(false);
  const [liffReady, setLiffReady] = useState(false);
  const [useLiff, setUseLiff] = useState(false);

  // Initialize LIFF SDK on mobile devices
  useEffect(() => {
    if (!LIFF_ID) return;

    const mobile = isMobile();
    setUseLiff(mobile);

    if (!mobile) return;

    let cancelled = false;

    async function init() {
      try {
        await initLiff(LIFF_ID!);
        if (!cancelled) {
          setLiffReady(true);
        }
      } catch (err) {
        console.error("[LineLoginButton] LIFF init failed:", err);
        // Fall back to Auth.js on LIFF init failure
        if (!cancelled) {
          setUseLiff(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // After LIFF login redirect, process the authenticated session
  useEffect(() => {
    if (!liffReady || !useLiff) return;
    if (!isLiffLoggedIn()) return;

    let cancelled = false;

    async function processLiffLogin() {
      setIsProcessing(true);
      try {
        const accessToken = getLiffAccessToken();
        const idToken = getLiffIdToken();
        const profile = await getLiffProfile();

        if (!accessToken) {
          console.error("[LineLoginButton] No access token after LIFF login");
          setIsProcessing(false);
          return;
        }

        // Read chat session_id from localStorage
        let sessionId: string | null = null;
        try {
          sessionId = localStorage.getItem("elxea-chat-session-id");
        } catch {
          // localStorage not available
        }

        // Call our server to verify token and link identity
        const res = await fetch("/api/auth/liff-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: accessToken,
            id_token: idToken,
            session_id: sessionId,
          }),
        });

        if (!cancelled && res.ok) {
          // Store LINE user info for the session
          if (profile) {
            try {
              sessionStorage.setItem(
                "line_user",
                JSON.stringify({
                  userId: profile.userId,
                  displayName: profile.displayName,
                })
              );
            } catch {
              // sessionStorage not available
            }
          }

          // Redirect to login complete page
          window.location.href = `/${locale}/login/complete`;
        } else if (!cancelled) {
          console.error("[LineLoginButton] LIFF callback failed");
          setIsProcessing(false);
        }
      } catch (err) {
        console.error("[LineLoginButton] LIFF login processing error:", err);
        if (!cancelled) {
          setIsProcessing(false);
        }
      }
    }

    processLiffLogin();
    return () => {
      cancelled = true;
    };
  }, [liffReady, useLiff, locale]);

  // Save chat session_id to cookie (for Auth.js flow on desktop)
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

  const handleClick = useCallback(() => {
    if (isProcessing) return;

    // Save session_id cookie just before action
    try {
      const sessionId = localStorage.getItem("elxea-chat-session-id");
      if (sessionId) {
        document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax`;
      }
    } catch {
      // noop
    }

    if (useLiff && liffReady) {
      // Mobile: LIFF login -> opens LINE app directly
      setIsProcessing(true);
      const redirectUri = `${window.location.origin}/${locale}/login`;
      startLiffLogin(redirectUri);
    }
    // Desktop: form action handles Auth.js signIn
  }, [isProcessing, useLiff, liffReady, locale]);

  // Mobile with LIFF: use button click handler (no form submission)
  if (useLiff) {
    return (
      <Button
        type="button"
        size="lg"
        className="w-full bg-[#06C755] text-white hover:bg-[#06C755]/90 active:bg-[#06C755]/80"
        onClick={handleClick}
        disabled={isProcessing || (!liffReady && useLiff)}
        aria-label="LINE Login"
      >
        {isProcessing ? <LoadingSpinner /> : children}
      </Button>
    );
  }

  // Desktop: use Auth.js form action (existing QR code flow)
  return (
    <form
      action={signInAction}
      onSubmit={() => {
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

/** Inline loading spinner for the button */
function LoadingSpinner() {
  return (
    <svg
      className="size-5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

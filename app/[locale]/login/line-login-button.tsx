"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * LINE Login button — Direct OAuth 2.0 via <a href>.
 *
 * CRITICAL DESIGN DECISIONS (do not change without reading):
 *
 * 1. Uses <a href> to /api/line-login (direct OAuth endpoint)
 *    - This triggers a server-side redirect to access.line.me
 *    - On mobile: Universal Links / App Links open the LINE app directly
 *    - On desktop: LINE shows a QR code for scanning
 *
 * 2. DO NOT use LIFF SDK (liff.login())
 *    - LIFF SDK does NOT open the LINE app from external browsers
 *    - It only opens a web authentication page in the browser
 *    - This was confirmed via LINE official documentation research
 *
 * 3. DO NOT use JavaScript redirects (window.location, router.push)
 *    - iOS/Android Universal Links only fire on user-initiated <a> taps
 *    - JS redirects do not trigger Universal Links
 *
 * 4. DO NOT use form action / server action
 *    - Server-side redirects from form submissions don't trigger Universal Links
 *    - Must be a direct <a href> tap by the user
 */
export function LineLoginButton({
  children,
}: {
  children: React.ReactNode;
}) {
  // Save chat session_id to cookie before login (for identity linking in Auth.js callback)
  useEffect(() => {
    try {
      const sessionId = localStorage.getItem("elxea-chat-session-id");
      if (sessionId) {
        document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax;Secure`;
      }
    } catch {
      // localStorage not available
    }
  }, []);

  return (
    <Button
      asChild
      size="lg"
      className="w-full bg-brand-line text-brand-white hover:bg-brand-line/90 active:bg-brand-line/80"
    >
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Intentional: <a> required for Universal Links to open LINE app. <Link> would use client-side navigation which breaks OAuth redirect. */}
      <a
        href="/api/line-login"
        onClick={() => {
          // Ensure session_id cookie is fresh just before navigation
          try {
            const sessionId = localStorage.getItem("elxea-chat-session-id");
            if (sessionId) {
              document.cookie = `chat_session_id=${sessionId};path=/;max-age=300;SameSite=Lax;Secure`;
            }
          } catch {
            // noop
          }
        }}
      >
        {children}
      </a>
    </Button>
  );
}

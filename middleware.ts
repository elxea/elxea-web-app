import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

const SITE_PASSWORD = process.env.SITE_PASSWORD;

/**
 * Compute HMAC-SHA256 hash of the site password using the Web Crypto API
 * (available in Edge Runtime / middleware). This must produce the same output
 * as the Node.js `hashSitePassword` in `app/api/site-auth/route.ts`.
 */
async function hashSitePasswordEdge(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(password);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, keyData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkSitePassword(request: NextRequest): Promise<NextResponse | null> {
  if (!SITE_PASSWORD) return null;

  const authCookie = request.cookies.get("site_auth")?.value;
  if (authCookie) {
    const expectedHash = await hashSitePasswordEdge(SITE_PASSWORD);
    if (authCookie === expectedHash) return null;
  }

  const { pathname } = request.nextUrl;

  // Allow access to password page itself
  if (pathname === "/password") return null;

  // Allow LIFF account-linking pages: they are opened inside the LINE in-app
  // browser (during LINE x Shopify linking), which cannot pass the staging
  // site-password gate. Scoped to the /liff subtree only, with or without a
  // locale prefix (e.g. /liff/link, /ja/liff/link). Same intent as the /api
  // matcher exemption below.
  if (/^\/(?:(?:ja|en)\/)?liff(?:\/|$)/.test(pathname)) return null;

  // Allow the LINE 純正 Account Link entry (/{locale}/link): it is opened from a
  // button inside the LINE in-app browser and cannot pass the staging
  // site-password gate. The route itself is a pure redirector that enforces its
  // own Shopify login via requireAuth(), so exempting it from the site password
  // does not expose anything (no UI, no data — it only 302s). Without this, the
  // password gate intercepts /ja/link before requireAuth runs and the whole
  // account-linking round trip (link → login → back to link) never resumes.
  // Scoped to the /link path only, with or without a locale prefix.
  if (/^\/(?:(?:ja|en)\/)?link(?:\/|$)/.test(pathname)) return null;

  // Redirect to password page
  const passwordUrl = new URL("/password", request.url);
  return NextResponse.redirect(passwordUrl);
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Site-wide password protection (staging/preview)
  const passwordResponse = await checkSitePassword(request);
  if (passwordResponse) return passwordResponse;

  // 実装確認用のプレビュー面 (`/dev/*`) は i18n の外に置く。
  // next-intl のミドルウェアを通すと `/dev/...` が `/ja/dev/...` へ飛ばされるが、
  // ルートは `app/dev/` (= `[locale]` の外) にあるので 404 になる。ここで手前に
  // 抜けることでロケール接頭辞なしのまま到達できる。
  // サイトパスワードの検査より **後** に置いてあるのは意図的で、staging では
  // このプレビューにもパスワードが掛かる (公開面を増やさない)。
  if (pathname === "/dev" || pathname.startsWith("/dev/")) {
    return NextResponse.next();
  }

  // Redirect /en/* to /ja/* (English content not ready yet)
  if (pathname.startsWith("/en")) {
    const jaPath = pathname.replace(/^\/en/, "/ja") || "/ja";
    const redirectUrl = new URL(jaPath, request.url);
    redirectUrl.search = request.nextUrl.search;
    return NextResponse.redirect(redirectUrl, 301);
  }

  // Check if this is an /account route that needs auth
  const accountMatch = pathname.match(/^\/(ja|en)\/account/);
  if (accountMatch) {
    const hasShopifySession =
      request.cookies.has("shop_at") && request.cookies.has("shop_rt");
    const hasLineSession = request.cookies.has("line_session");
    if (!hasShopifySession && !hasLineSession) {
      // P3-fix: Redirect to /login (not Shopify OAuth) so LINE users can choose their login method
      const locale = accountMatch[1];
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Match all pathnames except:
    // - /studio (Sanity Studio)
    // - /api routes
    // - /_next (Next.js internals)
    // - Static files
    "/((?!studio|api|password|_next|.*\\..*).*)",
  ],
};

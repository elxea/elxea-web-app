import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

const SITE_PASSWORD = process.env.SITE_PASSWORD;

function checkSitePassword(request: NextRequest): NextResponse | null {
  if (!SITE_PASSWORD) return null;

  const authCookie = request.cookies.get("site_auth")?.value;
  if (authCookie === SITE_PASSWORD) return null;

  const { pathname } = request.nextUrl;

  // Allow access to password page itself
  if (pathname === "/password") return null;

  // Redirect to password page
  const passwordUrl = new URL("/password", request.url);
  return NextResponse.redirect(passwordUrl);
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Site-wide password protection (staging/preview)
  const passwordResponse = checkSitePassword(request);
  if (passwordResponse) return passwordResponse;

  // Check if this is an /account route that needs auth
  const accountMatch = pathname.match(/^\/(ja|en)\/account/);
  if (accountMatch) {
    const hasSession =
      request.cookies.has("shop_at") && request.cookies.has("shop_rt");
    if (!hasSession) {
      const locale = accountMatch[1];
      const loginUrl = new URL("/api/auth/login", request.url);
      loginUrl.searchParams.set("locale", locale);
      return NextResponse.redirect(loginUrl);
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
    "/((?!studio|api|_next|.*\\..*).*)",
  ],
};

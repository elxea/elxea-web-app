import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

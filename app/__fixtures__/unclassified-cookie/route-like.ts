import { NextResponse } from "next/server";

/**
 * NEGATIVE FIXTURE (i) — an unregistered cookie name.
 *
 * Deliberately sets a cookie that is in neither `COOKIE_REGISTRY` nor
 * `EXTERNAL_LIBRARY_COOKIES`. The registry scanner must report it. If this stops
 * being reported, the scanner has stopped protecting anything: an unknown cookie
 * is how a new piece of session state gets issued without anyone teaching logout
 * to clear it — the exact shape of the bug the registry exists to prevent.
 *
 * Not routable: the App Router ignores directories beginning with `_`.
 */
export function setUnclassifiedCookie(): NextResponse {
  const response = NextResponse.next();
  response.cookies.set("totally_unregistered_cookie", "1", { path: "/", maxAge: 60 });
  return response;
}

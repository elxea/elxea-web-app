import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") || "ja";
  const origin = request.nextUrl.origin;

  const response = NextResponse.redirect(`${origin}/${locale}`);

  // Clear all auth-related cookies with explicit path
  const deleteOptions = { path: "/", maxAge: 0 } as const;
  response.cookies.set("shop_at", "", deleteOptions);
  response.cookies.set("shop_rt", "", deleteOptions);
  response.cookies.set("shop_exp", "", deleteOptions);
  response.cookies.set("shop_auth", "", deleteOptions);

  return response;
}

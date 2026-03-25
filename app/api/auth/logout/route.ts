import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") || "ja";
  const origin = request.nextUrl.origin;

  const response = NextResponse.redirect(`${origin}/${locale}`);

  // P4-fix: Clear ALL auth-related cookies (Shopify + LINE) with explicit path
  const deleteOptions = { path: "/", maxAge: 0 } as const;
  // Shopify cookies
  response.cookies.set("shop_at", "", deleteOptions);
  response.cookies.set("shop_rt", "", deleteOptions);
  response.cookies.set("shop_exp", "", deleteOptions);
  response.cookies.set("shop_auth", "", deleteOptions);
  response.cookies.set("shop_cid", "", deleteOptions);
  // LINE cookies
  response.cookies.set("line_user", "", deleteOptions);
  response.cookies.set("line_session", "", deleteOptions);

  return response;
}

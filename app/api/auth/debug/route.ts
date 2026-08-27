import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/config";
import { logger } from "@/lib/log";
import { decryptToken } from "@/lib/shopify/customer";
import { getSession, getCustomerFromSession } from "@/lib/shopify/auth";

export async function GET(request: NextRequest) {
  // Block in production AND on preview deployments. Only allow when
  // DEBUG_AUTH_SECRET is configured and matches the query parameter.
  const debugSecret = env("DEBUG_AUTH_SECRET");
  const providedSecret = request.nextUrl.searchParams.get("secret");

  if (
    isProduction() ||
    !debugSecret ||
    providedSecret !== debugSecret
  ) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  // Test 1: Read cookies via request.cookies (Route Handler style)
  const reqCookies = {
    shop_at: !!request.cookies.get("shop_at")?.value,
    shop_rt: !!request.cookies.get("shop_rt")?.value,
    shop_exp: !!request.cookies.get("shop_exp")?.value,
    shop_auth: request.cookies.get("shop_auth")?.value,
  };

  // Test 2: Read cookies via cookies() (Server Component style)
  const cookieStore = await cookies();
  const headerCookies = {
    shop_at: !!cookieStore.get("shop_at")?.value,
    shop_rt: !!cookieStore.get("shop_rt")?.value,
    shop_exp: !!cookieStore.get("shop_exp")?.value,
    shop_auth: cookieStore.get("shop_auth")?.value,
  };

  // Test 3: getSession()
  let sessionResult: string;
  try {
    const session = await getSession();
    sessionResult = session ? `OK (token starts: ${session.accessToken.substring(0, 10)}...)` : "null";
  } catch (e) {
    /* 応答本文は手元で読むためのもの。セッションが引けないこと自体は
       ログイン全体の異常なので、調査できる形にも残す。 */
    logger.error("api.auth-debug.session-probe-failed", e, {
      route: "/api/auth/debug",
      probe: "getSession",
    });
    sessionResult = `ERROR: ${String(e)}`;
  }

  // Test 4: getCustomerFromSession (uses updated query from customer.ts)
  let customerResult: unknown;
  try {
    const result = await getCustomerFromSession();
    customerResult = result.ok
      ? { ok: true, data: result.data }
      : { ok: false, reason: result.reason };
  } catch (e) {
    logger.error("api.auth-debug.customer-probe-failed", e, {
      route: "/api/auth/debug",
      probe: "getCustomerFromSession",
    });
    customerResult = { ok: false, error: String(e) };
  }

  return NextResponse.json({
    reqCookies,
    headerCookies,
    sessionResult,
    customerResult,
  });
}

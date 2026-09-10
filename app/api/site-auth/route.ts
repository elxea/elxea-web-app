import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/config";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";

/**
 * Generate a hashed token from the site password.
 * Uses HMAC-SHA256 with the password itself as both key and message,
 * producing a deterministic but non-reversible token for cookie storage.
 */
function hashSitePassword(password: string): string {
  return createHmac("sha256", password).update(password).digest("hex");
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const sitePassword = env("SITE_PASSWORD");

  if (!sitePassword || password !== sitePassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME.siteAuth, hashSitePassword(sitePassword), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}

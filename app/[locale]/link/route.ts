import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { enforceRateLimit, limiters } from "@/lib/ratelimit";
import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { getRequestOrigin } from "@/lib/base-url";
import { getCookieSpec, isSecure } from "@/lib/auth/cookies";
import { lineAuthRedirectPrefix } from "@/lib/line/endpoints";
import {
  ACCOUNT_LINK_TOKEN_COOKIE,
  ACCOUNT_LINK_TOKEN_COOKIE_MAX_AGE,
  isValidLinkTokenFormat,
} from "@/lib/line/account-link";

/**
 * GET /{locale}/link?linkToken=...
 *
 * LINE 純正 Account Link（アカウント連携）の入口。**画面を持たない純粋なリダイレクタ**
 * （UI を出すと linkToken が画面・履歴に残るため、route handler にしている）。
 *
 * 流れ（一次情報: https://developers.line.biz/ja/docs/messaging-api/linking-accounts/）:
 *   1. Bot がトークに出したボタンから、linkToken 付きでここへ来る
 *   2. requireAuth() でご購入時のアカウント（Shopify）のログインを確認する
 *      - 未ログイン → linkToken を **短命の httpOnly クッキー**へ退避し、ログインへ送る。
 *        戻り先（returnTo）は `/{locale}/link` だけ（URL に linkToken を載せ直さない）
 *   3. cx-agent に nonce を発行させる（サーバ間・X-API-Key。ブラウザは nonce を先に知らない）
 *   4. LINE の連携ダイアログ（access.line.me/dialog/bot/accountLink）へ 302
 *   5. 以降は LINE が所有者検証し、Messaging チャネルの webhook（cx-agent）で連携が確定する
 *
 * なりすまし不能性（この 3 点が要）:
 *   - shopify_customer_id は **サーバ認証済みセッション（requireAuth）** からのみ取る。
 *     ブラウザが送ってくる customer_id は一切見ない・受け取らない。
 *   - cx-agent の nonce 発行は SYNC_API_SECRET（X-API-Key）必須。秘密はサーバにだけ置く。
 *   - linkToken は LINE がそのユーザー向けに発行したもの。所有者検証は LINE 側が行う。
 *
 * linkToken の秘匿（クエリ経由で渡るため）:
 *   - ログに出さない（値も、それを含む URL も）
 *   - 画面に描画しない（このルートは常に 302 で本文を持たない）
 *   - `Referrer-Policy: no-referrer` を全応答に付ける（外部へリファラで漏らさない）
 *   - `Cache-Control: no-store`（共有キャッシュ・履歴に残さない）
 */

/** 失敗時の戻り先（静かに account へ戻す。理由はクエリで最小限だけ伝える）。 */
function failureRedirect(
  origin: string,
  locale: string,
  reason: string,
): NextResponse {
  return withSecurityHeaders(
    NextResponse.redirect(
      new URL(`/${locale}/account?error=${encodeURIComponent(reason)}`, origin),
    ),
  );
}

/** linkToken を漏らさないための共通ヘッダー（全応答に付ける）。 */
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const origin = getRequestOrigin(request);

  // 1. linkToken: クエリ優先、無ければログイン往復のために退避したクッキーから。
  const fromQuery = request.nextUrl.searchParams.get("linkToken");
  const fromCookie = request.cookies.get(ACCOUNT_LINK_TOKEN_COOKIE)?.value;
  const linkToken = fromQuery ?? fromCookie ?? null;

  if (!isValidLinkTokenFormat(linkToken)) {
    // 値はログに出さない（形式不正である事実だけ残す）。
    console.warn("[account-link] missing or malformed linkToken");
    return failureRedirect(origin, locale, "account_link_invalid");
  }

  // 2. ご購入時のアカウントのログイン確認（サーバ認証。ここは絶対に緩めない）。
  const auth = await requireAuth();
  if (!auth.authenticated) {
    // linkToken を短命クッキーへ退避してログインへ。戻り先には linkToken を載せない。
    const loginUrl = new URL("/api/auth/login", origin);
    loginUrl.searchParams.set("locale", locale);
    loginUrl.searchParams.set("returnTo", `/${locale}/link`);

    const res = withSecurityHeaders(NextResponse.redirect(loginUrl));
    res.cookies.set(ACCOUNT_LINK_TOKEN_COOKIE, linkToken, {
      httpOnly: true,
      secure: isSecure(getCookieSpec(ACCOUNT_LINK_TOKEN_COOKIE)!),
      sameSite: "lax",
      path: "/",
      maxAge: ACCOUNT_LINK_TOKEN_COOKIE_MAX_AGE,
    });
    return res;
  }

  // 連携要求の乱打（nonce の大量発行）を抑える。ログイン済みユーザー単位。
  const limited = await enforceRateLimit(request, limiters.authedUser, auth.customerId);
  if (limited) return withSecurityHeaders(limited);

  // 3. cx-agent に nonce を発行させる（サーバ間・秘密はブラウザに出さない）。
  const secret = process.env.SYNC_API_SECRET;
  if (!secret) {
    // fail-closed: 秘密が無ければ連携を進めない（cx-agent は 401 を返すため無駄打ちも避ける）。
    console.error("[account-link] SYNC_API_SECRET not set; cannot issue nonce.");
    return failureRedirect(origin, locale, "account_link_unavailable");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CX_AGENT_BASE_URL}/api/identity/account-link-nonce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": secret,
      },
      body: JSON.stringify({
        // ブラウザ自己申告ではなく、サーバセッションで確定した顧客 ID のみを送る。
        shopify_customer_id: auth.customerId,
        link_token: linkToken,
      }),
    });
  } catch (err) {
    console.error("[account-link] cx-agent unreachable:", err);
    return failureRedirect(origin, locale, "account_link_unavailable");
  }

  if (!upstream.ok) {
    // 応答本文には nonce が含まれ得ないが（失敗応答）、念のため本文は出さない。
    console.error(`[account-link] nonce issue failed: status=${upstream.status}`);
    return failureRedirect(origin, locale, "account_link_unavailable");
  }

  const data = (await upstream.json().catch(() => null)) as {
    redirect_url?: unknown;
  } | null;
  const redirectUrl = data?.redirect_url;

  /* 4. LINE の連携ダイアログへ（cx-agent が組んだ URL のみを信頼する）。
   *
   * 許可する前置きは `lineAuthRedirectPrefix()`（既定 `https://access.line.me/`）。オープン
   * リダイレクト防止のホワイトリストなので、緩めていないことが重要:
   *   - 既定値は従来のリテラルと一字一句同じ。env 未設定＝本番では判定が変わらない。
   *   - 前置きは末尾スラッシュ込み。`https://access.line.me.evil.example/` は通らない。
   *   - 差し替え元は env（サーバの運用者だけが書ける）であって、リクエストや上流の応答では
   *     ない。攻撃者が判定対象を選べる経路は増えていない。 */
  if (typeof redirectUrl !== "string" || !redirectUrl.startsWith(lineAuthRedirectPrefix())) {
    console.error("[account-link] unexpected nonce response (no valid redirect_url)");
    return failureRedirect(origin, locale, "account_link_unavailable");
  }

  const res = withSecurityHeaders(NextResponse.redirect(redirectUrl));
  /* 役目を終えた退避クッキーは必ず落とす（linkToken を残さない）。
   * host-only 発行なので host-only の失効だけで足りる（registry の scope と一致）。 */
  res.cookies.set(ACCOUNT_LINK_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

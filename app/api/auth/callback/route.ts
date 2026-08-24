import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  exchangeToken,
  encryptToken,
  decryptToken,
  getCustomer,
} from "@/lib/shopify/customer";
import { verifyShopifyIdToken } from "@/lib/shopify/id-token";
import { buildSessionCookieWrites } from "@/lib/shopify/session-cookies";
import { sendWelcomeEmail } from "@/lib/email/welcome";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { getRequestOrigin } from "@/lib/base-url";
import {
  applyLinkageEstablished,
  completeLineLinkage,
} from "@/lib/auth/identity-link";
import { LINK_INTENT_COOKIE, openLinkIntent } from "@/lib/auth/link-intent";
import { establishLinkageFromIntent } from "@/lib/auth/one-tap-link";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  /* Was `process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin`. Measured
   * 2026-08-18: that variable is not set in production, so the expression always
   * evaluated to the request origin there — the dead branch is dropped without
   * changing behaviour. See `getRequestOrigin` for why these routes keep the
   * request origin rather than moving to the env chain. */
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const codeVerifier = request.cookies.get("shop_cv")?.value;
  const savedState = request.cookies.get("shop_state")?.value;
  const savedNonce = request.cookies.get("shop_nonce")?.value;
  const locale = request.cookies.get("shop_locale")?.value || "ja";

  // Validate state
  if (!code || !state || !codeVerifier || state !== savedState) {
    return NextResponse.redirect(
      `${origin}/${locale}/account?error=invalid_state`
    );
  }

  try {
    const redirectUri = `${origin}/api/auth/callback`;
    const tokens = await exchangeToken(code, codeVerifier, redirectUri);

    /* Verify the id_token itself — signature, issuer, audience, expiry, and the
     * nonce that binds it to THIS login attempt (QA audit D1 + D11 / 設計書 1-0b).
     *
     * Two separate gaps were closed here, and they are not the same gap:
     *
     *   - **nonce** (#90): `/api/auth/login` generated a nonce, sent it to
     *     Shopify, and stored it in `shop_nonce` — and this route used to delete
     *     that cookie without ever comparing it. `state` binds the authorization
     *     *response* to this browser; only the nonce binds the *id_token* to the
     *     request we made.
     *   - **signature**: even with the nonce compared, the token was being
     *     opened with a plain Base64 decode. The claim that "the back-channel
     *     TLS call already proves the origin" holds for the exchange itself, but
     *     the value read out of it then travels much further — `shop_cid`
     *     decides the Firestore user key the LINE merge writes into, and
     *     `shop_it` comes back at logout as `id_token_hint`. OIDC Core §3.1.3.7
     *     asks for the token to be verified, not the pipe it arrived through.
     *
     * `verifyShopifyIdToken` does both, plus iss/aud/exp, against Shopify's
     * published JWKS (discovered, not hard-coded). Fail-closed and BEFORE any
     * session cookie is written: a rejected token must not leave a
     * half-established session behind. A missing cookie or a missing claim are
     * failures, never reasons to skip a check. */
    const verified = await verifyShopifyIdToken(tokens.id_token, {
      expectedNonce: savedNonce,
    });
    if (!verified.ok) {
      console.warn(`[Auth Callback] id_token rejected: ${verified.reason}`);
      Sentry.captureMessage("Shopify id_token verification failed", {
        level: "warning",
        tags: { subsystem: "shopify-oauth" },
        extra: { reason: verified.reason },
      });
      /* Send the user somewhere that can actually TELL them what happened.
       *
       * This used to redirect to `/{locale}/account?error=invalid_nonce`, which
       * showed nothing at all: no code reads `error` on the account page, and the
       * rejection has just cleared the session cookies — so `middleware.ts` sees an
       * unauthenticated `/account` request and redirects to `/{locale}/login`
       * **without carrying the query string**. The parameter was dropped one hop
       * before anything could have read it. A user whose login was refused landed
       * on a bare login form with no explanation, which is indistinguishable from
       * having mis-tapped.
       *
       * `/{locale}/login` is where `AuthErrorBanner` lives, and it resolves
       * `?error=<key>` through its own map — so the key has to be one of ITS keys,
       * not a snake_case string invented here.
       *
       * Two buckets, deliberately:
       *
       *   - `VerificationUnavailable` — we could not perform the check at all
       *     (JWKS unreachable, client id not configured). Server-side conditions,
       *     not attacker-controlled, so naming them leaks nothing and "try again
       *     shortly" is the honest advice.
       *   - `InvalidIdToken` — everything about the token itself: signature, nonce,
       *     iss, aud, exp, sub. These stay **indistinguishable from each other**.
       *     Telling the outside world which one failed hands an attacker a free
       *     oracle for probing the verifier. The precise reason goes to the log and
       *     to Sentry, where only we can read it. */
      const userFacingKey =
        verified.reason === "jwks_unavailable" || verified.reason === "client_id_not_configured"
          ? "VerificationUnavailable"
          : "InvalidIdToken";
      const rejected = NextResponse.redirect(
        `${origin}/${locale}/login?error=${userFacingKey}`,
      );
      // One-shot values: a rejected attempt must not leave anything reusable.
      for (const name of ["shop_cv", "shop_state", "shop_nonce", "shop_locale", "shop_return_to"]) {
        rejected.cookies.delete(name);
      }
      return rejected;
    }

    // Post-login destination. Defaults to /{locale}/account (previous fixed
    // behaviour); a flow that needs to resume after login (LINE account linking
    // at /{locale}/link) sets `shop_return_to` when it sends the user to
    // /api/auth/login?returnTo=...
    //
    // `sanitizeReturnTo` only lets same-site relative paths through, so this
    // cannot be abused as an open redirect even if the cookie is tampered with.
    const returnTo = sanitizeReturnTo(request.cookies.get("shop_return_to")?.value);
    const response = NextResponse.redirect(
      new URL(returnTo ?? `/${locale}/account`, origin),
    );

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    };

    /* セッション cookie を response に直接載せる。
     *
     * **何をどれだけの寿命で書くかは `lib/shopify/session-cookies.ts` が正本**。
     * 以前ここは `shop_at` / `shop_exp` / `shop_auth` にアクセストークンの寿命
     * (`tokens.expires_in`) を maxAge として付けていた。数時間で消えるので、
     * 30 日の `shop_rt` を持っていても `getSession()` は null を返し、利用者は
     * 無言でログアウトしていた (as-is D-1)。いまは 4 つとも 30 日で、
     * アクセストークンの期限は `shop_exp` の**中身**が持つ。
     *
     * 書き込み先が response と cookie store の 2 通りあるので「書く動作」は
     * 1 本にできないが、定義は共有している (リフレッシュ側は
     * `lib/shopify/auth.ts` の `setSessionCookies`)。 */
    const sessionCookies = buildSessionCookieWrites({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      encrypt: encryptToken,
    });

    response.cookies.set("shop_at", sessionCookies.accessToken.value, {
      ...cookieOptions,
      maxAge: sessionCookies.accessToken.maxAge,
    });
    response.cookies.set("shop_rt", sessionCookies.refreshToken.value, {
      ...cookieOptions,
      maxAge: sessionCookies.refreshToken.maxAge,
    });
    response.cookies.set("shop_exp", sessionCookies.expiresAt.value, {
      ...cookieOptions,
      maxAge: sessionCookies.expiresAt.maxAge,
    });
    response.cookies.set("shop_auth", sessionCookies.authFlag.value, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: sessionCookies.authFlag.maxAge,
    });

    // Preserve the id_token so we can pass it as `id_token_hint` to the
    // Shopify logout endpoint at sign-out time. Without this, RP-initiated
    // logout cannot identify the session to terminate and Shopify SSO
    // cookies are left in place (causing silent re-login on shared PCs).
    response.cookies.set("shop_it", encryptToken(tokens.id_token), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30, // 30 days (must outlive access token)
    });

    /* Cache the Shopify Customer ID. It comes from the **verified** claims above,
     * not from a second unchecked decode of the same string — so `shop_cid` can
     * only ever hold an id that survived signature + nonce verification. Saves a
     * Customer API call per request.
     *
     * It is OPTIONAL. When `sub` does not carry an id we recognise, the cookie is
     * simply not written and `requireAuth` falls back to its Customer API path —
     * a slower request, not a failed login. Making this mandatory is what broke
     * every email login in production on 2026-08-22 (`sub_missing`); see
     * `extractCustomerId` in `lib/shopify/id-token.ts`. */
    const customerId = verified.customerId;
    if (customerId) {
      response.cookies.set("shop_cid", encryptToken(customerId), {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 30, // 30 days (same as refresh token)
      });
    }

    // Clean up PKCE cookies
    response.cookies.delete("shop_cv");
    response.cookies.delete("shop_state");
    response.cookies.delete("shop_nonce");
    response.cookies.delete("shop_locale");
    // One-shot: the return path is consumed by this redirect and must not leak
    // into the next login.
    response.cookies.delete("shop_return_to");

    /* このブラウザが LINE セッションも持ったまま Shopify OAuth を終えた。
     * **連携済みの人なら**、まだ `users/line:<id>/` に残っている分をここで
     * 顧客の棚へ引き取る。
     *
     * ## cookie の同居だけでは動かない（挙動を変えた箇所）
     *
     * 以前はここが `line_uid` cookie の**存在だけ**を条件に合体していた。
     * その LINE と、いまログインした顧客が同じ人かは確かめていない。共用端末に
     * 前の人の LINE セッションが残っていれば、その人のお気に入りが次の人の棚へ
     * 移る（PR #100 の B5 が現状として固定していた挙動）。
     *
     * いまは `completeLineLinkage` を通す。連携台帳に「この LINE ↔ この顧客」の
     * 行があるときだけ合体する。連携していない人はここで何も起きない — 合体は
     * 連携の 3 経路（連携ボタン / LIFF / ここ）が共有する 1 か所に寄せてあり、
     * 台帳が意思の記録である以上、その行を持たない人のデータを動かす理由が無い。
     *
     * 連携済みの人にとって、ここは**取りこぼしの再試行**になる。合体は失敗した
     * 分を必ず元の場所に残し、かつ冪等なので、ログインのたびに安全に通せる。
     *
     * ログインは決して失敗させない。`completeLineLinkage` は throw せず、
     * 起きたことを自分で記録する。 */
    const lineUidEnc = request.cookies.get("line_uid")?.value;
    if (lineUidEnc && customerId) {
      const lineUserId = decryptToken(lineUidEnc);

      /* ── ワンタップ連携（J-1 案A）─────────────────────────────────
       *
       * この人はマイページで「メールアドレスと連携する」を押して出て行ったのか。
       * それを言えるのは、押した瞬間にしか作られない封筒だけである
       * （`lib/auth/link-intent.ts`）。封筒があり、10 分以内で、**いまの LINE と
       * 束縛が取れている**ときにだけ、ここで台帳に行を立てる。
       *
       * G1（cookie の同居を意思の代わりにしない）はこれで満たす。同居している
       * だけでは何も起きない — 下の `completeLineLinkage` は台帳に行がある人しか
       * 動かさないまま。緩めたのは「意思の運び方」だけで、「本人でなくてよい」に
       * は一切していない。
       *
       * ⚠ 封筒は**結果によらず必ず消す**（1 回きり）。成功しても失敗しても、
       *   同じ意思が 2 度目の連携に流用されてはならない。 */
      const intent = openLinkIntent(
        request.cookies.get(LINK_INTENT_COOKIE)?.value,
        lineUserId,
      );
      response.cookies.delete(LINK_INTENT_COOKIE);

      let oneTapOutcome: Awaited<
        ReturnType<typeof establishLinkageFromIntent>
      > | null = null;
      if (intent.ok && customerId) {
        oneTapOutcome = await establishLinkageFromIntent({
          lineUserId: intent.lineUserId,
          shopifyCustomerId: customerId,
        });
      } else if (!intent.ok && intent.reason !== "absent") {
        /* 封筒はあったのに使えなかった。**通常運転ではない**ので残す。
           識別子は載せない（reason だけで切り分けられる）。 */
        console.warn(
          `[one-tap-link] intent present but unusable (reason=${intent.reason})`,
        );
      }

      /* 台帳に行が立ったなら、その事実を根拠に合体する（M-2 と同じ立て付け。
         書いた側より確かな情報源は無いので、HTTP で引き直さない）。
         立たなかった / そもそも押していないなら、従来どおり取りこぼしの再試行。 */
      const completion = !lineUserId
        ? null
        : oneTapOutcome?.ok
          ? await applyLinkageEstablished({
              lineUserId,
              shopifyCustomerId: customerId,
              source: "auth-callback",
            })
          : await completeLineLinkage({
              lineUserId,
              shopifyCustomerId: customerId,
              source: "auth-callback",
            });

      /* LINE セッションを捨てるのは、**実際に合体まで到達したときだけ**。
       *
       * ## 直している割れ方 (F16)
       *
       * ここは以前 `completeLineLinkage` の結果を見ずに掃除していた。合体の側は
       * B5 を閉じるために「台帳に行があるときだけ動く」へ厳しくなったのに、掃除の
       * 側は「`line_uid` cookie が同居していた」という**古い条件のまま**だった。
       * 二つの条件がずれた結果、未連携の人が体験するのはこうなる:
       *
       *   1. LINE だけで使っていた人がメールでログインする
       *   2. 台帳に行が無いので合体は起きない — お気に入りは `users/line:<id>/` に残る
       *   3. それでも LINE cookie 4 本が消える
       *   4. その人はもう `line:` の棚へ戻る入口を持たない。保存したものが消えたように見える
       *
       * 掃除が正当化されるのは「この browser の LINE 分はもう顧客の棚にある」ときで、
       * それを言えるのは `merged` だけ。以下はいずれも**温存する**:
       *
       *   - `not-linked` / `linked-elsewhere` … 合体していない。棚は `line:` 側に残って
       *     いるので、入口を奪うと取り戻す手段が無くなる（＝上の割れ方そのもの）
       *   - `ledger-unreadable` … 台帳が読めない。**推測しない**。合体側が推測を避けて
       *     いるのに掃除側だけ「たぶん連携済み」に倒すと、非対称がまた割れ目になる
       *   - `merge-failed` … 一致は取れたが元が残っている。cookie を残すことが次回
       *     ログインでの**取りこぼし再試行の唯一の燃料**（`line_uid` が無ければこの
       *     ブロックにすら入らない）。ここで消すと再試行の道を自分で塞ぐ
       *   - `same-key` / `invalid-input` … 何も起きていない
       *   - 復号に失敗した (`completion === null`) … 何を消してよいか判断できていない
       *
       * 温存しても Shopify セッションの側は妨げない。ヘッダの表示は `shop_auth` を
       * 見て切り替わり、`line_auth` の同居はログイン状態の判定を変えない。
       *
       * ## 掃除するときは両スコープで消す（既存の担保・維持）
       *
       * この掃除は以前、共有 Domain を `new URL(origin).hostname` から自前で計算し、
       * その host が apex に見えたときだけ Domain スコープの delete を出していた
       * （どちらの場合も 2 スコープのうち 1 つしか出ない）。Next 16 では `origin` が
       * `nextUrl.origin` 由来でリクエストの Host を無視するため、apex 以外の origin
       * では Domain スコープの LINE cookie が**一度も消えていなかった**。常に両方を
       * 出す単一正本に委譲してある。 */
      if (completion?.outcome === "merged") {
        clearAuthCookies(response, "line");
      }
    }

    // Send welcome email for new members (no order history = first registration)
    // Run async without blocking the redirect
    void (async () => {
      try {
        const customer = await getCustomer(tokens.access_token);
        if (customer) {
          const isNewMember = customer.orders.edges.length === 0;
          if (isNewMember) {
            const customerName =
              [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
              "Guest";
            const customerEmail = customer.emailAddress?.emailAddress;
            if (customerEmail) {
              await sendWelcomeEmail({
                customerEmail,
                customerName,
                locale: locale as "ja" | "en",
              });
            }
          }
        }
      } catch (err) {
        // Non-blocking: welcome email failure should not affect login
        console.error("[Auth Callback] Welcome email error:", err);
      }
    })();

    return response;
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${origin}/${locale}/account?error=auth_failed`
    );
  }
}

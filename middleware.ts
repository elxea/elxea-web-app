import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { hasShopifySessionCookies } from "./lib/auth/cookies";
import { env } from "./lib/config";
import { routing } from "./i18n/routing";
import { defaultLocale, disabledLocales } from "./i18n/config";

const intlMiddleware = createMiddleware(routing);

/**
 * 公開を止めている locale の接頭辞にだけ当たる正規表現。`disabledLocales` が
 * 空 (= 全 locale 公開) のときは `null` にする。空配列から素朴に
 * `^/(?:)(?=/|$)` を組むと**全 path に一致**して全ページを既定 locale へ
 * 飛ばしてしまうため、正規表現そのものを作らない。
 */
const DISABLED_LOCALE_PREFIX =
  disabledLocales.length > 0
    ? new RegExp(`^/(?:${disabledLocales.join("|")})(?=/|$)`)
    : null;

const SITE_PASSWORD = env("SITE_PASSWORD");

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

/**
 * Vercel Preview デプロイかどうか。
 *
 * ここは以前「Preview ではサイトパスワードを掛けない」という**素通し**の判定
 * だった。理由は「Preview URL は推測不能なのでそれ自体が到達制限になる」「毎回
 * パスワードを打たせるのはオーナーへの手動操作要求だ」というもので、動機は
 * 正しかったが前提が誤っていた。
 *
 * 2026-08-25 の環境分離監査で、その Preview デプロイが **Preview スコープに
 * 本番級の資格情報**を持つことが実測で確定した (Firebase Admin 秘密鍵 /
 * Shopify Admin トークン / Resend API キー / Upstash 書き込みトークン)。加えて
 * 本番と**同じ LINE ログインチャネル**を使い、**同じ Sentry / GTM / Vercel
 * Blob** に書き込み、Firestore の fail-closed 判定 (`isProductionRuntime`) は
 * `VERCEL` 変数を見るため Preview を「本番」と見なして素通りさせる。
 *
 * つまり「本番 elxea.com はパスワードで閉じているのに、本番と同じ資格情報を
 * 持つ Preview は誰でも開ける」という状態だった。URL の推測不能性は、URL が
 * Referer・ブラウザ履歴・拡張機能・スクリーンショット・チャットログのどれかに
 * 一度でも漏れた瞬間に消える性質の防御で、資格情報の重さに釣り合わない。
 *
 * よって判定を反転させ、いまは **Preview を本番と同じゲートの内側に入れ、
 * かつ fail-closed にする**ために使う。`VERCEL_ENV` は Vercel が自動注入する
 * 値なので、判定そのものは引き続きコードだけで完結する。
 */
const IS_VERCEL_PREVIEW = env("VERCEL_ENV") === "preview";

/**
 * `SITE_PASSWORD` が入っていない Preview デプロイを丸ごと閉じる応答。
 *
 * `checkSitePassword` の先頭は `if (!SITE_PASSWORD) return null` = **fail-open**
 * で、これは本番では正しい: 公開ローンチのときに Production スコープから
 * `SITE_PASSWORD` を外すと、そのままサイトが開く、というのが意図した運用。
 *
 * ところが同じ fail-open が Preview に効くと、ゲートを掛けたつもりで env の
 * 設定漏れひとつ (Preview スコープに `SITE_PASSWORD` が無い) が**無言で**元の
 * 全公開状態に戻る。上のコメントのとおり Preview は本番級の資格情報を持つので、
 * ここだけは「設定が無い = 閉じる」に倒す。閉じ忘れは事故になるが、開き忘れは
 * 503 として即座に目に見える。
 */
function previewMisconfiguredResponse(): NextResponse {
  return new NextResponse(
    "This preview deployment is not configured for public access.\n" +
      "Set SITE_PASSWORD in the Vercel Preview environment scope.\n",
    {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        // 検索エンジンにも掴ませない (503 でも念のため)
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}

/**
 * 本番 (`VERCEL_ENV=production`) かどうか。`/dev/*` を本番だけ閉じるために使う。
 *
 * Preview と同じく Vercel が自動注入する値だけで判定するので、ダッシュボード
 * 操作も env の追加も要らない。ローカル (`VERCEL_ENV` 未設定) は false なので
 * 開発時の `/dev/*` はこれまでどおり開く。
 */
const IS_VERCEL_PRODUCTION = env("VERCEL_ENV") === "production";

async function checkSitePassword(request: NextRequest): Promise<NextResponse | null> {
  if (!SITE_PASSWORD) {
    // 本番・ローカルは従来どおり fail-open (公開ローンチ = env を外す運用)。
    // Preview だけは fail-closed にする (previewMisconfiguredResponse の解説)。
    return IS_VERCEL_PREVIEW ? previewMisconfiguredResponse() : null;
  }

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

  /* 規約・プライバシーポリシー等の法定ページ (/legal/*) は門の外に出す。
   *
   * ## なぜ必要か (M-0 の前提整備)
   *
   * LINE ログインの email scope (LINE に登録されたメールアドレスの取得) は LINE の
   * 審査を通らないと使えない。審査では**プライバシーポリシーの URL に実際にアクセスして
   * 内容を読む**。サイトパスワードの門が立っていると、審査側に見えるのは
   * `/password` へのリダイレクトだけで、**何を書いてあっても読まれない**。
   *
   * ## 何も晒していない
   *
   * `/legal/*` は規約・プライバシーポリシー・特商法表記・返品ポリシーで、いずれも
   * **公開が前提の静的な文書**である。顧客データも操作口も持たない。門の目的は
   * 「公開前の商品・体験を見せない」ことなので、公開が前提の文書を対象から外しても
   * 目的は損なわれない。むしろ特商法表記のように**掲示が義務**の文書もある。
   *
   * `/liff` / `/link` と同じ形で、locale prefix の有無どちらでも当たるようにする。 */
  if (/^\/(?:(?:ja|en)\/)?legal(?:\/|$)/.test(pathname)) return null;

  // Redirect to password page
  const passwordUrl = new URL("/password", request.url);
  return NextResponse.redirect(passwordUrl);
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Site-wide password protection (staging/preview)
  const passwordResponse = await checkSitePassword(request);
  if (passwordResponse) return passwordResponse;

  // `/dev/*` はロケール接頭辞を持たない (下のブロックの理由)。人がプレビュー
  // URL を手で打つときは他ページの癖で `/ja/dev/...` と書きがちで、そのままだと
  // `app/[locale]/dev/` が無いので 404 になる。接頭辞を落として同じ面へ送る。
  // 正規の URL はあくまで接頭辞なしの `/dev/*` なので、恒久扱いにならない 307。
  const localizedDev = pathname.match(/^\/(?:ja|en)(\/dev(?:\/.*)?)$/);
  if (localizedDev) {
    const devUrl = new URL(localizedDev[1], request.url);
    devUrl.search = request.nextUrl.search;
    return NextResponse.redirect(devUrl, 307);
  }

  // 実装確認用のプレビュー面 (`/dev/*`) は i18n の外に置く。
  // next-intl のミドルウェアを通すと `/dev/...` が `/ja/dev/...` へ飛ばされるが、
  // ルートは `app/dev/` (= `[locale]` の外) にあるので 404 になる。ここで手前に
  // 抜けることでロケール接頭辞なしのまま到達できる。
  // サイトパスワードの検査より **後** に置いてあるのは意図的で、staging では
  // このプレビューにもパスワードが掛かる (公開面を増やさない)。
  if (pathname === "/dev" || pathname.startsWith("/dev/")) {
    // 本番では存在しない扱いにする。`/dev/*` は実装確認用のプレビュー面で、
    // ナビゲーションからリンクしていない・`robots` も noindex にしてあるが、
    // それは「見つけにくい」だけで到達はできる。公開後はサイトパスワードが
    // 外れて誰でも URL を叩けるので、noindex では公開面に出ないことを保証
    // できない。ここで 404 を返して**本番だけ**確実に閉じる。
    //
    // 判定は URL 単位でしか要らないので、ルート自体は消さない (削除すると
    // preview でもレビューできなくなる)。preview / ローカルは素通り。
    if (IS_VERCEL_PRODUCTION) {
      return new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.next();
  }

  // 公開を止めている locale (`i18n/config.ts` の `enabledLocales` が正本) を
  // 既定 locale へ 301 で寄せる。主系は `next.config.ts` の `redirects()` で、
  // こちらは多層防御。
  //
  // 旧実装は `pathname.startsWith("/en")` だったが、これは `/entry` のような
  // **`en` で始まるだけの path** まで巻き込んで `/jatry` へ飛ばす。セグメント
  // 境界 (`/` か終端) を見るようにして塞いだ。
  if (DISABLED_LOCALE_PREFIX) {
    const match = pathname.match(DISABLED_LOCALE_PREFIX);
    if (match) {
      const redirectUrl = new URL(
        pathname.replace(DISABLED_LOCALE_PREFIX, `/${defaultLocale}`),
        request.url,
      );
      redirectUrl.search = request.nextUrl.search;
      return NextResponse.redirect(redirectUrl, 301);
    }
  }

  // Check if this is an /account route that needs auth
  const accountMatch = pathname.match(/^\/(ja|en)\/account/);
  if (accountMatch) {
    /* 判定は `lib/auth/cookies.ts` の 1 実装に寄せる。
     *
     * 以前ここは `shop_at && shop_rt` と自前で書いていた。`shop_at` は
     * アクセストークンの寿命で消えるので、30 日のリフレッシュトークンを持って
     * いる人まで数時間でログイン画面へ弾かれていた (as-is D-1)。判定が 2 か所に
     * あると、片方だけ直して「サーバは通すのに門だけ閉まる」状態になる。 */
    const hasShopifySession = hasShopifySessionCookies((name) =>
      request.cookies.has(name),
    );
    const hasLineSession = request.cookies.has("line_session");
    if (!hasShopifySession && !hasLineSession) {
      // P3-fix: Redirect to /login (not Shopify OAuth) so LINE users can choose their login method
      const locale = accountMatch[1];
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
    }
  }

  /* Shopify のセッションを持ったまま /login を開いたときはマイページへ送る。
   *
   * ## なぜ素通しではいけないのか
   *
   * 素通しすると「LINE でログイン」「メールアドレスでログイン」がそのまま出る。
   * 既に入っている人がそこで別の方法を押すと **もう 1 つアカウントを作る** 経路に
   * 入ってしまう (二重アカウント)。ログイン中であることも告げないので、押す前に
   * 気づく手がかりも無い。
   *
   * ## なぜ LINE だけの人は飛ばさないのか (ここを間違えると連携が死ぬ)
   *
   * LINE だけで入っている人にとって、この画面の「メールアドレスでログイン」は
   * **アカウントを連携する唯一の入口**である (LINE ログイン → メールログイン →
   * 合体、が正規の連携経路)。ここで飛ばすと連携そのものに到達できなくなる。
   * よって門を閉じるのは「もう得るものが無い = Shopify セッションがある」ときだけに
   * 限り、LINE だけの人には画面の上で「もう LINE で入っている」と伝える
   * (`app/[locale]/login/page.tsx` の案内)。
   *
   * ## 例外: 認証フローの戻り先としての /login
   *
   * `?error=` (認証失敗) と `?linked=` (連携完了) は、ログイン画面の上でしか
   * 出せない案内で、`app/[locale]/login/` の 2 つのバナーがこれを読んで描く。
   * ここで飛ばすと失敗理由も連携成功も伝わらないまま消えるので、クエリが付いて
   * いるときは素通しする。
   */
  const loginMatch = pathname.match(/^\/(ja|en)\/login\/?$/);
  if (loginMatch) {
    const isAuthFlowReturn =
      request.nextUrl.searchParams.has("error") ||
      request.nextUrl.searchParams.has("linked");
    const signedIn = hasShopifySessionCookies((name) => request.cookies.has(name));
    if (signedIn && !isAuthFlowReturn) {
      const locale = loginMatch[1];
      const target = new URL(`/${locale}/account`, request.url);
      // 飛ばされた理由をマイページ側で 1 行案内するための印 (AccountNotice が読む)。
      target.searchParams.set("notice", "already-signed-in");
      return NextResponse.redirect(target);
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

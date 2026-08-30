"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { autoLoginFailedInSearch } from "@/lib/line/auto-login";

import { channelMisconfiguredInSearch } from "./auth-error-keys";

/**
 * Suspense の fallback 用。`LineLoginButton` は `useSearchParams` を使うため
 * 境界が要り、その間も同じ形のボタンが出ていないと画面が跳ねる。
 *
 * 中身を `LineLoginButton` の loading 分岐と揃えてあるのは意図的で、境界が解ける
 * 瞬間に見た目が変わらないようにするため。
 */
export function LineLoginButtonFallback({ children }: { children: React.ReactNode }) {
  return (
    <Button disabled aria-busy="true" className="w-full shadow-xs">
      {children}
    </Button>
  );
}

/**
 * LINE Login button — Direct OAuth 2.0 via <a href> to access.line.me.
 *
 * 見た目は Figma【R2: 確定版】6893:17349 (ログイン) に従う = primary 塗り / h36 /
 * ラベルのみ。R2 で LINE ブランド緑 (#06C755) とブランドアイコンは廃止された。
 *
 * CRITICAL DESIGN DECISIONS (do not change without reading):
 *
 * 1. The <a href> must point DIRECTLY at a LINE-owned host, not at an
 *    elxea-owned endpoint that server-redirects. Chrome iOS will not fire
 *    LINE's Universal Link through a 302 from a first-party URL; Safari iOS
 *    is more lenient but we standardize on the strict path.
 *    We fetch the fully-formed URL from POST /api/line-login/init on mount
 *    (which also sets the HttpOnly state cookie).
 *
 *    WHICH LINE host it is depends on the caller's environment and is decided
 *    server-side, in ONE place (lib/line/authorize-url.ts):
 *      - auto login works here (iOS Safari / Android / LINE in-app / unknown)
 *        -> https://access.line.me/oauth2/v2.1/authorize?...
 *      - auto login is documented NOT to work (iOS non-Safari, in-app webviews)
 *        -> https://access-auto.line.me/oauth2/v2.1/login?returnUri=...
 *           which is the host+path LINE registers in its
 *           apple-app-site-association / assetlinks.json, i.e. the only URL a
 *           tap can actually hand to the LINE app. access.line.me is NOT in any
 *           association file, so a tap there can never open the app by itself.
 *    Do not reintroduce a hard-coded host here; read whatever init returns.
 *
 * 2. DO NOT use LIFF SDK (liff.login())
 *    - LIFF SDK does NOT open the LINE app from external browsers.
 *
 * 3. DO NOT use JavaScript redirects (window.location, router.push)
 *    - iOS/Android Universal Links only fire on user-initiated <a> taps.
 *
 * 4. DO NOT use form action / server action
 *    - Server-side redirects from form submissions don't trigger Universal Links.
 *
 * 5. The button is disabled until the init fetch resolves. The fetch is fast
 *    (single HTTP round-trip, no external I/O), typically <100ms on good
 *    networks, so users almost never see the disabled state.
 *
 * 6. Rules 1, 3 and 4 are not stylistic — they are the whole mechanism by which
 *    a phone opens the LINE app instead of the access.line.me email/QR screen.
 *    That hand-off is LINE's "auto login", which is on by default and rides on
 *    iOS Universal Links / Android App Links; LINE documents that a JavaScript
 *    redirect or a typed URL will not fire it, and that the fix is to let the
 *    user tap a link. No parameter can force it. When the OS refuses anyway, the
 *    callback flags it and this component retries with auto login disabled so
 *    the user does not loop. See lib/line/auto-login.ts.
 */
export function LineLoginButton({ children }: { children: React.ReactNode }) {
  const t = useTranslations("login");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  /* Distinguishes "still loading" from "this deployment cannot do LINE login".
   * Both used to render the same permanently-disabled button with a spinner
   * that never resolved, which reads as a hang rather than as a state. */
  const [unavailable, setUnavailable] = useState(false);

  /* 直前の往復が `invalid_client` で落ちていたなら、押せるボタンを出さない。
   *
   * `/api/line-login/init` は **チャネル ID だけ**で認可 URL を組み立てられるので、
   * Channel Secret が壊れていても 200 を返す。つまり下の 503 判定はこの壊れ方を
   * 拾えない — 失敗は 1 往復先の token 交換まで進まないと現れない。バナーで
   * 「復旧作業中」と伝えたうえでボタンを押せるままにすると、人は押し、必ず同じ
   * ところで落ちて、同じ画面に戻ってくる。それが 2026-08-22 / 2026-08-25 に実際に
   * 起きていた無限リトライで、止めるには入口を閉じるしかない。
   *
   * これは URL から**導出される値**なので state に持たず、レンダー中に計算する
   * (effect で setState すると連鎖レンダーになる / react-hooks の
   * `set-state-in-effect`)。`/login` を開き直せば通常状態に戻るので、復旧後に
   * 画面が固まったままになることもない。 */
  const searchParams = useSearchParams();
  const channelMisconfigured = channelMisconfiguredInSearch(searchParams.toString());

  useEffect(() => {
    let cancelled = false;

    // 押せないと決まっている回は、init を呼ぶ意味が無い。
    if (channelMisconfigured) return;

    /* ここには以前「localStorage の会話 ID を `chat_session_id` cookie に書き写す」
     * 処理があった。LINE の callback がそれを読んで cx-agent に連携させるためだが、
     * **ブラウザが自分で書いた値を identity の根拠にしていた**ので、他人の会話 ID を
     * 入れて押すだけでその会話を奪えた。会話 ID の発行はサーバ (`/api/chat/session`)
     * に一本化し、callback は署名済み `chat_sid` を読むようにしたので、ここで
     * 渡すものは何も無い。 */

    /* If we arrived here because auto login just failed, ask for an authorize
     * URL that skips auto login. Otherwise auto login is left on — it is the
     * only documented path into the LINE app, and it is on by default.
     * See lib/line/auto-login.ts. */
    const retryWithoutAutoLogin = autoLoginFailedInSearch(window.location.search);

    fetch(
      retryWithoutAutoLogin
        ? "/api/line-login/init?disable_auto_login=1"
        : "/api/line-login/init",
      {
        method: "POST",
        credentials: "same-origin",
      },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { authUrl?: string }) => {
        if (!cancelled && data.authUrl) setAuthUrl(data.authUrl);
      })
      .catch((status: unknown) => {
        /* 503 is the server saying "not configured / host not registered here" —
         * a settled state, not a transient failure, so stop showing a busy
         * control the user can never complete. Anything else keeps the previous
         * behaviour (stay busy; a refresh may succeed). */
        if (!cancelled && status === 503) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [channelMisconfigured]);

  /* 押しても直らないと分かっている状態は、押せない見た目にする。`unavailable`
     (init が 503) と `channelMisconfigured` (token 交換が invalid_client) は
     起点が違うが、利用者にとっては同じ「今は使えない」なので同じ姿にする。 */
  if (unavailable || channelMisconfigured) {
    return (
      <Button disabled className="w-full shadow-xs">
        {t("lineButtonUnavailable")}
      </Button>
    );
  }

  if (!authUrl) {
    return (
      <Button disabled aria-busy="true" className="w-full shadow-xs">
        {children}
      </Button>
    );
  }

  return (
    <Button asChild className="w-full shadow-xs">
      {/* Intentional: <a> with external href (authUrl) required for Universal Links to open the LINE app. Must NOT be <Link>. no-html-link-for-pages does not fire here (external href), so no disable directive is needed. */}
      <a href={authUrl}>
        {children}
      </a>
    </Button>
  );
}

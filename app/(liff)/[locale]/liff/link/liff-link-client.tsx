"use client";

/**
 * LIFF 連携ページ（案A 第1弾）— クライアント側フロー。
 *
 * 動作環境: LINE アプリ内ブラウザ（Bot のメニュー / メッセージから開かれる LIFF）。
 * 目的: このトーク（Messaging）の userId と、ご購入時の Shopify アカウントを結び付ける。
 *
 * フロー:
 *   1. @line/liff を動的 import → liff.init(liffId)。
 *   2. liff.getIDToken() で ID トークン（LINE 署名済み JWT）を取得（無ければ liff.login()）。
 *   3. 同一オリジンの /api/user/line-link-liff に idToken を POST。
 *      - サーバが Shopify セッションから customer_id を確定し、id_token を LINE verify で検証、
 *        cx-agent の customer_linkages に冪等 upsert する（詳細はサーバ側コメント）。
 *   4. 結果に応じて 完了 / ログイン導線 / 静かなエラー を表示。
 *
 * 文言方針（ブランド体験原則）: 静かで丁寧・絵文字なし・押し売りなし。エラーは原因を詮索させず
 *   「時間をおいてもう一度」に寄せる。
 */

import { useCallback, useEffect, useState } from "react";
import { bodyClass, overlineClass } from "@/components/editorial/rule-list";
import { PillButton, pillClass } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";

type Phase =
  | "loading" // 初期化・通信中
  | "success" // 連携完了
  | "needs_shopify_login" // Shopify 未ログイン
  | "error" // 静かな失敗
  | "unavailable"; // 設定未完（LIFF_ID 未投入 等）

/** ロケール別の逐語コピー（絵文字なし・静か）。 */
const COPY = {
  ja: {
    title: "アカウント連携",
    loading: "連携の準備をしています。少々お待ちください。",
    successTitle: "連携が完了しました",
    // 連携先に注文/定期便があるとき（CX S2・過大約束にならない）。
    successBodyWithActivity:
      "ご購入時のアカウントとこのトークを結び付けました。ご注文や定期便の状況を、このままメッセージでご確認いただけます。",
    // 注文/定期便が無い（またはまだ確認できない）とき: 誰にでも成立する「好みに合わせたご案内」だけを約束する。
    successBodyNoActivity:
      "ご購入時のアカウントとこのトークを結び付けました。これからは、あなたの好みに合わせたご案内を、このトークで受け取れるようになります。",
    close: "トークに戻る",
    loginTitle: "ログインが必要です",
    loginBody:
      "連携には、ご購入時のアカウントへのログインが必要です。ログイン後、もう一度このページを開いてください。",
    loginCta: "ログインする",
    errorTitle: "連携できませんでした",
    errorBody: "連携できませんでした。時間をおいてもう一度お試しください。",
    retry: "もう一度試す",
    unavailableBody:
      "ただいま連携をご利用いただけません。時間をおいてもう一度お試しください。",
  },
  en: {
    title: "Account linking",
    loading: "Preparing to link your account. Please wait a moment.",
    successTitle: "Linking complete",
    successBodyWithActivity:
      "We've connected your account with this chat. You can now check your orders and subscription right here in the chat.",
    successBodyNoActivity:
      "We've connected your account with this chat. From now on, you'll receive suggestions tailored to your taste right here.",
    close: "Back to chat",
    loginTitle: "Sign in required",
    loginBody:
      "To link your account, please sign in with the account you used at purchase, then open this page again.",
    loginCta: "Sign in",
    errorTitle: "Couldn't link your account",
    errorBody: "We couldn't link your account. Please try again in a little while.",
    retry: "Try again",
    unavailableBody:
      "Account linking is not available right now. Please try again in a little while.",
  },
} as const;

type Locale = keyof typeof COPY;

export function LiffLinkClient({ locale }: { locale: string }) {
  const t = COPY[(locale as Locale) in COPY ? (locale as Locale) : "ja"];
  const [phase, setPhase] = useState<Phase>("loading");
  // 連携先に注文/定期便があるか（完了画面コピーの過大約束回避・CX S2）。未確認は false（安全側）。
  const [hasActivity, setHasActivity] = useState(false);

  const run = useCallback(async () => {
    setPhase("loading");

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      // LINE Developers コンソールでの LIFF 登録・LIFF_ID 投入が未了。静かに案内。
      setPhase("unavailable");
      return;
    }

    let idToken: string | null = null;
    try {
      // SSR を避けるため動的 import。
      const liffModule = await import("@line/liff");
      const liff = liffModule.default;
      await liff.init({ liffId });

      // LINE 未ログインなら login（アプリ内ブラウザでは通常 init で解決済み）。
      if (!liff.isLoggedIn()) {
        liff.login();
        return; // リダイレクトで戻ってきて再実行される。
      }

      idToken = liff.getIDToken();
      if (!idToken) {
        // トークンが取れない（scope 不足等）→ login で ID トークン発行を促す。
        liff.login();
        return;
      }
    } catch (err) {
      console.warn("[liff-link] liff init/token failed:", err);
      setPhase("error");
      return;
    }

    // サーバプロキシへ送信（Shopify セッション・id_token 検証・cx-agent upsert はサーバが実施）。
    try {
      const res = await fetch("/api/user/line-link-liff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ idToken }),
      });

      if (res.ok) {
        // 完了画面の文面分岐用に「注文/定期便あり」フラグを受け取る（欠落/非JSON は false = 過大約束しない）。
        const data = (await res.json().catch(() => ({}))) as {
          hasPurchaseActivity?: boolean;
        };
        setHasActivity(data.hasPurchaseActivity === true);
        setPhase("success");
        return;
      }

      // Shopify 未ログイン → ログイン導線を出す。
      if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as {
          needsShopifyLogin?: boolean;
        };
        if (data.needsShopifyLogin) {
          setPhase("needs_shopify_login");
          return;
        }
      }

      setPhase("error");
    } catch (err) {
      console.warn("[liff-link] link request failed:", err);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const closeLiff = useCallback(async () => {
    try {
      const liffModule = await import("@line/liff");
      const liff = liffModule.default;
      if (liff.isInClient()) {
        liff.closeWindow();
      }
    } catch {
      // no-op（外部ブラウザ等ではウィンドウを閉じられない）
    }
  }, []);

  /* 本文 (`body` トークン 16 / 行高 1.75)。測度は Figma のテキスト枠 PC 640 に
     合わせる (`max-w-160`)。SP は page-inset の外余白で 343 に収まる。 */
  const bodyTextClass = cn(bodyClass, "max-w-160 text-muted-foreground");

  return (
    <>
      {/*
       * LinkBand — 左揃えの帯 (Figma 8316:779 / 8316:871 / 8316:967 ほか)。
       *
       * roji 確定版の作法どおり、内容は帯の左肩から始める。中央寄せのカードに
       * しないのは、この面だけがサイトの他のページと違う組み方になるため
       * (見出し・本文の左端が揃っているのがこのブランドの読ませ方)。
       *
       * Figma 実測 (px) → 実装:
       * - 帯の高さ            384                          → `min-h-96`
       * - 左端                SP 16 / PC 64                → `page-inset` (--page-margin)
       * - アクセント罫の上端  SP 64 / PC 112               → `pt-16 lg:pt-28`
       * - アクセント罫        w32 h2 / accent              → `h-0.5 w-8 bg-accent`
       * - 要素間              20 (罫→キッカー→見出し→本文) → `gap-5`
       * - 測度                PC 640 / SP 343              → `max-w-160` + page-inset
       */}
      <section
        data-slot="link-band"
        className="page-inset flex min-h-96 flex-col items-start gap-5 pt-16 lg:pt-28"
      >
        {/* アクセント罫。意味を持たない装飾なので支援技術からは隠す。 */}
        <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-accent" />

        {/* キッカーは overline ティア (12 / 600 / tracking .125em)。生の text-xs +
            tracking-widest ではトークン変更に追従しないため使わない。 */}
        <p className={cn(overlineClass, "text-muted-foreground")}>{t.title}</p>

        {phase === "loading" && (
          <p className={bodyTextClass} role="status" aria-live="polite">
            {t.loading}
          </p>
        )}

        {/* 見出しは要素そのまま (globals.css の `h1 { font: var(--typography-style-h1) }`
            = 32px)。`.page-title` (md+ で 44px) は当てない — Figma 確定版の LIFF は
            PC 8316:874 も SP 8317:1018 も高さ 38 = 32 x 1.2 で、PC でも 32 だから。
            ページ主見出しの全体裁定 (PC 44 / SP 32) はサイトの chrome を持つ面の
            ものであり、chrome を外したこの面は対象外。 */}
        {phase === "success" && (
          <>
            <h1 className="max-w-160">{t.successTitle}</h1>
            <p className={bodyTextClass}>
              {hasActivity ? t.successBodyWithActivity : t.successBodyNoActivity}
            </p>
          </>
        )}

        {phase === "needs_shopify_login" && (
          <>
            <h1 className="max-w-160">{t.loginTitle}</h1>
            <p className={bodyTextClass}>{t.loginBody}</p>
          </>
        )}

        {phase === "error" && (
          <>
            <h1 className="max-w-160">{t.errorTitle}</h1>
            <p className={bodyTextClass}>{t.errorBody}</p>
          </>
        )}

        {phase === "unavailable" && <p className={bodyTextClass}>{t.unavailableBody}</p>}
      </section>

      {/*
       * NextAction — 1 画面 1 アクション (Figma 8316:876 / 8317:1020 ほか)。
       * 帯の外に置き、幅は内容なり・左端は帯と揃える。
       * 上下余白 SP 48 (`py-12`) / PC 22 → 実装 24 (`lg:py-6`、spacing scale の最寄り)。
       * style は Figma のインスタンスどおり: ログイン = solid (主要導線 / 8317:1040 は
       * primary 面)、トークに戻る・もう一度試す = outline (副次導線 / 8316:877)。
       */}
      {phase === "success" && (
        <div className="page-inset py-12 lg:py-6">
          <PillButton pillStyle="outline" onClick={closeLiff}>
            {t.close}
          </PillButton>
        </div>
      )}

      {phase === "needs_shopify_login" && (
        <div className="page-inset py-12 lg:py-6">
          {/* Shopify Customer Account OAuth（locale を渡してログイン後 /account に戻る）。 */}
          <a className={pillClass("solid")} href={`/api/auth/login?locale=${encodeURIComponent(locale)}`}>
            {t.loginCta}
          </a>
        </div>
      )}

      {phase === "error" && (
        <div className="page-inset py-12 lg:py-6">
          <PillButton pillStyle="outline" onClick={() => void run()}>
            {t.retry}
          </PillButton>
        </div>
      )}
    </>
  );
}

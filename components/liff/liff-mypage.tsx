"use client";

/**
 * LIFF マイページコンポーネント
 *
 * LINE 内でユーザーに「マイページ」として表示される画面。
 * フロー:
 *   1. LIFF 初期化 + LINE ログイン確認
 *   2. LINE user ID 取得
 *   3. Shopify セッション確認（shop_auth cookie）
 *   4. LINE user ID を Firestore に保存（/api/user/line-link）
 *   5. マイページ（お茶プロフィール）表示
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLiff } from "./liff-provider";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type LinkStatus =
  | "idle"
  | "linking"
  | "linked"
  | "shopify_auth_required"
  | "error";

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

type LiffMyPageProps = {
  /** Locale for Shopify login redirect */
  locale: string;
};

export function LiffMyPage({ locale }: LiffMyPageProps) {
  const { state, lineUserId, displayName, login } = useLiff();
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("idle");
  const [linkError, setLinkError] = useState<string | null>(null);

  const performLink = useCallback(
    async (uid: string) => {
      setLinkStatus("linking");
      setLinkError(null);

      try {
        const res = await fetch("/api/user/line-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineUserId: uid }),
        });

        if (res.status === 401) {
          // Shopify login required — redirect to Shopify OAuth
          setLinkStatus("shopify_auth_required");
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        setLinkStatus("linked");
      } catch (err) {
        setLinkError(err instanceof Error ? err.message : String(err));
        setLinkStatus("error");
      }
    },
    []
  );

  // Auto-link when LIFF is ready and LINE user ID is available
  useEffect(() => {
    if (
      state.status === "ready" &&
      state.isLoggedIn &&
      lineUserId &&
      linkStatus === "idle"
    ) {
      performLink(lineUserId);
    }
  }, [state, lineUserId, linkStatus, performLink]);

  // --------------------------------------------------------------------------
  // Render states
  // --------------------------------------------------------------------------

  if (state.status === "idle" || state.status === "initializing") {
    return <LiffLoadingScreen />;
  }

  if (state.status === "error") {
    return (
      <LiffErrorScreen
        message={`LINE の読み込みに失敗しました: ${state.message}`}
      />
    );
  }

  // LINE not logged in
  if (state.status === "ready" && !state.isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-6">
        <p className="text-sm text-muted-foreground text-center">
          マイページを開くには LINE でログインしてください
        </p>
        <Button onClick={login} className="w-full max-w-xs">
          LINE でログイン
        </Button>
      </div>
    );
  }

  // Shopify auth required
  if (linkStatus === "shopify_auth_required") {
    const loginUrl = `/api/auth/login?locale=${locale}&liff_return=1`;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 gap-6">
        <h1 className="text-lg font-medium text-center">マイページ</h1>
        <p className="text-sm text-muted-foreground text-center">
          elxea アカウントでログインするとマイページが利用できます
        </p>
        <Button asChild className="w-full max-w-xs">
          <a href={loginUrl}>elxea アカウントでログイン</a>
        </Button>
      </div>
    );
  }

  if (linkStatus === "linking") {
    return <LiffLoadingScreen message="マイページを準備しています..." />;
  }

  if (linkStatus === "error") {
    return (
      <LiffErrorScreen
        message={`連携に失敗しました: ${linkError ?? "不明なエラー"}`}
        onRetry={() => {
          setLinkStatus("idle");
          setLinkError(null);
        }}
      />
    );
  }

  // Successfully linked — show the Tea Profile
  return (
    <div className="min-h-screen flex flex-col px-6 py-10 gap-8">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          <span className="text-lg select-none">🍃</span>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">マイページ</p>
          <p className="text-sm font-medium">{displayName ?? "ゲスト"}</p>
        </div>
      </header>

      <TeaProfileCard />

      <AccountLinksSection locale={locale} />
    </div>
  );
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function LiffLoadingScreen({ message = "読み込み中..." }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground animate-pulse">{message}</p>
    </div>
  );
}

function LiffErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4">
      <p className="text-sm text-muted-foreground text-center">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="w-full max-w-xs">
          もう一度試す
        </Button>
      )}
    </div>
  );
}

function TeaProfileCard() {
  return (
    <section className="rounded-2xl border bg-card p-6 space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        お茶のプロフィール
      </h2>
      <p className="text-xs text-muted-foreground">
        あなたのお茶の好みや購買履歴をもとに、パーソナルなプロフィールが作成されます。
        まだ情報が十分ではありません。引き続き elxea をお楽しみください。
      </p>
    </section>
  );
}

function AccountLinksSection({ locale }: { locale: string }) {
  const links = [
    { label: "ジャーナル", href: `/${locale}/journal` },
    { label: "お気に入り", href: `/${locale}/account` },
    { label: "ショップ", href: `/${locale}/collections/all` },
  ];

  return (
    <nav className="space-y-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm hover:bg-accent transition-colors"
        >
          <span>{link.label}</span>
          <span className="text-muted-foreground">›</span>
        </a>
      ))}
    </nav>
  );
}

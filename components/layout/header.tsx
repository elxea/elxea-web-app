"use client";

import { useState, useSyncExternalStore, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCart } from "@/components/cart/cart-context";
import { cn } from "@/lib/utils";
import { AudioToggle } from "@/components/audio/audio-toggle";
import { Logo } from "./logo";
import { ChevronRight, Menu, X } from "lucide-react";

/**
 * SP メニュー展開 UI のトークン束縛 — Figma SoT「開閉UI / R1: SPメニュー展開 — SP 375」
 * (file AWLnI0XF07e8rScuxPYPc7 / node 7967:1326)。生 px は書かず、すべて
 * `--typography-style-*` / spacing utility / brand color token 経由で表現する。
 */
// Nav 行ラベル: Figma 20px → h3 プリセット (1.25rem / 400)
const SP_NAV_LABEL =
  "[font:var(--typography-style-h3)] [letter-spacing:var(--typography-style-h3-tracking)]";
// 検索 (Input Underline) ラベル: Figma 24px → h2 プリセット (1.5rem / 400)
const SP_SEARCH_LABEL =
  "[font:var(--typography-style-h2)] [letter-spacing:var(--typography-style-h2-tracking)]";
// アカウント導線: Figma 14px → body-sm プリセット (0.875rem / 400)
const SP_ACCOUNT_LABEL =
  "[font:var(--typography-style-body-sm)] [letter-spacing:var(--typography-style-body-sm-tracking)]";

function subscribeToCookies(callback: () => void) {
  // Re-check cookies on storage/visibilitychange events
  window.addEventListener("visibilitychange", callback);
  return () => window.removeEventListener("visibilitychange", callback);
}

function getCookieLoginSnapshot(): boolean {
  return (
    document.cookie.includes("shop_auth=1") ||
    document.cookie.includes("line_user=")
  );
}

function getServerSnapshot(): boolean {
  return false;
}

type NavItem = { href: string; label: string };
type HeaderProps = { navItems?: NavItem[] };

export function Header({ navItems: externalNavItems }: HeaderProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // P1-fix: Recognize both Shopify and LINE sessions as "logged in"
  // Use useSyncExternalStore to read cookie state without setState-in-effect
  const subscribeWithPathname = useCallback(
    (callback: () => void) => subscribeToCookies(callback),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname change triggers re-subscribe to re-snapshot
    [pathname],
  );
  const isLoggedIn = useSyncExternalStore(
    subscribeWithPathname,
    getCookieLoginSnapshot,
    getServerSnapshot,
  );
  const { cart } = useCart();
  const cartCount = cart?.totalQuantity ?? 0;

  const navItems =
    externalNavItems && externalNavItems.length > 0
      ? externalNavItems
      : [
          { href: "/products", label: t("products") },
          { href: "/subscription", label: t("subscription") },
          { href: "/journal", label: t("journal") },
          { href: "/tea-menu", label: t("teaMenu") },
          { href: "/playlists", label: t("playlists") },
          { href: "/farmers", label: t("farmers") },
          { href: "/events", label: t("events") },
        ];

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      {/*
        Figma Header (Module) 5653:29 / Header SP (Module) 7970:42126 が正本。

        PC 1440 実測:
        - Top Bar 高さ 68 (SP 60) …… component.header.height.*
        - Header / Logo   x=64 (= layout.grid.margin.desktop) 左端固定
        - Header / Right Cluster  x=237 w=1139 右端 1376 (= 1440 - 64) …… 右寄せ 1 段
          - Header / Nav     w=706、項目間 8px (spacing.2)、項目高 36px (spacing.9)
          - Header / Actions x=730 (Nav 右端 706 との差 = 24px / spacing.6)、項目間 8px
            順序: Audio Toggle → 検索 → ログイン → カート

        SP 375 実測: ロゴ x=16 (= layout.grid.margin.mobile) 左 / MenuTrigger 右端 359。

        従来コードはロゴ中央 + nav 下段の 2 段 IA で、ロゴ左端実測 722px と
        Figma 64px が乖離していた。本改修で 1 段 IA に是正する。

        意図的な差分 (Setaka 裁定 2026-08-08「SP ヘッダーのカートは常時表示」で確定):
        SP のカートリンク。Figma SP (7970:42126) はロゴ + MenuTrigger のみだが、
        カートは SP でも常時表示する。並び順のみ Figma に合わせ
        (ロゴ左 / MenuTrigger 右端)、カートはその直前に置く。
        回帰テストは `e2e/mobile.spec.ts` の "cart link is always visible on mobile"。
      */}
      <div className="page-container">
        <div className="flex items-center h-(--component-header-height-mobile) md:h-(--component-header-height-desktop)">
          {/* Logo — 左端 (PC x=64 / SP x=16 = page-container の外余白と同値) */}
          <Link href="/" className="flex items-center">
            <Logo size="sm" priority />
          </Link>

          {/* Header / Right Cluster — Nav と Actions を 24px (spacing.6) で分ける */}
          <div className="ml-auto flex items-center gap-6">
            {/* Header / Nav — 項目間 8px (spacing.2) / 項目高 36px (spacing.9) */}
            <nav className="hidden md:flex items-center gap-2">
              {navItems.map((item) => (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  className={`h-9 ${
                    pathname.startsWith(item.href)
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                  asChild
                >
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </nav>

            {/* Header / Actions — 項目間 8px (spacing.2) */}
            <div className="flex items-center gap-2">
              <AudioToggle className="hidden sm:flex" />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground hidden sm:inline-flex"
                asChild
              >
                <Link href="/search">{t("search")}</Link>
              </Button>
              {isLoggedIn ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 text-muted-foreground hidden sm:inline-flex"
                    asChild
                  >
                    <Link href="/account">{t("account")}</Link>
                  </Button>
                  {/* P5-fix: Desktop logout link for all logged-in users */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 text-muted-foreground hidden sm:inline-flex"
                    asChild
                  >
                    <a href={`/api/auth/logout?locale=${locale}`}>
                      {t("logout")}
                    </a>
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-muted-foreground hidden sm:inline-flex"
                  asChild
                >
                  <Link href="/login">{t("login")}</Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground relative"
                asChild
              >
                <Link href="/cart">
                  {t("cart")}
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-foreground text-background text-[10px] font-medium size-4 flex items-center justify-center">
                      {cartCount > 99 ? "99+" : cartCount}
                    </span>
                  )}
                </Link>
              </Button>

              {/* MenuTrigger (Module) — SP nav。Figma SP では右端 x=323 w=36。 */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden -mr-2"
                    aria-label="Menu"
                  >
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                {/*
                  SP メニュー展開 — Figma SoT「開閉UI / R1: SPメニュー展開 — SP 375」
                  (7967:1326)。画面全幅のオーバーレイで 4 ブロック構成:
                    1. SP Header (展開時) 7967:1327  h=56 / p-16 / Logo 左・✕ 右端
                    2. Nav (展開メニュー)   7967:1336  px-16 py-24 / 行 py-16 + 罫線 stone
                    3. 検索 (Input Underline) 7967:42098 px-16 py-24 / 下線 2px
                    4. アカウント導線      7967:42101 px-16 pt-24 pb-32 / gap-24

                  Figma との意図的な差分:
                  - AudioToggle: Figma フレームに無いが SP からの唯一の導線のため
                    アカウント導線の末尾に残す (機能欠落を避ける)。
                  - Nav 項目: Figma は 6 件 (About を含む) のサンプルだが、実装は
                    ルートが実在する navItems を SoT とする (IA は別判断)。
                  - 「タップで閉じる: …」注記は Figma 上の仕様注記であり UI コピーでは
                    ない。閉じる手段 (外側タップ / ✕ / Esc) は Radix Dialog が担保する。
                */}
                <SheetContent
                  side="right"
                  showCloseButton={false}
                  className="w-full max-w-full gap-0 overflow-y-auto border-l-0 p-0 sm:max-w-full"
                >
                  {/* 1. SP Header (展開時) — p-4 (16px) で h=16+24+16=56 */}
                  <div className="flex items-center justify-between p-4">
                    <SheetTitle className="flex items-center">
                      <Logo size="sm" />
                      <span className="sr-only">Menu</span>
                    </SheetTitle>
                    <SheetClose
                      aria-label="Close"
                      className="text-brand-graphite transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    >
                      <X className="size-6" />
                    </SheetClose>
                  </div>

                  {/* 2. Nav (展開メニュー) */}
                  <nav className="flex flex-col px-4 py-6">
                    {navItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center justify-between border-b border-brand-stone py-4 text-brand-graphite",
                          SP_NAV_LABEL,
                          pathname.startsWith(item.href) && "font-medium",
                        )}
                      >
                        <span>{item.label}</span>
                        <ChevronRight className="size-4 shrink-0" />
                      </Link>
                    ))}
                  </nav>

                  {/* 3. 検索 (Input Underline) — 下線 2px / ラベル中央 */}
                  <div className="px-4 py-6">
                    <Link
                      href="/search"
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex w-full flex-col items-center border-b-2 border-border pt-2 pb-4 text-center text-muted-foreground",
                        SP_SEARCH_LABEL,
                      )}
                    >
                      {t("search")}
                    </Link>
                  </div>

                  {/* 4. アカウント導線 */}
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-6 px-4 pt-6 pb-8 text-brand-graphite",
                      SP_ACCOUNT_LABEL,
                    )}
                  >
                    {isLoggedIn ? (
                      <>
                        <Link
                          href="/account"
                          onClick={() => setMobileOpen(false)}
                        >
                          {t("account")}
                        </Link>
                        {/* P5-fix: Logout link accessible to all logged-in users including LINE-only */}
                        <a
                          href={`/api/auth/logout?locale=${locale}`}
                          onClick={() => setMobileOpen(false)}
                        >
                          {t("logout")}
                        </a>
                      </>
                    ) : (
                      <Link href="/login" onClick={() => setMobileOpen(false)}>
                        {t("login")}
                      </Link>
                    )}
                    <Link href="/cart" onClick={() => setMobileOpen(false)}>
                      {t("cart")} ({cartCount})
                    </Link>
                    <AudioToggle />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

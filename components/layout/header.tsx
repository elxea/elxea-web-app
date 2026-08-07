"use client";

import { useState, useSyncExternalStore, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/components/cart/cart-context";
import { AudioToggle } from "@/components/audio/audio-toggle";
import { Logo } from "./logo";
import { Menu } from "lucide-react";

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

        意図的な差分 (要 Setaka 確認): SP のカートリンク。Figma SP はロゴ +
        MenuTrigger のみだが、`e2e/mobile.spec.ts` の
        "cart link is always visible on mobile" が既存のプロダクト判断として
        SP 常時表示を要求しているため残す。並び順のみ Figma に合わせ
        (ロゴ左 / MenuTrigger 右端)、カートはその直前に置く。
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
                <SheetContent side="left" className="w-72">
                  <SheetHeader>
                    <SheetTitle>
                      <Logo size="sm" />
                    </SheetTitle>
                  </SheetHeader>
                  <nav className="flex flex-col gap-1 mt-6">
                    {navItems.map((item) => (
                      <Button
                        key={item.href}
                        variant="ghost"
                        className={`justify-start ${
                          pathname.startsWith(item.href)
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        }`}
                        asChild
                      >
                        <Link
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                        >
                          {item.label}
                        </Link>
                      </Button>
                    ))}
                    <Separator className="my-2" />
                    <div className="px-4 py-2 sm:hidden">
                      <AudioToggle className="items-start" />
                    </div>
                    <Separator className="my-2 sm:hidden" />
                    <Button
                      variant="ghost"
                      className="justify-start text-muted-foreground sm:hidden"
                      asChild
                    >
                      <Link href="/search" onClick={() => setMobileOpen(false)}>
                        {t("search")}
                      </Link>
                    </Button>
                    {isLoggedIn ? (
                      <>
                        <Button
                          variant="ghost"
                          className="justify-start text-muted-foreground sm:hidden"
                          asChild
                        >
                          <Link
                            href="/account"
                            onClick={() => setMobileOpen(false)}
                          >
                            {t("account")}
                          </Link>
                        </Button>
                        {/* P5-fix: Logout link accessible to all logged-in users including LINE-only */}
                        <Button
                          variant="ghost"
                          className="justify-start text-muted-foreground sm:hidden"
                          asChild
                        >
                          <a
                            href={`/api/auth/logout?locale=${locale}`}
                            onClick={() => setMobileOpen(false)}
                          >
                            {t("logout")}
                          </a>
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        className="justify-start text-muted-foreground sm:hidden"
                        asChild
                      >
                        <Link
                          href="/login"
                          onClick={() => setMobileOpen(false)}
                        >
                          {t("login")}
                        </Link>
                      </Button>
                    )}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

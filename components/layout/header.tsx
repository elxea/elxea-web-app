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
    [pathname]
  );
  const isLoggedIn = useSyncExternalStore(
    subscribeWithPathname,
    getCookieLoginSnapshot,
    getServerSnapshot
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
      {/* Main header */}
      <div className="page-container">
        {/* Figma Header (Module) 5653:29 = 68px (SP 7970:42126 = 60px)。
            高さは component.header.height.* トークンに束縛する (h-16 直書きは 64px
            で Figma と 4px ずれていた)。 */}
        <div className="flex items-center justify-between h-(--component-header-height-mobile) md:h-(--component-header-height-desktop)">
          {/* Mobile menu button */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden -ml-2"
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
                  <Link
                    href="/search"
                    onClick={() => setMobileOpen(false)}
                  >
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

          {/* Logo — centered */}
          <Link
            href="/"
            className="absolute left-1/2 -translate-x-1/2"
          >
            <Logo size="sm" priority />
          </Link>

          {/* Right actions */}
          <div className="flex items-center gap-1 ml-auto">
            <AudioToggle className="hidden sm:flex mr-2" />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hidden sm:inline-flex"
              asChild
            >
              <Link href="/search">{t("search")}</Link>
            </Button>
            {isLoggedIn ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hidden sm:inline-flex"
                  asChild
                >
                  <Link href="/account">{t("account")}</Link>
                </Button>
                {/* P5-fix: Desktop logout link for all logged-in users */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hidden sm:inline-flex"
                  asChild
                >
                  <a href={`/api/auth/logout?locale=${locale}`}>{t("logout")}</a>
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hidden sm:inline-flex"
                asChild
              >
                <Link href="/login">{t("login")}</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground relative"
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
          </div>
        </div>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center justify-center gap-1 pb-4">
          {navItems.map((item) => (
            <Button
              key={item.href}
              variant="ghost"
              size="sm"
              className={
                pathname.startsWith(item.href)
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              }
              asChild
            >
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
      </div>
    </header>
  );
}

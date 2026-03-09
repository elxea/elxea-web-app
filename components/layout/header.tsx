"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Menu } from "lucide-react";

export function Header() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(document.cookie.includes("shop_auth=1"));
  }, [pathname]);

  const navItems = [
    { href: "/products", label: t("products") },
    { href: "/journal", label: t("journal") },
    { href: "/farmers", label: t("farmers") },
    { href: "/events", label: t("events") },
  ];

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      {/* Main header */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
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
                  <Image src="/logo.png" alt="elxea" width={80} height={19} />
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
                ) : (
                  <Button
                    variant="ghost"
                    className="justify-start text-muted-foreground sm:hidden"
                    asChild
                  >
                    <a
                      href={`/api/auth/login?locale=${locale}`}
                      onClick={() => setMobileOpen(false)}
                    >
                      {t("login")}
                    </a>
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
            <Image
              src="/logo.png"
              alt="elxea"
              width={100}
              height={24}
              priority
            />
          </Link>

          {/* Right actions */}
          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hidden sm:inline-flex"
              asChild
            >
              <Link href="/search">{t("search")}</Link>
            </Button>
            {isLoggedIn ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hidden sm:inline-flex"
                asChild
              >
                <Link href="/account">{t("account")}</Link>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hidden sm:inline-flex"
                asChild
              >
                <a href={`/api/auth/login?locale=${locale}`}>{t("login")}</a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              asChild
            >
              <Link href="/cart">{t("cart")}</Link>
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

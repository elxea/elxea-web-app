"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale } from "next-intl";

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
    { href: "/subscription", label: t("subscription") },
    { href: "/journal", label: t("journal") },
    { href: "/farmers", label: t("farmers") },
    { href: "/events", label: t("events") },
  ];

  return (
    <header className="border-b border-border bg-cream sticky top-0 z-50">
      {/* Main header */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 -ml-2 text-charcoal"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4l12 12M16 4L4 16" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 5h16M2 10h16M2 15h16" />
              </svg>
            )}
          </button>

          {/* Logo — centered */}
          <Link
            href="/"
            className="absolute left-1/2 -translate-x-1/2 text-xl tracking-[0.15em] font-light uppercase"
          >
            elxea
          </Link>

          {/* Right actions */}
          <div className="flex items-center gap-5 ml-auto">
            <Link
              href="/search"
              className="text-[13px] text-muted hover:text-charcoal transition-colors hidden sm:block"
            >
              {t("search")}
            </Link>
            {isLoggedIn ? (
              <Link
                href="/account"
                className="text-[13px] text-muted hover:text-charcoal transition-colors hidden sm:block"
              >
                {t("account")}
              </Link>
            ) : (
              <a
                href={`/api/auth/login?locale=${locale}`}
                className="text-[13px] text-muted hover:text-charcoal transition-colors hidden sm:block"
              >
                {t("login")}
              </a>
            )}
            <Link
              href="/cart"
              className="text-[13px] text-muted hover:text-charcoal transition-colors"
            >
              {t("cart")}
            </Link>
          </div>
        </div>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center justify-center gap-8 pb-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-[13px] font-medium transition-colors ${
                pathname.startsWith(item.href)
                  ? "text-charcoal"
                  : "text-muted hover:text-charcoal"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Mobile navigation */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-border bg-cream">
          <div className="px-6 py-6 space-y-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block text-sm ${
                  pathname.startsWith(item.href)
                    ? "text-charcoal font-medium"
                    : "text-muted"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-4 border-t border-border space-y-4">
              <Link
                href="/search"
                className="block text-sm text-muted sm:hidden"
                onClick={() => setMobileOpen(false)}
              >
                {t("search")}
              </Link>
              {isLoggedIn ? (
                <Link
                  href="/account"
                  className="block text-sm text-muted sm:hidden"
                  onClick={() => setMobileOpen(false)}
                >
                  {t("account")}
                </Link>
              ) : (
                <a
                  href={`/api/auth/login?locale=${locale}`}
                  className="block text-sm text-muted sm:hidden"
                  onClick={() => setMobileOpen(false)}
                >
                  {t("login")}
                </a>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

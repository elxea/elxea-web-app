"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { Separator } from "@/components/ui/separator";

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="border-t border-border mt-auto bg-background">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-12">
          {/* Brand */}
          <div>
            <Image
              src="/logo.png"
              alt="elxea"
              width={100}
              height={24}
              className="mb-4"
            />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("home.tagline")}
            </p>
          </div>

          {/* Shop */}
          <div>
            <p className="text-sm font-medium mb-5">{t("footer.shop")}</p>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/products"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.products")}
                </Link>
              </li>
              <li>
                <Link
                  href="/collections"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.collections")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Content */}
          <div>
            <p className="text-sm font-medium mb-5">{t("footer.content")}</p>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/journal"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.journal")}
                </Link>
              </li>
              <li>
                <Link
                  href="/tea-menu"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.teaMenu")}
                </Link>
              </li>
              <li>
                <Link
                  href="/playlists"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.playlists")}
                </Link>
              </li>
              <li>
                <Link
                  href="/elxea-journal"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  elxea Journal
                </Link>
              </li>
              <li>
                <Link
                  href="/farmers"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.farmers")}
                </Link>
              </li>
              <li>
                <Link
                  href="/events"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.events")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <p className="text-sm font-medium mb-5">{t("footer.support")}</p>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/about"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.about")}
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.faq")}
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.contact")}
                </Link>
              </li>
              <li>
                <Link
                  href="/shipping"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.shipping")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Language */}
          <div>
            <p className="text-sm font-medium mb-5">{t("common.language")}</p>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Legal links + Copyright */}
        <Separator className="mt-12" />
        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/legal/tokushoho"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("legal.tokushoho")}
            </Link>
            <Link
              href="/legal/privacy"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("legal.privacy")}
            </Link>
            <Link
              href="/legal/terms"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("legal.terms")}
            </Link>
            <Link
              href="/legal/returns"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("legal.returns")}
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="border-t border-border mt-auto bg-cream">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <p className="text-xl tracking-[0.15em] font-light uppercase mb-4">
              elxea
            </p>
            <p className="text-[13px] text-muted leading-relaxed">
              Specialty coffee & tea
            </p>
          </div>

          {/* Shop */}
          <div>
            <p className="text-[13px] font-medium mb-5">Shop</p>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/products"
                  className="text-[13px] text-muted hover:text-charcoal transition-colors"
                >
                  {t("common.products")}
                </Link>
              </li>
              <li>
                <Link
                  href="/collections"
                  className="text-[13px] text-muted hover:text-charcoal transition-colors"
                >
                  {t("common.collections")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Content */}
          <div>
            <p className="text-[13px] font-medium mb-5">Content</p>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/journal"
                  className="text-[13px] text-muted hover:text-charcoal transition-colors"
                >
                  {t("common.journal")}
                </Link>
              </li>
              <li>
                <Link
                  href="/farmers"
                  className="text-[13px] text-muted hover:text-charcoal transition-colors"
                >
                  {t("common.farmers")}
                </Link>
              </li>
              <li>
                <Link
                  href="/events"
                  className="text-[13px] text-muted hover:text-charcoal transition-colors"
                >
                  {t("common.events")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Language */}
          <div>
            <p className="text-[13px] font-medium mb-5">{t("common.language")}</p>
            <LanguageSwitcher />
          </div>
        </div>

        <div className="border-t border-border mt-12 pt-8">
          <p className="text-[12px] text-light">
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}

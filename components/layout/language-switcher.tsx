"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/config";

const localeLabels: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  function handleChange(newLocale: Locale) {
    router.replace(pathname, { locale: newLocale });
  }

  return (
    <div className="flex gap-3">
      {locales.map((l) => (
        <button
          key={l}
          onClick={() => handleChange(l)}
          className={`text-[13px] transition-colors ${
            locale === l
              ? "text-charcoal font-medium"
              : "text-muted hover:text-charcoal"
          }`}
        >
          {localeLabels[l]}
        </button>
      ))}
    </div>
  );
}

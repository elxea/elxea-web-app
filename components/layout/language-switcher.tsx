"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

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
        <Button
          key={l}
          variant="ghost"
          size="sm"
          onClick={() => handleChange(l)}
          className={
            locale === l
              ? "text-foreground font-medium"
              : "text-muted-foreground"
          }
        >
          {localeLabels[l]}
        </Button>
      ))}
    </div>
  );
}

"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { enabledLocales, type Locale } from "@/i18n/config";
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

  // 公開中の locale が 1 つしかないときは切替 UI 自体を出さない。押しても
  // 何も起きないボタン (あるいは 301 で戻されるだけの「English」) をフッターに
  // 残すと、実装が無いのに選べるように見える。`localeLabels` もコンポーネント
  // 本体も消していないので、`enabledLocales` に locale が戻れば復活する。
  if (enabledLocales.length < 2) return null;

  return (
    <div className="flex gap-3">
      {enabledLocales.map((l) => (
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

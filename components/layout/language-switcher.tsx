"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { enabledLocales, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { useOptimisticNavigation } from "@/hooks/use-optimistic-navigation";

const localeLabels: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  /**
   * 押した瞬間にどちらを選んだかを先に見せる (網羅表 2026-08-27 / G9)。
   *
   * `router.replace` だけを呼んでいたので、選んだ言語が濃く出るのは**サーバの
   * 往復が着地してから**だった。ページ全体が描き直る操作なので着地までは長く、
   * そのあいだ「押したのに何も選ばれていない」状態が見える。
   *
   * 注記: いま `enabledLocales` は `["ja"]` なので、この切替 UI は本番では
   * 描画されない (下の early return)。将来 `"en"` を戻したときに同じ症状を
   * 作り直さないために、いま直しておく。
   */
  const nav = useOptimisticNavigation(locale);

  function handleChange(newLocale: Locale) {
    nav.navigate(newLocale, () => router.replace(pathname, { locale: newLocale }));
  }

  // 公開中の locale が 1 つしかないときは切替 UI 自体を出さない。押しても
  // 何も起きないボタン (あるいは 301 で戻されるだけの「English」) をフッターに
  // 残すと、実装が無いのに選べるように見える。`localeLabels` もコンポーネント
  // 本体も消していないので、`enabledLocales` に locale が戻れば復活する。
  if (enabledLocales.length < 2) return null;

  return (
    <div className="flex gap-3" data-slot="language-switcher" aria-busy={nav.isNavigating}>
      {enabledLocales.map((l) => (
        <Button
          key={l}
          variant="ghost"
          size="sm"
          onClick={() => handleChange(l)}
          /* 押す仕草が見えた時点で相手の言語のページを取りにいく。 */
          onPointerEnter={() => router.prefetch(pathname, { locale: l })}
          onFocus={() => router.prefetch(pathname, { locale: l })}
          data-slot="language-option"
          aria-pressed={nav.value === l}
          className={
            nav.value === l
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

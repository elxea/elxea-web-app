export const locales = ["ja", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ja";

/**
 * 公開する locale — **対応言語の唯一の正本 (single source of truth)**。
 *
 * `locales` は「実装が存在する locale」で、`enabledLocales` は「実際に外から
 * 到達できる locale」。両者を分けてあるのは、英語版のページ・`messages/en.json`・
 * `app/[locale]` のルートを**消さずに**公開だけ止めるため。
 *
 * ---
 * **英語版を出す判断がついたら、この配列に `"en"` を戻すだけでよい。**
 * ---
 *
 * ここから `disabledLocales` が派生し、それを
 *
 * - `next.config.ts` の `redirects()`  … `/en/*` を `/ja/*` へ 308 (全 path・ドット込み)
 * - `middleware.ts`                    … 同上 301 (多層防御)
 * - `app/sitemap.ts`                   … sitemap に載せる locale
 * - `components/layout/language-switcher.tsx` … 言語切替 UI に出す locale
 *
 * が参照する。個々のファイルに locale をベタ書きしないこと
 * (`__tests__/i18n-disabled-locales.test.ts` が正本の一元性を検査している)。
 *
 * 背景: 2026-08-18 Setaka 判断「英語版のページは今はいらない」。英訳自体は
 * `messages/en.json` に揃っているが、ヘッダー/フッター等のサイト chrome は
 * 日本語のまま描画されるため、`lang="en"` で日本語を出す中途半端な面になる。
 */
export const enabledLocales: readonly Locale[] = ["ja"];

/** `locales` のうち公開を止めているもの。`enabledLocales` から自動で決まる。 */
export const disabledLocales: readonly Locale[] = locales.filter(
  (locale) => !enabledLocales.includes(locale),
);

/** 公開中の locale か。 */
export function isEnabledLocale(value: string): value is Locale {
  return (enabledLocales as readonly string[]).includes(value);
}

/** 実装はあるが公開を止めている locale か。 */
export function isDisabledLocale(value: string): value is Locale {
  return (disabledLocales as readonly string[]).includes(value);
}

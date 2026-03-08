import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales } from "@/i18n/config";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { CartProviderWrapper } from "@/components/cart/cart-provider-wrapper";
import { CookieConsent } from "@/components/ui/cookie-consent";
import { GoogleTagManager } from "@/components/analytics/gtm";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "elxea",
    template: "%s | elxea",
  },
  description: "elxea - specialty coffee & tea",
  manifest: "/manifest.json",
  other: {
    "theme-color": "#333333",
  },
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const alternateLocale = locale === "ja" ? "en" : "ja";

  return (
    <html lang={locale} className={inter.className}>
      <head>
        <link rel="alternate" hrefLang={locale} href={`https://elxea.com/${locale}`} />
        <link rel="alternate" hrefLang={alternateLocale} href={`https://elxea.com/${alternateLocale}`} />
        <link rel="alternate" hrefLang="x-default" href="https://elxea.com/ja" />
        <meta name="facebook-domain-verification" content="so8t14i6xbm14emy15c8f2zz3kap2c" />
      </head>
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <GoogleTagManager />
        <NextIntlClientProvider messages={messages}>
          <CartProviderWrapper>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <CookieConsent />
          </CartProviderWrapper>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

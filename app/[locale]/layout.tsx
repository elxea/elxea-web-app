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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "elxea",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "elxea - Specialty Coffee & Tea" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
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

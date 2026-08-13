import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { locales } from "@/i18n/config";
import { TypekitScript } from "@/components/layout/typekit-script";

/**
 * LIFF 専用レイアウト — サイト共通 chrome を持たない面。
 *
 * ## なぜ独立したルートレイアウトなのか
 * Figma 確定版【採用: 現状案で確定】LINE連携 (LIFF) 8316:731 のフレーム名が
 * そのまま要件になっている — 「R1: LIFF専用レイアウト (サイト共通chromeなし)」。
 * 全 8 フレーム (PC 8316:733 / 8316:825 / 8316:921、SP 8317:988 / 1007 / 1026 /
 * 1045 / 1064) のいずれにも Header / Footer / パンくず / チャットバーが無い。
 * この面は LINE アプリ内ブラウザで「連携する」という 1 用件だけのために開かれ、
 * 終わればトークに戻る。サイトの回遊導線を出すと、用件から目を逸らさせるうえ、
 * LINE の中からサイトへ人を逃がすことになる。
 *
 * ネストしたレイアウトでは親の chrome を外せない (子レイアウトは親の内側に入る)
 * ので、`app/[locale]/layout.tsx` の下から出す必要がある。ルートグループ
 * `(liff)` は URL に出ないため、アドレスは `/ja/liff/link` のまま変わらない。
 * 同じ作法を `app/(studio)` が既に採っている (Sanity Studio も chrome 無しの
 * 独立した面で、自前の <html>/<body> を持つ)。`app/layout.tsx` は
 * `return children` の素通しなので、この階層で文書を組み立ててよい。
 *
 * ## ここに置かないもの (置かない理由)
 * - Header / Footer / ChatBar / CookieConsent — 上記のとおり chrome を出さない
 * - CartProvider / LenisProvider / AudioProvider / Toaster — 連携 1 用件の面では
 *   使わない。LINE のアプリ内ブラウザは回線も端末も選べないので、使わない
 *   クライアント JS は載せない
 * - NextIntlClientProvider — この面の文言は `liff-link-client.tsx` の COPY が
 *   正本 (ロケール 2 種の逐語をその場に置く方針)。翻訳フックを使わないので不要
 *
 * ## ここに残すもの (残す理由)
 * - Typekit — 見出しがブランド書体で組まれないと、この面だけ別サービスに見える
 * - `bg-background text-foreground` — 面の地色は DS のセマンティックトークン
 */
export const metadata: Metadata = {
  title: {
    default: "elxea",
    template: "%s | elxea",
  },
  // LINE 内専用の遷移ページ。検索インデックス対象外 (page.tsx 側でも宣言済み)。
  robots: { index: false, follow: false },
};

export default async function LiffLayout({
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

  return (
    // suppressHydrationWarning の理由は TypekitScript の説明を参照
    // (ローダーが hydration 前に <html> の class を書き換えるため)。
    <html lang={locale} suppressHydrationWarning>
      <head>
        <TypekitScript />
      </head>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}

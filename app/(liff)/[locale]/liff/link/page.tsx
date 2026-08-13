import type { Metadata } from "next";
import { LiffLinkClient } from "./liff-link-client";

/**
 * LIFF 連携ページ（案A 第1弾）。
 *
 * LINE アプリ内ブラウザから開かれ、Messaging userId と Shopify アカウントを結び付ける。
 * 実処理は client component（liff-link-client.tsx）とサーバ route（/api/user/line-link-liff）。
 *
 * 検索インデックス対象外（LINE 内専用の遷移ページ）。
 */
export const metadata: Metadata = {
  title: "アカウント連携",
  robots: { index: false, follow: false },
};

export default async function LiffLinkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <LiffLinkClient locale={locale} />;
}

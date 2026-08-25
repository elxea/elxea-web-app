import type { MetadataRoute } from "next";
import { isFictionalSlug } from "@/lib/fictional-content";
import { siteUrl } from "@/lib/site-url";
import { enabledLocales } from "@/i18n/config";

// 環境変数に混ざった改行・末尾スラッシュを落としてから使う。生の値をそのまま
// 連結していたため、本番の <loc> が全件 "https://elxea.com\n/ja/..." になり、
// sitemap のエントリ 172 件がまるごと不正な URL になっていた。
const BASE_URL = siteUrl();

// 載せるのは公開中の locale だけ。公開を止めた locale は `/ja/*` へ恒久
// リダイレクトされるので、載せるとリダイレクト先でしか到達できない URL を
// sitemap に並べることになる。実体のある URL だけを載せる。
//
// **ここに locale をベタ書きしないこと。** 対応言語の正本は `i18n/config.ts` の
// `enabledLocales` 1 箇所で、英語を出す判断がついたらそこに "en" を戻せば
// sitemap・リダイレクト・言語切替 UI がまとめて追従する。
const locales = enabledLocales;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // Static pages
  //
  // `/signs` (みんなの気配) はここに **入れていない**。ページ自体は完成していて
  // フッターの「コンテンツ」列から入れるが、今週の集計 (杯数・人数) と一言は
  // まだ API 未配線で、`app/[locale]/signs/page.tsx` の PLACEHOLDER 定数
  // (Figma の見本値) をそのまま出している。サイトマップは検索エンジンに
  // 「この URL を拾ってほしい」と申告する面なので、実データでない数字を
  // 公開流通に乗せる入口をここで作らない。
  // 入れる条件: 集計と一言が実データに差し替わったとき (= PLACEHOLDER 定数の削除と同時)。
  const staticPages = [
    // 農家一覧 (/farmers) は廃止 (2026-08-14)。農家詳細 (/farmers/[slug]) は
    // 下の Sanity ループで個別に載せる。
    "", "/products", "/collections", "/journal", "/events",
    "/tea-menu", "/playlists", "/elxea-journal", "/about", "/faq", "/contact",
  ];
  for (const locale of locales) {
    for (const page of staticPages) {
      entries.push({
        url: `${BASE_URL}/${locale}${page}`,
        lastModified: new Date(),
        changeFrequency: page === "" ? "daily" : "weekly",
        priority: page === "" ? 1 : 0.8,
      });
    }
  }

  // Dynamic pages from Shopify
  try {
    const { getProducts } = await import("@/lib/shopify");

    const { products } = await getProducts({ first: 100 });
    for (const product of products) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/products/${product.handle}`,
          lastModified: new Date(product.updatedAt),
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
    }

    // コレクション詳細 (/collections/[handle]) は 2026-08-14 に廃止したので
    // 動的エントリは出さない。コレクション一覧 (/collections) は static 側にある。
  } catch {
    // Shopify API not available — skip dynamic product entries
  }

  // Dynamic pages from Sanity
  try {
    const { getClient } = await import("@/sanity/lib/client");
    const client = getClient();

    const articles = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "article" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const article of articles) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/journal/${article.slug}`,
          lastModified: new Date(article._updatedAt),
          changeFrequency: "monthly",
          priority: 0.6,
        });
      }
    }

    const events = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "event" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const event of events) {
      // Skip seed events whose bodies literally contain "ダミー".
      if (isFictionalSlug("event", event.slug)) continue;
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/events/${event.slug}`,
          lastModified: new Date(event._updatedAt),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }

    const farmers = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "farmer" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const farmer of farmers) {
      // Skip fictional/seed farmers hidden until real stories are approved.
      if (isFictionalSlug("farmer", farmer.slug)) continue;
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/farmers/${farmer.slug}`,
          lastModified: new Date(farmer._updatedAt),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }

    // Tea menus
    const teaMenus = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "teaMenu" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const tea of teaMenus) {
      // Skip the seed tea menus (no real tea is published yet).
      if (isFictionalSlug("teaMenu", tea.slug)) continue;
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/tea-menu/${tea.slug}`,
          lastModified: new Date(tea._updatedAt),
          changeFrequency: "monthly",
          priority: 0.6,
        });
      }
    }

    // Playlists
    const playlists = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "playlist" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const pl of playlists) {
      // プレイリストは遮断しない (Setaka 2026-08-26 に 8/22 の非表示判断を上書き)。
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/playlists/${pl.slug}`,
          lastModified: new Date(pl._updatedAt),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }

    // elxea Journals
    const journals = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "journal" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const j of journals) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/elxea-journal/${j.slug}`,
          lastModified: new Date(j._updatedAt),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }

    // Authors/People
    const authors = await client.fetch<{ slug: string; _updatedAt: string }[]>(
      `*[_type == "author" && defined(slug.current)]{ "slug": slug.current, _updatedAt }`
    );
    for (const author of authors) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/people/${author.slug}`,
          lastModified: new Date(author._updatedAt),
          changeFrequency: "monthly",
          priority: 0.4,
        });
      }
    }
  } catch {
    // Sanity not available — skip dynamic content entries
  }

  return entries;
}

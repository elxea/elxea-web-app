import type { MetadataRoute } from "next";
import { isFictionalSlug } from "@/lib/fictional-content";
import { siteUrl } from "@/lib/site-url";

// 環境変数に混ざった改行・末尾スラッシュを落としてから使う。生の値をそのまま
// 連結していたため、本番の <loc> が全件 "https://elxea.com\n/ja/..." になり、
// sitemap のエントリ 172 件がまるごと不正な URL になっていた。
const BASE_URL = siteUrl();

// 出すのは ja だけ。`middleware.ts` が /en/* を /ja/* へ 301 で恒久リダイレクト
// する (英語コンテンツが未完のため) ので、en の URL を載せるとリダイレクト先
// でしか到達できない URL を sitemap に並べることになる。実体のある URL だけを
// 載せる。英語を出す判断がついた時点でここに "en" を戻す。
const locales = ["ja"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // Static pages
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
      // Skip the seed playlists (tracks are a placeholder bgm.mp3).
      if (isFictionalSlug("playlist", pl.slug)) continue;
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

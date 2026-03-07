import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://elxea.com";
const locales = ["ja", "en"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // Static pages
  const staticPages = ["", "/products", "/collections", "/journal", "/farmers", "/events"];
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
    const { getProducts, getCollections } = await import("@/lib/shopify");

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

    const collections = await getCollections();
    for (const collection of collections) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/collections/${collection.handle}`,
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
    }
  } catch {
    // Shopify API not available — skip dynamic product/collection entries
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
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}/${locale}/farmers/${farmer.slug}`,
          lastModified: new Date(farmer._updatedAt),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }
  } catch {
    // Sanity not available — skip dynamic content entries
  }

  return entries;
}

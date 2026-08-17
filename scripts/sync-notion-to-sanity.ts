/**
 * Sync script: Notion Content Hub → Sanity
 * Run with: pnpm sync:notion
 * Dry run:   pnpm sync:notion:dry
 *
 * Fetches articles from Notion Content Hub (Channel=Roji, Status=Published)
 * and syncs them to Sanity as article documents.
 *
 * Configuration comes from `process.env` only (see scripts/lib/sync-env.ts).
 * Locally a `.env` file is loaded *into* process.env for convenience; on a
 * runner the same names arrive as secrets. No value is ever read from a file
 * and used directly, which is what made this script Mac-only.
 *
 * Required:
 *   - NOTION_API_KEY              Notion integration token with Content Hub access
 *   - NOTION_CONTENT_HUB_DB_ID    Content Hub database id
 *   - NEXT_PUBLIC_SANITY_PROJECT_ID
 *   - SANITY_API_WRITE_TOKEN      Sanity token with write access to the dataset
 *
 * Optional:
 *   - NEXT_PUBLIC_SANITY_DATASET  defaults to "production"
 *   - NOTION_PAGE_REGISTRY_DB_ID  required only for --pages / --all
 *   - NOTION_PAGE_CONTENT_DB_ID   required only for --pages / --all
 *   - SLACK_WEBHOOK_URL           failure notifications (scripts/lib/sync-notify.ts)
 */

import { Client as NotionClient } from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { createClient, type SanityClient } from "next-sanity";
import {
  resolveArticleImages,
  type ArticleImageSource,
} from "../lib/notion/article-image";
import { createHash } from "crypto";
import {
  MissingEnvError,
  loadDotEnvIntoProcessEnv,
  optionalEnv,
  requireEnv,
} from "./lib/sync-env";
import {
  EXIT_CODES,
  errText,
  reportSyncResult,
  type SyncOutcome,
} from "./lib/sync-notify";

// ─── Config ──────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

// Local convenience only: populates process.env, no-op on CI. Every read below
// goes through process.env, so local and runner behaviour are identical.
loadDotEnvIntoProcessEnv();

/**
 * A dry run never writes, so it must not require the Sanity write token. That
 * is what lets CI exercise the whole pipeline — checkout, install, Notion read
 * — before the write secret exists.
 */
const REQUIRED_ENV = DRY_RUN
  ? (["NOTION_API_KEY", "NOTION_CONTENT_HUB_DB_ID", "NEXT_PUBLIC_SANITY_PROJECT_ID"] as const)
  : ([
      "NOTION_API_KEY",
      "NOTION_CONTENT_HUB_DB_ID",
      "NEXT_PUBLIC_SANITY_PROJECT_ID",
      "SANITY_API_WRITE_TOKEN",
    ] as const);

const SANITY_DATASET = optionalEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
const SANITY_PROJECT_ID = optionalEnv("NEXT_PUBLIC_SANITY_PROJECT_ID");
const CONTENT_HUB_DB_ID = optionalEnv("NOTION_CONTENT_HUB_DB_ID");
const NOTION_PAGE_REGISTRY_DB_ID = optionalEnv("NOTION_PAGE_REGISTRY_DB_ID");
const NOTION_PAGE_CONTENT_DB_ID = optionalEnv("NOTION_PAGE_CONTENT_DB_ID");

/**
 * Clients are created by `initClients()` rather than at module load.
 *
 * Constructing them eagerly would throw during module evaluation when a secret
 * is absent — before any notifier exists — which is precisely the silent
 * failure this change removes. Validating first means a missing secret is
 * reported like any other outcome.
 */
let notion!: NotionClient;
let sanity!: SanityClient;

function initClients(): void {
  const env = requireEnv(REQUIRED_ENV);

  notion = new NotionClient({ auth: env.NOTION_API_KEY });

  sanity = createClient({
    projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: "2024-01-01",
    useCdn: false,
    // Absent on a dry run by design; no write is attempted in that mode.
    token: optionalEnv("SANITY_API_WRITE_TOKEN") || undefined,
  });
}

/**
 * Which phase the run is in, so that a thrown error can be classified.
 *
 * An error raised while reading Notion means "we do not know what should be
 * published" and must never be reported as "0 articles were published"; an
 * error after that point is a write failure. Reset per sub-sync.
 */
let currentPhase: "input" | "write" = "input";

interface SyncCounts {
  /** Items read from Notion. */
  fetched: number;
  synced: number;
  errors: number;
  /** Slugs that failed, so notifications name the broken articles. */
  failures: string[];
}

// ─── Types ───────────────────────────────────────────────────

interface PageRegistryEntry {
  notionId: string;
  name: string;
  slug: string;
  navLabelJa: string;
  navLabelEn: string;
  navOrder: number;
  showInHeader: boolean;
  showInFooter: boolean;
  footerGroup: string;
  seoTitleJa: string;
  seoTitleEn: string;
  seoDescJa: string;
  seoDescEn: string;
  ogImageUrl: string;
  status: string;
}

interface PageContentEntry {
  key: string;
  pageNotionId: string;
  ja: string;
  en: string;
  fieldType: string;
}

interface ContentHubEntry {
  notionId: string;
  title: string;
  slug: string;
  intro: string;
  /**
   * Sanity `mainImage` source. Asset Hub's `🌐 Roji: Hero Image` (url prop) wins,
   * falling back to the legacy hand-uploaded `Featured Image` (files prop).
   * See lib/notion/article-image.ts for the precedence rules.
   */
  headerImageUrl: string;
  headerImageSource: ArticleImageSource;
  /** Sanity `thumbnail` source. `🌐 Roji: Thumbnail` → header image. */
  thumbnailImageUrl: string;
  thumbnailImageSource: ArticleImageSource;
  metaDescription: string;
  featured: boolean;
  publishedDate: string | null;
  categoryPageIds: string[];
  tagPageIds: string[];
  authorPageIds: string[];
  operationsHubPageIds: string[];
}

// ─── Notion Property Helpers ─────────────────────────────────

function getTitle(page: PageObjectResponse): string {
  const prop = page.properties["Title"];
  if (prop?.type === "title") {
    return prop.title.map((t) => t.plain_text).join("");
  }
  return "";
}

function getText(page: PageObjectResponse, name: string): string {
  const prop = page.properties[name];
  if (prop?.type === "rich_text") {
    return prop.rich_text.map((t) => t.plain_text).join("");
  }
  return "";
}

function getCheckbox(page: PageObjectResponse, name: string): boolean {
  const prop = page.properties[name];
  if (prop?.type === "checkbox") return prop.checkbox;
  return false;
}

function getUrl(page: PageObjectResponse, name: string): string {
  const prop = page.properties[name];
  if (prop?.type === "url") return prop.url || "";
  return "";
}

function getDate(page: PageObjectResponse, name: string): string | null {
  const prop = page.properties[name];
  if (prop?.type === "date" && prop.date) return prop.date.start;
  return null;
}

function getRelationIds(page: PageObjectResponse, name: string): string[] {
  const prop = page.properties[name];
  if (prop?.type === "relation") {
    return prop.relation.map((r) => r.id);
  }
  return [];
}

// NOTE: the former local `getFileUrl` (Notion files property reader) now lives in
// lib/notion/article-image.ts as `readFilesProperty`, next to the Asset Hub URL
// column readers, so the article image precedence has a single tested home.

function getStatus(page: PageObjectResponse, name: string): string {
  const prop = page.properties[name];
  if (prop?.type === "status" && prop.status) return prop.status.name;
  return "";
}

function getSelect(page: PageObjectResponse, name: string): string {
  const prop = page.properties[name];
  if (prop?.type === "select" && prop.select) return prop.select.name;
  return "";
}

// ─── Notion Blocks → Portable Text ──────────────────────────

let keyCounter = 0;
function genKey(): string {
  return `k${Date.now().toString(36)}${(keyCounter++).toString(36)}`;
}

function richTextToSpans(
  richTexts: RichTextItemResponse[]
): { children: unknown[]; markDefs: unknown[] } {
  const children: unknown[] = [];
  const markDefs: unknown[] = [];

  for (const rt of richTexts) {
    const marks: string[] = [];

    if (rt.annotations.bold) marks.push("strong");
    if (rt.annotations.italic) marks.push("em");
    if (rt.annotations.underline) marks.push("underline");

    if (rt.type === "text" && rt.text.link) {
      const linkKey = genKey();
      markDefs.push({
        _type: "link",
        _key: linkKey,
        href: rt.text.link.url,
      });
      marks.push(linkKey);
    }

    children.push({
      _type: "span",
      _key: genKey(),
      text: rt.plain_text,
      marks,
    });
  }

  if (children.length === 0) {
    children.push({
      _type: "span",
      _key: genKey(),
      text: "",
      marks: [],
    });
  }

  return { children, markDefs };
}

async function uploadImageToSanity(
  client: SanityClient,
  imageUrl: string,
  filename?: string
): Promise<{ _type: "reference"; _ref: string } | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const asset = await client.assets.upload("image", buffer, {
      filename: filename || "notion-image",
    });
    return { _type: "reference", _ref: asset._id };
  } catch (err) {
    console.error(`  Failed to upload image: ${imageUrl}`, err);
    return null;
  }
}

async function blocksToPortableText(
  blocks: BlockObjectResponse[],
  client: SanityClient,
  dryRun: boolean
): Promise<unknown[]> {
  const result: unknown[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const { children, markDefs } = richTextToSpans(block.paragraph.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "normal",
          children,
          markDefs,
        });
        break;
      }

      case "heading_2": {
        const { children, markDefs } = richTextToSpans(block.heading_2.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "h2",
          children,
          markDefs,
        });
        break;
      }

      case "heading_3": {
        const { children, markDefs } = richTextToSpans(block.heading_3.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "h3",
          children,
          markDefs,
        });
        break;
      }

      case "heading_1": {
        // Map h1 to h2 (h1 is reserved for article title)
        const { children, markDefs } = richTextToSpans(block.heading_1.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "h2",
          children,
          markDefs,
        });
        break;
      }

      case "bulleted_list_item": {
        const { children, markDefs } = richTextToSpans(
          block.bulleted_list_item.rich_text
        );
        result.push({
          _type: "block",
          _key: genKey(),
          style: "normal",
          listItem: "bullet",
          level: 1,
          children,
          markDefs,
        });
        break;
      }

      case "numbered_list_item": {
        const { children, markDefs } = richTextToSpans(
          block.numbered_list_item.rich_text
        );
        result.push({
          _type: "block",
          _key: genKey(),
          style: "normal",
          listItem: "number",
          level: 1,
          children,
          markDefs,
        });
        break;
      }

      case "quote": {
        const { children, markDefs } = richTextToSpans(block.quote.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "blockquote",
          children,
          markDefs,
        });
        break;
      }

      case "image": {
        const imageUrl =
          block.image.type === "file"
            ? block.image.file.url
            : block.image.type === "external"
              ? block.image.external.url
              : null;

        if (imageUrl) {
          if (dryRun) {
            result.push({
              _type: "image",
              _key: genKey(),
              _dryRun: true,
              _sourceUrl: imageUrl,
            });
          } else {
            const assetRef = await uploadImageToSanity(client, imageUrl);
            if (assetRef) {
              const captionText = block.image.caption
                ?.map((c) => c.plain_text)
                .join("");
              result.push({
                _type: "image",
                _key: genKey(),
                asset: assetRef,
                ...(captionText ? { caption: captionText } : {}),
                alt: captionText || "",
              });
            }
          }
        }
        break;
      }

      case "divider": {
        // Skip dividers — not supported in blockContent schema
        break;
      }

      case "callout": {
        // Convert callout to blockquote
        const { children, markDefs } = richTextToSpans(block.callout.rich_text);
        result.push({
          _type: "block",
          _key: genKey(),
          style: "blockquote",
          children,
          markDefs,
        });
        break;
      }

      default:
        // Skip unsupported block types
        break;
    }
  }

  return result;
}

// ─── Notion Page Title Resolver ──────────────────────────────

const pageTitleCache = new Map<string, string>();
const pageSlugCache = new Map<string, string>();

async function getPageTitle(pageId: string): Promise<string> {
  if (pageTitleCache.has(pageId)) return pageTitleCache.get(pageId)!;
  await fetchPageTitleAndSlug(pageId);
  return pageTitleCache.get(pageId) || "";
}

async function getPageSlug(pageId: string): Promise<string> {
  if (pageSlugCache.has(pageId)) return pageSlugCache.get(pageId) || "";
  await fetchPageTitleAndSlug(pageId);
  return pageSlugCache.get(pageId) || "";
}

async function fetchPageTitleAndSlug(pageId: string): Promise<void> {
  if (pageTitleCache.has(pageId)) return;
  try {
    const page = (await notion.pages.retrieve({
      page_id: pageId,
    })) as PageObjectResponse;

    // Try common title property names
    for (const [, prop] of Object.entries(page.properties)) {
      if (prop.type === "title") {
        const title = prop.title.map((t) => t.plain_text).join("");
        pageTitleCache.set(pageId, title);
        break;
      }
    }
    if (!pageTitleCache.has(pageId)) {
      pageTitleCache.set(pageId, "");
    }

    // Try to get Slug property (available on Roji Categories)
    const slugProp = page.properties["Slug"];
    if (slugProp?.type === "rich_text") {
      const slug = slugProp.rich_text.map((t) => t.plain_text).join("");
      pageSlugCache.set(pageId, slug);
    } else {
      pageSlugCache.set(pageId, "");
    }
  } catch {
    // Page might not be accessible
    pageTitleCache.set(pageId, "");
    pageSlugCache.set(pageId, "");
  }
}

// ─── Slug helpers ────────────────────────────────────────────

function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  // Japanese text produces empty result — use deterministic hash
  if (!result) {
    return createHash("sha256").update(text).digest("hex").slice(0, 12);
  }
  return result;
}

// ─── Category / Tag / Author auto-creation helpers ───────────

async function ensureSanityCategory(
  title: string,
  categoryMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean,
  notionSlug?: string
): Promise<string> {
  if (categoryMap.has(title)) return categoryMap.get(title)!;

  const slug = notionSlug || slugify(title);
  const sanityId = `notion-category-${slug}`;

  if (dryRun) {
    console.log(`  [dry-run] would create category: "${title}" (${sanityId})`);
  } else {
    await client.createOrReplace({
      _id: sanityId,
      _type: "category",
      title,
      slug: { _type: "slug", current: slug },
    });
    console.log(`  -> created category: "${title}" (${sanityId})`);
  }

  categoryMap.set(title, sanityId);
  return sanityId;
}

async function ensureSanityTag(
  title: string,
  tagMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean
): Promise<string> {
  if (tagMap.has(title)) return tagMap.get(title)!;

  const slug = slugify(title);
  const sanityId = `notion-tag-${slug}`;

  if (dryRun) {
    console.log(`  [dry-run] would create tag: "${title}" (${sanityId})`);
  } else {
    await client.createOrReplace({
      _id: sanityId,
      _type: "tag",
      title,
      slug: { _type: "slug", current: slug },
    });
    console.log(`  -> created tag: "${title}" (${sanityId})`);
  }

  tagMap.set(title, sanityId);
  return sanityId;
}

async function ensureSanityAuthor(
  name: string,
  authorMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean
): Promise<string> {
  if (authorMap.has(name)) return authorMap.get(name)!;

  const slug = slugify(name);
  const sanityId = `notion-author-${slug}`;

  if (dryRun) {
    console.log(`  [dry-run] would create author: "${name}" (${sanityId})`);
  } else {
    await client.createOrReplace({
      _id: sanityId,
      _type: "author",
      name,
      slug: { _type: "slug", current: slug },
    });
    console.log(`  -> created author: "${name}" (${sanityId})`);
  }

  authorMap.set(name, sanityId);
  return sanityId;
}

// ─── Category / Tag / Author resolvers ───────────────────────

async function resolveCategories(
  categoryPageIds: string[],
  categoryMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean
): Promise<{ _type: "reference"; _ref: string } | null> {
  // Content Hub categories are from Roji Categories DB which has a Slug field
  // Use the Notion Slug for human-readable Sanity IDs
  for (const pageId of categoryPageIds) {
    const title = await getPageTitle(pageId);
    const notionSlug = await getPageSlug(pageId);
    if (title) {
      const ref = await ensureSanityCategory(title, categoryMap, client, dryRun, notionSlug || undefined);
      return { _type: "reference", _ref: ref };
    }
  }
  return null;
}

async function resolveTags(
  tagPageIds: string[],
  tagMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean
): Promise<{ _type: "reference"; _ref: string; _key: string }[]> {
  const refs: { _type: "reference"; _ref: string; _key: string }[] = [];
  for (const pageId of tagPageIds) {
    const title = await getPageTitle(pageId);
    if (title) {
      const ref = await ensureSanityTag(title, tagMap, client, dryRun);
      refs.push({ _type: "reference", _ref: ref, _key: ref });
    }
  }
  return refs;
}

async function resolveAuthor(
  authorPageIds: string[],
  authorMap: Map<string, string>,
  client: SanityClient,
  dryRun: boolean
): Promise<{ _type: "reference"; _ref: string } | null> {
  for (const pageId of authorPageIds) {
    const title = await getPageTitle(pageId);
    if (title) {
      const ref = await ensureSanityAuthor(title, authorMap, client, dryRun);
      return { _type: "reference", _ref: ref };
    }
  }
  return null;
}

async function resolveOperationsHubProducts(
  opsHubPageIds: string[]
): Promise<string[]> {
  // Operations Hub entries have a "Product Name_Shopify" field we can use as handle
  // Actually, SKU is the title field. We need to look up the Shopify handle.
  // For now, we use the SKU (title) as the product identifier.
  const handles: string[] = [];
  for (const pageId of opsHubPageIds) {
    try {
      const page = (await notion.pages.retrieve({
        page_id: pageId,
      })) as PageObjectResponse;

      // Get Product Name_Shopify or fall back to SKU
      const shopifyName =
        page.properties["Product Name_Shopify"]?.type === "rich_text"
          ? page.properties["Product Name_Shopify"].rich_text
              .map((t) => t.plain_text)
              .join("")
          : "";

      // Get SKU (title field)
      let sku = "";
      for (const [, prop] of Object.entries(page.properties)) {
        if (prop.type === "title") {
          sku = prop.title.map((t) => t.plain_text).join("");
          break;
        }
      }

      // Use the Shopify product name as handle (slugified) or SKU
      if (shopifyName) {
        handles.push(slugify(shopifyName));
      } else if (sku) {
        handles.push(sku);
      }
    } catch {
      // Skip inaccessible pages
    }
  }
  return handles;
}

function getNumber(page: PageObjectResponse, name: string): number {
  const prop = page.properties[name];
  if (prop?.type === "number" && prop.number !== null) return prop.number;
  return 0;
}

// ─── Page Registry Fetch ─────────────────────────────────────

async function fetchPageRegistry(): Promise<PageRegistryEntry[]> {
  const entries: PageRegistryEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: NOTION_PAGE_REGISTRY_DB_ID,
      filter: {
        property: "Status",
        select: { equals: "Published" },
      },
      start_cursor: startCursor,
    });

    for (const page of response.results) {
      if (!("properties" in page)) continue;
      const p = page as PageObjectResponse;

      entries.push({
        notionId: p.id,
        name: getTitle(p),
        slug: getText(p, "Slug"),
        navLabelJa: getText(p, "Nav Label JA"),
        navLabelEn: getText(p, "Nav Label EN"),
        navOrder: getNumber(p, "Nav Order"),
        showInHeader: getCheckbox(p, "Show in Header"),
        showInFooter: getCheckbox(p, "Show in Footer"),
        footerGroup: getSelect(p, "Footer Group"),
        seoTitleJa: getText(p, "SEO Title JA"),
        seoTitleEn: getText(p, "SEO Title EN"),
        seoDescJa: getText(p, "SEO Desc JA"),
        seoDescEn: getText(p, "SEO Desc EN"),
        ogImageUrl: getUrl(p, "OG Image URL"),
        status: getStatus(p, "Status"),
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return entries;
}

// ─── Page Content Fetch ──────────────────────────────────────

async function fetchPageContent(): Promise<PageContentEntry[]> {
  const entries: PageContentEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: NOTION_PAGE_CONTENT_DB_ID,
      start_cursor: startCursor,
    });

    for (const page of response.results) {
      if (!("properties" in page)) continue;
      const p = page as PageObjectResponse;

      const pageRelationIds = getRelationIds(p, "Page");

      entries.push({
        key: getTitle(p),
        pageNotionId: pageRelationIds[0] || "",
        ja: getText(p, "JA"),
        en: getText(p, "EN"),
        fieldType: getSelect(p, "Type"),
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return entries;
}

// ─── Navigation Sync ─────────────────────────────────────────

const FOOTER_GROUP_ORDER: Record<string, number> = {
  Shop: 1,
  Content: 2,
  Support: 3,
  Legal: 4,
};

async function syncNavigation(registry: PageRegistryEntry[]): Promise<void> {
  const headerItems = registry
    .filter((e) => e.showInHeader)
    .sort((a, b) => a.navOrder - b.navOrder)
    .map((e) => ({
      _key: e.slug,
      label: e.navLabelJa || e.name,
      href: `/${e.slug}`,
    }));

  const footerGroupMap = new Map<string, typeof headerItems>();
  for (const e of registry) {
    if (!e.showInFooter || !e.footerGroup) continue;
    if (!footerGroupMap.has(e.footerGroup)) footerGroupMap.set(e.footerGroup, []);
    footerGroupMap.get(e.footerGroup)!.push({
      _key: e.slug,
      label: e.navLabelJa || e.name,
      href: `/${e.slug}`,
    });
  }

  const footerGroups = [...footerGroupMap.entries()]
    .sort(
      ([a], [b]) =>
        (FOOTER_GROUP_ORDER[a] ?? 99) - (FOOTER_GROUP_ORDER[b] ?? 99)
    )
    .map(([group, links]) => ({
      _key: slugify(group),
      title: group,
      links,
    }));

  if (DRY_RUN) {
    console.log(
      `  [dry-run] would patch siteSettings: headerNav (${headerItems.length} items), footerGroups (${footerGroups.length} groups)`
    );
    return;
  }

  const existing = await sanity.fetch<{ _id: string } | null>(
    `*[_type == "siteSettings"][0]{ _id }`
  );

  if (existing) {
    await sanity
      .patch(existing._id)
      .set({ headerNav: headerItems, footerGroups })
      .commit();
    console.log(`  -> patched siteSettings (${existing._id})`);
  } else {
    await sanity.create({
      _type: "siteSettings",
      headerNav: headerItems,
      footerGroups,
    });
    console.log("  -> created siteSettings");
  }
}

// ─── Page Content Sync ───────────────────────────────────────

async function syncPageContent(
  registry: PageRegistryEntry[],
  content: PageContentEntry[]
): Promise<{ synced: number; errors: number; failures: string[] }> {
  let synced = 0;
  let errors = 0;
  const failures: string[] = [];

  // Group content by page Notion ID
  const contentByPage = new Map<string, PageContentEntry[]>();
  for (const entry of content) {
    if (!entry.pageNotionId) continue;
    const normalized = entry.pageNotionId.replace(/-/g, "");
    if (!contentByPage.has(normalized)) contentByPage.set(normalized, []);
    contentByPage.get(normalized)!.push(entry);
  }

  for (const page of registry) {
    try {
      const normalizedId = page.notionId.replace(/-/g, "");
      const pageContent = contentByPage.get(normalizedId) || [];

      const contentFields = pageContent.map((c) => ({
        _key: c.key,
        key: c.key,
        ja: c.ja,
        en: c.en,
        fieldType: c.fieldType,
      }));

      const sanityId = `page-${page.slug === "/" ? "home" : page.slug.replace(/^\//, "").replace(/\//g, "-")}`;
      const doc = {
        _id: sanityId,
        _type: "page" as const,
        title: page.name,
        slug: { _type: "slug" as const, current: page.slug },
        contentFields,
        seo: {
          metaTitle: page.seoTitleJa,
          metaDescription: page.seoDescJa,
        },
      };

      if (DRY_RUN) {
        console.log(
          `  [dry-run] would createOrReplace page: ${sanityId} (${contentFields.length} fields)`
        );
      } else {
        await sanity.createOrReplace(doc);
        console.log(
          `  -> synced page: ${sanityId} (${contentFields.length} fields)`
        );
      }

      synced++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR (${page.slug}): ${message}`);
      failures.push(page.slug);
    }
  }

  if (failures.length > 0) {
    console.log(`\n  Failed pages: ${failures.join(", ")}`);
  }

  return { synced, errors, failures };
}

// ─── Pages Sync Orchestrator ─────────────────────────────────

async function syncPages(): Promise<SyncCounts> {
  currentPhase = "input";

  // Throw rather than exit: the caller classifies this as a config error and
  // reports it, instead of dying silently mid-run.
  requireEnv([
    "NOTION_PAGE_REGISTRY_DB_ID",
    "NOTION_PAGE_CONTENT_DB_ID",
  ] as const);

  if (DRY_RUN) {
    console.log("=== DRY RUN MODE (no writes to Sanity) ===\n");
  }

  console.log("Fetching Page Registry (Status=Published)...");
  const registry = await fetchPageRegistry();
  console.log(`  Found ${registry.length} pages\n`);

  console.log("Fetching Page Content...");
  const content = await fetchPageContent();
  console.log(`  Found ${content.length} content entries\n`);

  // Both inputs read successfully; subsequent errors are write failures.
  currentPhase = "write";

  console.log("Syncing navigation...");
  await syncNavigation(registry);
  console.log();

  console.log("Syncing page documents...");
  const { synced, errors, failures } = await syncPageContent(registry, content);
  console.log();

  console.log("---");
  console.log(
    `Pages sync ${DRY_RUN ? "(dry run) " : ""}complete: ${synced} synced, ${errors} errors`
  );

  return { fetched: registry.length, synced, errors, failures };
}

// ─── Main Sync ───────────────────────────────────────────────

async function sync(): Promise<SyncCounts> {
  currentPhase = "input";

  if (DRY_RUN) {
    console.log("=== DRY RUN MODE (no writes to Sanity) ===\n");
  }

  console.log(
    `Syncing Notion Content Hub → Sanity (${SANITY_PROJECT_ID} / ${SANITY_DATASET})`
  );
  console.log("---\n");

  // 1. Query Content Hub: Channel = Roji AND Status = Published
  console.log("Querying Content Hub (Channel=Roji, Status=Published)...");

  const entries: ContentHubEntry[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: CONTENT_HUB_DB_ID,
      filter: {
        and: [
          {
            property: "Channel",
            select: { equals: "Roji" },
          },
          {
            property: "Status",
            status: { equals: "Published" },
          },
        ],
      },
      start_cursor: startCursor,
    });

    for (const page of response.results) {
      if (!("properties" in page)) continue;
      const p = page as PageObjectResponse;

      const slug = getText(p, "🌐 Roji: Slug");
      if (!slug) {
        console.warn(`  Skipping "${getTitle(p)}" — no slug`);
        continue;
      }

      const images = resolveArticleImages(p);

      entries.push({
        notionId: p.id,
        title: getTitle(p),
        slug,
        intro: getText(p, "🌐 Roji: Intro"),
        headerImageUrl: images.mainImageUrl,
        headerImageSource: images.mainImageSource,
        thumbnailImageUrl: images.thumbnailUrl,
        thumbnailImageSource: images.thumbnailSource,
        metaDescription: getText(p, "🌐 Roji: Meta Description"),
        featured: getCheckbox(p, "🌐 Roji: Featured"),
        publishedDate: getDate(p, "Published Date"),
        categoryPageIds: getRelationIds(p, "🌐 Roji: Categories"),
        tagPageIds: getRelationIds(p, "Tags"),
        authorPageIds: getRelationIds(p, "Author"),
        operationsHubPageIds: getRelationIds(p, "Operations Hub"),
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  // The input was read successfully. From here on, a thrown error is a write
  // failure, not an input failure — the distinction the notifier reports.
  currentPhase = "write";

  console.log(`Found ${entries.length} published Roji articles\n`);

  if (entries.length === 0) {
    // An empty result is only reachable once the query above has succeeded, so
    // this is a genuine "nothing published", never a swallowed fetch error.
    console.log("No articles to sync (input read OK, 0 published). Done.");
    return { fetched: 0, synced: 0, errors: 0, failures: [] };
  }

  // 2. Ensure Sanity reference documents exist (categories, tags, authors)
  // Fetch existing ones first
  console.log("Loading existing Sanity reference documents...");

  const [existingCats, existingTags, existingAuthors] = await Promise.all([
    sanity.fetch<{ _id: string; title: string }[]>(
      `*[_type == "category"]{ _id, title }`
    ),
    sanity.fetch<{ _id: string; title: string }[]>(
      `*[_type == "tag"]{ _id, title }`
    ),
    sanity.fetch<{ _id: string; name: string }[]>(
      `*[_type == "author"]{ _id, name }`
    ),
  ]);

  // Filter out old hash-based and manual IDs so they get recreated with proper slugs
  const hashIdPattern = /^notion-(category|tag)-[0-9a-f]{12}$/;
  const categoryMap = new Map(
    existingCats
      .filter((c) => !hashIdPattern.test(c._id) && !c._id.startsWith("cat-"))
      .map((c) => [c.title, c._id])
  );
  const tagMap = new Map(
    existingTags
      .filter((t) => !hashIdPattern.test(t._id) && !t._id.startsWith("tag-"))
      .map((t) => [t.title, t._id])
  );
  const authorMap = new Map(existingAuthors.map((a) => [a.name, a._id]));

  console.log(
    `  Categories: ${categoryMap.size}, Tags: ${tagMap.size}, Authors: ${authorMap.size}\n`
  );

  // 3. Process each entry
  let synced = 0;
  let errors = 0;
  const failures: string[] = [];

  for (const entry of entries) {
    console.log(`Processing: ${entry.title} (${entry.slug})`);

    try {
      // 3a. Fetch page blocks for body content
      const blockResponses: BlockObjectResponse[] = [];
      let blockHasMore = true;
      let blockCursor: string | undefined;

      while (blockHasMore) {
        const blockResponse = await notion.blocks.children.list({
          block_id: entry.notionId,
          start_cursor: blockCursor,
        });

        for (const block of blockResponse.results) {
          if ("type" in block) {
            blockResponses.push(block as BlockObjectResponse);
          }
        }

        blockHasMore = blockResponse.has_more;
        blockCursor = blockResponse.next_cursor ?? undefined;
      }

      // 3b. Convert blocks to Portable Text
      const body = await blocksToPortableText(blockResponses, sanity, DRY_RUN);

      // 3c. Resolve relations (auto-creates missing Sanity docs)
      const category = await resolveCategories(
        entry.categoryPageIds,
        categoryMap,
        sanity,
        DRY_RUN
      );
      const tags = await resolveTags(entry.tagPageIds, tagMap, sanity, DRY_RUN);
      const author = await resolveAuthor(
        entry.authorPageIds,
        authorMap,
        sanity,
        DRY_RUN
      );
      const relatedProducts = await resolveOperationsHubProducts(
        entry.operationsHubPageIds
      );

      // 3d. Handle header + thumbnail images.
      // Sources are resolved in fetchContentHub() via resolveArticleImages():
      // Asset Hub URL columns first, legacy `Featured Image` as fallback. When
      // the two resolve to the same url we upload once and share the asset ref
      // (the historic behaviour where thumbnail mirrored mainImage).
      let mainImage: unknown = undefined;
      let thumbnail: unknown = undefined;
      const sameImage =
        entry.thumbnailImageUrl === entry.headerImageUrl;
      if (entry.headerImageUrl) {
        if (DRY_RUN) {
          mainImage = { _dryRun: true, _sourceUrl: entry.headerImageUrl };
        } else {
          const assetRef = await uploadImageToSanity(
            sanity,
            entry.headerImageUrl,
            `${entry.slug}-header`
          );
          if (assetRef) {
            mainImage = { _type: "image", asset: assetRef, alt: entry.title };
          }
        }
      }
      if (sameImage) {
        thumbnail = mainImage;
      } else if (entry.thumbnailImageUrl) {
        if (DRY_RUN) {
          thumbnail = { _dryRun: true, _sourceUrl: entry.thumbnailImageUrl };
        } else {
          const assetRef = await uploadImageToSanity(
            sanity,
            entry.thumbnailImageUrl,
            `${entry.slug}-thumbnail`
          );
          if (assetRef) {
            thumbnail = { _type: "image", asset: assetRef, alt: entry.title };
          }
        }
      }

      // 3e. Build Sanity document
      const sanityId = `notion-${entry.slug}`;
      const doc: Record<string, unknown> = {
        _id: sanityId,
        _type: "article",
        title: entry.title,
        slug: { _type: "slug", current: entry.slug },
        excerpt: entry.intro,
        body,
        language: "ja",
        memberOnly: false,
        featured: entry.featured,
        ...(entry.publishedDate
          ? {
              publishedAt: new Date(
                `${entry.publishedDate}T00:00:00+09:00`
              ).toISOString(),
            }
          : {}),
        ...(category ? { category } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(author ? { author } : {}),
        ...(relatedProducts.length > 0 ? { relatedProducts } : {}),
        ...(entry.metaDescription
          ? { seo: { metaDescription: entry.metaDescription } }
          : {}),
        ...(mainImage ? { mainImage } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      };

      if (DRY_RUN) {
        console.log(`  [dry-run] would createOrReplace: ${sanityId}`);
        console.log(`    title: ${entry.title}`);
        console.log(`    slug: ${entry.slug}`);
        console.log(`    body blocks: ${body.length}`);
        console.log(`    category: ${category ? "yes" : "none"}`);
        console.log(`    tags: ${tags.length}`);
        console.log(`    author: ${author ? "yes" : "none"}`);
        console.log(
          `    relatedProducts: ${relatedProducts.length > 0 ? relatedProducts.join(", ") : "none"}`
        );
        console.log(
          `    headerImage: ${entry.headerImageUrl ? "yes" : "none"} (source: ${entry.headerImageSource})`
        );
        console.log(
          `    thumbnail: ${entry.thumbnailImageUrl ? "yes" : "none"} (source: ${entry.thumbnailImageSource})`
        );
      } else {
        await sanity.createOrReplace(doc);
        console.log(`  -> synced to Sanity: ${sanityId}`);
      }

      synced++;
    } catch (err) {
      errors++;
      failures.push(entry.slug);
      console.error(`  ERROR (${entry.slug}): ${errText(err)}`);
    }

    console.log();
  }

  // 4. Summary
  console.log("---");
  console.log(
    `Sync ${DRY_RUN ? "(dry run) " : ""}complete: ${synced} synced, ${errors} errors`
  );

  return { fetched: entries.length, synced, errors, failures };
}

const args = process.argv.slice(2);
const SYNC_PAGES = args.includes("--pages");
const SYNC_ALL = args.includes("--all");
const SYNC_ARTICLES = !SYNC_PAGES || SYNC_ALL;

/**
 * Run one sub-sync and turn its result — or its failure — into a report.
 *
 * Nothing here calls `process.exit` directly. Every path produces a report so
 * that no outcome can leave the run without a record somewhere.
 */
async function runReported(
  job: string,
  fn: () => Promise<SyncCounts>
): Promise<SyncOutcome> {
  try {
    const counts = await fn();
    const outcome: SyncOutcome = counts.errors > 0 ? "partial" : "success";
    await reportSyncResult({
      job,
      outcome,
      dryRun: DRY_RUN,
      dataset: SANITY_DATASET,
      fetched: counts.fetched,
      synced: counts.synced,
      errors: counts.errors,
      failures: counts.failures,
    });
    return outcome;
  } catch (err) {
    // MissingEnvError is a config problem, not a data problem. Otherwise use the
    // phase to tell "could not read Notion" apart from "could not write Sanity".
    const outcome: SyncOutcome =
      err instanceof MissingEnvError
        ? "config-error"
        : currentPhase === "input"
          ? "input-failure"
          : "fatal";

    console.error(`Sync failed (${job} / ${outcome}):`, err);

    await reportSyncResult({
      job,
      outcome,
      dryRun: DRY_RUN,
      dataset: SANITY_DATASET,
      // null (not 0) — we do not know how many items existed.
      fetched: null,
      synced: 0,
      errors: 1,
      message: errText(err),
    });
    return outcome;
  }
}

(async () => {
  const outcomes: SyncOutcome[] = [];

  // Validate config and build clients first, so a missing secret is reported
  // through the notifier instead of crashing at import time. Reported only on
  // failure — a healthy config is not news.
  try {
    initClients();
  } catch (err) {
    console.error("Sync failed (config):", err);
    await reportSyncResult({
      job: "config",
      outcome: "config-error",
      dryRun: DRY_RUN,
      dataset: SANITY_DATASET,
      fetched: null,
      synced: 0,
      errors: 1,
      message: errText(err),
    });
    process.exit(EXIT_CODES["config-error"]);
  }

  if (SYNC_ARTICLES) {
    console.log("Syncing articles...");
    outcomes.push(await runReported("articles", sync));
  }
  if (SYNC_PAGES || SYNC_ALL) {
    console.log("Syncing pages...");
    outcomes.push(await runReported("pages", syncPages));
  }

  // Exit on the worst outcome so the runner's status matches the cause.
  const worst = outcomes.reduce<SyncOutcome>(
    (acc, o) => (EXIT_CODES[o] > EXIT_CODES[acc] ? o : acc),
    "success"
  );
  process.exit(EXIT_CODES[worst]);
})();

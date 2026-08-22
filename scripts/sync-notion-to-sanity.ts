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
import {
  resolveTeaOrigin,
  resolveTeaOriginPlace,
  resolveTeaSupplier,
} from "../lib/roji/tea-origins";

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
 * Tea Menu List の database id。
 *
 * 他の DB と違って既定値を持たせている: この id は秘密ではなく
 * (`lib/roji/tea-origins.ts` の註にも同じ値が載っている)、既定値があれば
 * 新しい secret を用意しなくても `--tea-menu` が動く。
 * `NOTION_TEA_MENU_DB_ID` を設定すればそちらが優先される。
 */
const TEA_MENU_DB_ID_DEFAULT = "ee367f6c-3ff3-4251-ad9e-0bc5a2cc7358";

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

// ─── Tea Menu (茶譜) ─────────────────────────────────────────

/**
 * 茶譜 (お茶メニュー) の同期: Notion Tea Menu List → Sanity `teaMenu`。
 *
 * ## なぜ必要か
 *
 * Sanity の `teaMenu` は 3 件しか無く、その 3 件は `scripts/seed-dummy-content.ts`
 * が入れた架空データ (spring-sencha / uji-gyokuro / kaga-hojicha)。銘柄マスタの
 * 実体は Notion Tea Menu List の 43 件で、欠けていたのは正本ではなく同期実装。
 *
 * ## 何を 43 件と数えるか
 *
 * `Menu Name` (title) が **5 桁の採番**になっている行だけを銘柄として扱う。
 * DB には 218 行あるが、残りは採番前の下書きで銘柄として成立していない。
 * この 43 件は `lib/roji/tea-origins.ts` の `TEA_ORIGIN_BY_NUMBER` と同じ集合。
 *
 * 表示名は `Menu Name` ではなく `Menu Name - full` に入っている
 * (`Menu Name` は採番そのもの)。
 *
 * ## 産地をどこから取るか (2 段構え)
 *
 * 産地は銘柄ではなく仕入先に紐づく: Tea Menu List の `Supplier Name` (relation)
 * → Supplier List の `Prefecture` / `Regions` / `Place`。Tea Menu List 側には
 * その rollup (`Prefecture` / `Origin`) がある。
 *
 * ただし **Supplier List は統合 (elxea-performance-sync) に共有されていない**ため、
 * API 経由では relation / rollup が空で返る (2026-08-18 実測: 43 件すべて空。
 * 同じページを個人資格で読むと `Supplier Name` は入っており、データ欠損ではなく
 * 権限によるマスク)。
 *
 * そこで解決順を 2 段にする:
 *   1. Notion の rollup が入っていればそれを使う (正本が直接使える状態)
 *   2. 空なら `lib/roji/tea-origins.ts` の検証済みスナップショットを 5 桁番号で
 *      join する。これは Supplier List の写しであって新たな推定ではない
 *
 * Supplier List が統合へ共有された時点で 1 が自動的に効き始め、コード変更なしで
 * 正本直結へ移行する。座標 (`Place`) は現状スナップショット側にしか無い。
 *
 * ## ダミー 3 件を消さないこと
 *
 * `_id` を `teaMenu-<5桁>` に固定するため、ランダム ID のダミー 3 件とは衝突せず
 * 上書きも削除もしない (ダミーの遮断は read 層 `lib/fictional-content.ts` が担当)。
 * 同じ `_id` に対する `createOrReplace` なので再実行しても増殖しない。
 */

/**
 * title 型プロパティを名前で読む。
 *
 * 既存の `getTitle()` は `"Title"` という名前を決め打ちしている (Content Hub の
 * title プロパティ名)。Tea Menu List の title は `"Menu Name"` なので使えない。
 * `getTitle()` 側を変えると記事同期の挙動が変わるため、こちらを足している。
 */
function getTitleNamed(page: PageObjectResponse, name: string): string {
  const prop = page.properties[name];
  if (prop?.type === "title") return prop.title.map((t) => t.plain_text).join("");
  return "";
}

/** rollup (array) から文字列を取り出す。select / rich_text / title を平すだけ。 */
function getRollupStrings(page: PageObjectResponse, name: string): string[] {
  const prop = page.properties[name];
  if (prop?.type !== "rollup" || prop.rollup.type !== "array") return [];

  const out: string[] = [];
  for (const item of prop.rollup.array) {
    if (item.type === "select" && item.select) out.push(item.select.name);
    else if (item.type === "rich_text")
      out.push(item.rich_text.map((r) => r.plain_text).join(""));
    else if (item.type === "title")
      out.push(item.title.map((r) => r.plain_text).join(""));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 「95℃ 120cc 90sec」のような 1 行の淹れ方を温度 / 湯量 / 時間へ分解する。
 *
 * Notion 側は `How to Brew` に 1 行で入っている行と、`How-to_Temp(℃)` /
 * `How-to_Water(ml)` / `How-to_Time(Sec)` に分かれている行が混在する。
 * 数字が 1 つも取れなければ `null` を返し、`brewingGuide` を書かない
 * (空文字を入れると Studio 上「設定済みだが空」に見えて実態と食い違う)。
 */
function parseBrewingGuide(
  oneLine: string,
  temp: string,
  water: string,
  time: string
): { temperature: string; water: string; time: string } | null {
  const digits = (s: string): string => s.match(/\d+(?:\.\d+)?/)?.[0] ?? "";

  let t = digits(temp);
  let w = digits(water);
  let s = digits(time);

  if (!t && !w && !s && oneLine) {
    // 単位で拾う (順序に依存させない)。℃/度 → 温度、cc/ml → 湯量、sec/秒 → 時間。
    t = oneLine.match(/(\d+(?:\.\d+)?)\s*(?:℃|度|C)/i)?.[1] ?? "";
    w = oneLine.match(/(\d+(?:\.\d+)?)\s*(?:cc|ml)/i)?.[1] ?? "";
    s = oneLine.match(/(\d+(?:\.\d+)?)\s*(?:sec|s\b|秒)/i)?.[1] ?? "";
  }

  if (!t && !w && !s) return null;
  return { temperature: t, water: w, time: s };
}

/** Tea Menu List の 1 行から取り出した銘柄。 */
interface TeaMenuEntry {
  notionId: string;
  /** 5 桁の採番 (`Menu Name`)。Sanity の `productNumber` / dataviz の結合キー。 */
  menuNumber: string;
  displayName: string;
  category: string;
  variety: string;
  season: string;
  netWeight: number;
  description: string;
  brewingGuide: { temperature: string; water: string; time: string } | null;
  /** Notion rollup 由来の都道府県 (空なら未共有 / 未設定)。 */
  prefectureFromNotion: string;
  /** Notion rollup 由来の産地 (Regions 原文・空なら未共有 / 未設定)。 */
  originFromNotion: string;
}

async function fetchTeaMenuEntries(databaseId: string): Promise<TeaMenuEntry[]> {
  const entries: TeaMenuEntry[] = [];
  let startCursor: string | undefined;
  let scanned = 0;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: startCursor,
    });

    for (const page of response.results) {
      if (!("properties" in page)) continue;
      const p = page as PageObjectResponse;
      scanned++;

      // 採番済みの行だけを銘柄として扱う (下書き行を混ぜない)。
      const menuNumber = getTitleNamed(p, "Menu Name").trim();
      if (!/^\d{5}$/.test(menuNumber)) continue;

      const displayName =
        getText(p, "Menu Name - full").trim() ||
        getText(p, "Menu Name - Supplier").trim();
      if (!displayName) {
        console.warn(`  Skipping ${menuNumber} — no display name`);
        continue;
      }

      entries.push({
        notionId: p.id,
        menuNumber,
        displayName,
        category: getSelect(p, "Category"),
        variety: getSelect(p, "Variety"),
        season: getSelect(p, "Season"),
        // 「3g」のような表記から数値だけを取る。取れなければ 0。
        netWeight: Number(getText(p, "Net Wt.").match(/\d+(?:\.\d+)?/)?.[0] ?? 0),
        // プロパティ名の末尾に空白がある (Notion 側の実際の名前)。
        description: getText(p, "Menu Description(Short ver.) ").trim(),
        brewingGuide: parseBrewingGuide(
          getText(p, "How to Brew"),
          getText(p, "How-to_Temp(℃)"),
          getText(p, "How-to_Water(ml)"),
          getText(p, "How-to_Time(Sec)")
        ),
        prefectureFromNotion: getRollupStrings(p, "Prefecture")[0] ?? "",
        originFromNotion: getRollupStrings(p, "Origin")[0] ?? "",
      });
    }

    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  console.log(`  scanned ${scanned} rows, ${entries.length} numbered (5-digit) menus`);

  // 行は読めたのに 1 件も採番済みが無いのは異常。プロパティ名の変更や読み取り
  // 側の取り違えがここに出る (実際にこの guard が無い間、title プロパティ名の
  // 決め打ちで 0 件になったのを「成功 / 対象 0 件」と報告してしまった)。
  // 「正常に 0 件だった」と区別できるよう投げて input-failure にする。
  if (scanned > 0 && entries.length === 0) {
    throw new Error(
      `Tea Menu List の ${scanned} 行を読めたが、5 桁採番の銘柄が 1 件も見つからない。` +
        `プロパティ名 (Menu Name / Menu Name - full) の変更を疑うこと。` +
        `「公開対象 0 件」ではない。`
    );
  }

  return entries;
}

async function syncTeaMenu(): Promise<SyncCounts> {
  currentPhase = "input";

  const databaseId = optionalEnv("NOTION_TEA_MENU_DB_ID", TEA_MENU_DB_ID_DEFAULT);

  console.log(
    `Syncing Notion Tea Menu List → Sanity teaMenu (${SANITY_PROJECT_ID} / ${SANITY_DATASET})`
  );
  if (DRY_RUN) console.log("=== DRY RUN MODE (no writes to Sanity) ===");

  const entries = await fetchTeaMenuEntries(databaseId);

  currentPhase = "write";

  let synced = 0;
  let errors = 0;
  const failures: string[] = [];
  // 産地がどちらの経路で解決したかを数えて、権限マスクの状態を可視化する。
  let originFromNotionCount = 0;
  let originFromSnapshotCount = 0;
  let originMissingCount = 0;

  for (const entry of entries) {
    try {
      const snapshot = resolveTeaOrigin(entry.menuNumber);

      // 1. Notion rollup を優先。2. 空ならスナップショット。
      const prefecture = entry.prefectureFromNotion || snapshot.prefecture || "";
      const area = snapshot.area ?? "";
      const originText =
        entry.originFromNotion ||
        resolveTeaOriginPlace(entry.menuNumber) ||
        "";

      if (entry.prefectureFromNotion) originFromNotionCount++;
      else if (snapshot.prefecture) originFromSnapshotCount++;
      else originMissingCount++;

      const sanityId = `teaMenu-${entry.menuNumber}`;

      const doc: Record<string, unknown> = {
        _id: sanityId,
        _type: "teaMenu",
        title: entry.displayName,
        displayName: entry.displayName,
        // 5 桁の採番をそのまま slug にする。表示名は重複しうる
        // (51301 と 51401 はどちらも「春摘みやぶきたの和紅茶」) ため、
        // 名前から作ると衝突する。採番は業務側の一意キーで安定している。
        slug: { _type: "slug", current: entry.menuNumber },
        productNumber: entry.menuNumber,
        category: entry.category,
        variety: entry.variety,
        season: entry.season,
        netWeight: entry.netWeight,
        origin: originText,
        description: entry.description,
        language: "ja",
        // 由来を残す (どの Notion 行から来たかを追えるように)。
        notionId: entry.notionId,
        // 構造化産地。地図・集計はこちらを使う (`origin` は表示用の自由記述)。
        prefecture,
        area,
        originPrecision: snapshot.precision,
        supplier: resolveTeaSupplier(entry.menuNumber) ?? "",
      };

      if (snapshot.lat !== null && snapshot.lng !== null) {
        doc.location = {
          _type: "geopoint",
          lat: snapshot.lat,
          lng: snapshot.lng,
        };
      }
      if (entry.brewingGuide) doc.brewingGuide = entry.brewingGuide;

      if (DRY_RUN) {
        console.log(
          `  [dry-run] would createOrReplace: ${sanityId} — ${entry.displayName} ` +
            `(${entry.category} / ${originText || "産地不明"})`
        );
      } else {
        await sanity.createOrReplace(doc);
        console.log(`  -> synced: ${sanityId} — ${entry.displayName}`);
      }

      synced++;
    } catch (err) {
      errors++;
      failures.push(entry.menuNumber);
      console.error(`  ERROR (${entry.menuNumber}): ${errText(err)}`);
    }
  }

  console.log("---");
  console.log(
    `Tea menu sync ${DRY_RUN ? "(dry run) " : ""}complete: ${synced} synced, ${errors} errors`
  );
  console.log(
    `  origin source: Notion rollup ${originFromNotionCount} / ` +
      `snapshot ${originFromSnapshotCount} / unresolved ${originMissingCount}`
  );
  if (originFromNotionCount === 0 && entries.length > 0) {
    // 「産地が無い」のではなく「統合から見えていない」ことを明示する。
    console.warn(
      "  NOTE: Notion の Prefecture rollup が 1 件も取得できていない。Supplier List が " +
        "統合に共有されていない可能性が高い (共有されれば正本直結に自動で切り替わる)。"
    );
  }

  return { fetched: entries.length, synced, errors, failures };
}

const args = process.argv.slice(2);
const SYNC_PAGES = args.includes("--pages");
const SYNC_TEA_MENU = args.includes("--tea-menu");
const SYNC_ALL = args.includes("--all");
// 明示的な対象指定が無いときだけ記事を既定にする (従来の挙動を保つ)。
const SYNC_ARTICLES = (!SYNC_PAGES && !SYNC_TEA_MENU) || SYNC_ALL;

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
  if (SYNC_TEA_MENU || SYNC_ALL) {
    console.log("Syncing tea menu...");
    outcomes.push(await runReported("tea-menu", syncTeaMenu));
  }

  // Exit on the worst outcome so the runner's status matches the cause.
  const worst = outcomes.reduce<SyncOutcome>(
    (acc, o) => (EXIT_CODES[o] > EXIT_CODES[acc] ? o : acc),
    "success"
  );
  process.exit(EXIT_CODES[worst]);
})();

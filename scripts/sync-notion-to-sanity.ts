/**
 * Sync script: Notion Content Hub → Sanity
 * Run with: pnpm sync:notion
 * Dry run:   pnpm sync:notion:dry
 *
 * Fetches articles from Notion Content Hub (Channel=Roji, Status=Published)
 * and syncs them to Sanity as article documents.
 *
 * Requires:
 *   - NOTION_API_KEY (Notion Integration token with Content Hub access)
 *   - NOTION_CONTENT_HUB_DB_ID (Content Hub database ID)
 *   - Sanity CLI auth token (~/.config/sanity/config.json)
 */

import { Client as NotionClient } from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { createClient, type SanityClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

// ─── Config ──────────────────────────────────────────────────

const envPath = join(process.cwd(), ".env");
const envContent = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const NOTION_API_KEY = env.NOTION_API_KEY;
const CONTENT_HUB_DB_ID = env.NOTION_CONTENT_HUB_DB_ID;
const SANITY_PROJECT_ID = env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const SANITY_DATASET = env.NEXT_PUBLIC_SANITY_DATASET || "production";
const DRY_RUN = process.argv.includes("--dry-run");

if (!NOTION_API_KEY) {
  console.error("Missing NOTION_API_KEY in .env");
  process.exit(1);
}
if (!CONTENT_HUB_DB_ID) {
  console.error("Missing NOTION_CONTENT_HUB_DB_ID in .env");
  process.exit(1);
}
if (!SANITY_PROJECT_ID) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID in .env");
  process.exit(1);
}

// Sanity auth token
const sanityConfigPath = join(
  process.env.HOME || "",
  ".config/sanity/config.json"
);
let sanityAuthToken = "";
try {
  const sanityConfig = JSON.parse(readFileSync(sanityConfigPath, "utf-8"));
  sanityAuthToken = sanityConfig.authToken;
} catch {
  console.error(
    "Could not read Sanity CLI config. Run `npx sanity login` first."
  );
  process.exit(1);
}

const notion = new NotionClient({ auth: NOTION_API_KEY });

const sanity = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  apiVersion: "2024-01-01",
  useCdn: false,
  token: sanityAuthToken,
});

// ─── Types ───────────────────────────────────────────────────

interface ContentHubEntry {
  notionId: string;
  title: string;
  slug: string;
  intro: string;
  headerImageUrl: string;
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

async function getPageTitle(pageId: string): Promise<string> {
  if (pageTitleCache.has(pageId)) return pageTitleCache.get(pageId)!;
  try {
    const page = (await notion.pages.retrieve({
      page_id: pageId,
    })) as PageObjectResponse;

    // Try common title property names
    for (const [, prop] of Object.entries(page.properties)) {
      if (prop.type === "title") {
        const title = prop.title.map((t) => t.plain_text).join("");
        pageTitleCache.set(pageId, title);
        return title;
      }
    }
  } catch {
    // Page might not be accessible
  }
  pageTitleCache.set(pageId, "");
  return "";
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
  dryRun: boolean
): Promise<string> {
  if (categoryMap.has(title)) return categoryMap.get(title)!;

  const slug = slugify(title);
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
  // Content Hub categories are from a separate Roji Categories DB
  // We need to match by title to Sanity categories, auto-creating if missing
  for (const pageId of categoryPageIds) {
    const title = await getPageTitle(pageId);
    if (title) {
      const ref = await ensureSanityCategory(title, categoryMap, client, dryRun);
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

// ─── Main Sync ───────────────────────────────────────────────

async function sync() {
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

      entries.push({
        notionId: p.id,
        title: getTitle(p),
        slug,
        intro: getText(p, "🌐 Roji: Intro"),
        headerImageUrl: getUrl(p, "🌐 Roji: Header Image"),
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

  console.log(`Found ${entries.length} published Roji articles\n`);

  if (entries.length === 0) {
    console.log("No articles to sync. Done.");
    return;
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

  const categoryMap = new Map(existingCats.map((c) => [c.title, c._id]));
  const tagMap = new Map(existingTags.map((t) => [t.title, t._id]));
  const authorMap = new Map(existingAuthors.map((a) => [a.name, a._id]));

  console.log(
    `  Categories: ${categoryMap.size}, Tags: ${tagMap.size}, Authors: ${authorMap.size}\n`
  );

  // 3. Process each entry
  let synced = 0;
  let errors = 0;

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

      // 3d. Handle header image
      let mainImage: unknown = undefined;
      let thumbnail: unknown = undefined;
      if (entry.headerImageUrl) {
        if (DRY_RUN) {
          mainImage = { _dryRun: true, _sourceUrl: entry.headerImageUrl };
          thumbnail = mainImage;
        } else {
          const assetRef = await uploadImageToSanity(
            sanity,
            entry.headerImageUrl,
            `${entry.slug}-header`
          );
          if (assetRef) {
            mainImage = { _type: "image", asset: assetRef, alt: entry.title };
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
          `    headerImage: ${entry.headerImageUrl ? "yes" : "none"}`
        );
      } else {
        await sanity.createOrReplace(doc);
        console.log(`  -> synced to Sanity: ${sanityId}`);
      }

      synced++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${message}`);
    }

    console.log();
  }

  // 4. Summary
  console.log("---");
  console.log(
    `Sync ${DRY_RUN ? "(dry run) " : ""}complete: ${synced} synced, ${errors} errors`
  );
}

sync().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});

/**
 * Content Hub article image resolution — the READ side of elxea-asset-hub's
 * `/api/assets/assign-article` (M34 · 記事画像の台帳一本化).
 *
 * ## Why this module exists
 *
 * The Asset Hub writes an adopted ledger asset's `current_url` DIRECTLY into a
 * Content Hub article's **URL** properties (see elxea-asset-hub
 * `lib/article-assign.ts` → `ARTICLE_IMAGE_FIELDS`):
 *
 *   hero      -> `🌐 Roji: Hero Image`   (Notion type: url)
 *   thumbnail -> `🌐 Roji: Thumbnail`    (Notion type: url)
 *
 * `scripts/sync-notion-to-sanity.ts` historically read only the legacy
 * `Featured Image` property (Notion type: **files**, filled by hand in Notion).
 * Write column ≠ read column, so an image assigned through the Asset Hub never
 * reached Sanity and never appeared on the site.
 *
 * This module is the single place that decides which Notion column an article's
 * images come from, so the write side (Asset Hub) and the read side (sync) can
 * no longer drift apart silently. It is pure and network-free so the precedence
 * rules are unit-testable without Notion.
 *
 * ## Precedence (fallbacks are deliberate — legacy articles must not break)
 *
 *   mainImage : `🌐 Roji: Hero Image` → `Featured Image` → none
 *   thumbnail : `🌐 Roji: Thumbnail`  → whatever mainImage resolved to → none
 *
 * The thumbnail's final fallback preserves the previous behaviour, where the
 * Sanity `thumbnail` field was just a copy of `mainImage`.
 */

/** Content Hub property names. Mirrors elxea-asset-hub `ARTICLE_IMAGE_FIELDS`. */
export const ARTICLE_IMAGE_PROPS = {
  /** Asset Hub write target for the article header (Notion url property). */
  hero: "🌐 Roji: Hero Image",
  /** Asset Hub write target for the article thumbnail (Notion url property). */
  thumbnail: "🌐 Roji: Thumbnail",
  /** Legacy hand-uploaded header (Notion files property). Fallback only. */
  legacy: "Featured Image",
} as const;

/**
 * Minimal structural shape of a Notion page. Deliberately not
 * `PageObjectResponse` so fixtures can be built without the Notion SDK types;
 * a real `PageObjectResponse` is assignable to it.
 */
export interface NotionPageLike {
  properties: Record<string, unknown>;
}

/** Where a resolved image url came from. `none` = no image on the article. */
export type ArticleImageSource = "hero" | "thumbnail" | "legacy" | "none";

export interface ResolvedArticleImages {
  /** Sanity `mainImage` source url ("" when the article has no header image). */
  mainImageUrl: string;
  mainImageSource: ArticleImageSource;
  /** Sanity `thumbnail` source url ("" when the article has no image at all). */
  thumbnailUrl: string;
  thumbnailSource: ArticleImageSource;
}

/**
 * True for an absolute http(s) url — the only thing the Asset Hub ever writes
 * and the only thing Sanity's asset uploader can fetch. A malformed value in the
 * URL column must NOT shadow a valid legacy `Featured Image`, so anything else
 * is treated as unset.
 */
function isUsableUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** Read a Notion `url` property, "" when absent/empty/not a usable url. */
export function readUrlProperty(page: NotionPageLike, name: string): string {
  const prop = page?.properties?.[name] as { type?: string; url?: unknown } | undefined;
  if (!prop || prop.type !== "url") return "";
  const url = typeof prop.url === "string" ? prop.url.trim() : "";
  return isUsableUrl(url) ? url : "";
}

/** Read the first file url of a Notion `files` property, "" when absent. */
export function readFilesProperty(page: NotionPageLike, name: string): string {
  const prop = page?.properties?.[name] as
    | { type?: string; files?: unknown }
    | undefined;
  if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) return "";
  const first = prop.files[0] as
    | { type?: string; file?: { url?: unknown }; external?: { url?: unknown } }
    | undefined;
  if (!first) return "";
  const raw =
    first.type === "file"
      ? first.file?.url
      : first.type === "external"
        ? first.external?.url
        : undefined;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Resolve an article's header + thumbnail source urls from a Content Hub page.
 *
 * Asset Hub columns win; the legacy `Featured Image` is the fallback so articles
 * that only ever had a hand-uploaded image keep rendering exactly as before.
 */
export function resolveArticleImages(
  page: NotionPageLike,
): ResolvedArticleImages {
  const hero = readUrlProperty(page, ARTICLE_IMAGE_PROPS.hero);
  const thumb = readUrlProperty(page, ARTICLE_IMAGE_PROPS.thumbnail);
  const legacy = readFilesProperty(page, ARTICLE_IMAGE_PROPS.legacy);

  const mainImageUrl = hero || legacy;
  const mainImageSource: ArticleImageSource = hero
    ? "hero"
    : legacy
      ? "legacy"
      : "none";

  const thumbnailUrl = thumb || mainImageUrl;
  const thumbnailSource: ArticleImageSource = thumb
    ? "thumbnail"
    : mainImageSource;

  return { mainImageUrl, mainImageSource, thumbnailUrl, thumbnailSource };
}

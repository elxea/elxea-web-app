/**
 * Content Hub article image resolution (M34 read side).
 *
 * Regression guard for the write-column ≠ read-column break: elxea-asset-hub
 * writes `🌐 Roji: Hero Image` / `🌐 Roji: Thumbnail` (Notion **url** props) but
 * the Notion→Sanity sync only ever read `Featured Image` (a **files** prop), so
 * an image assigned through the Asset Hub never reached the site.
 *
 * Every "prefers the Asset Hub column" case below fails against the pre-fix
 * behaviour (legacy-only read), because the fixtures carry no `Featured Image`.
 */
import { describe, it, expect } from "vitest";
import {
  ARTICLE_IMAGE_PROPS,
  readFilesProperty,
  readUrlProperty,
  resolveArticleImages,
  type NotionPageLike,
} from "@/lib/notion/article-image";

const HERO_URL = "https://cdn.example.com/cdn/assets/ELX-0001-hero.jpg";
const THUMB_URL = "https://cdn.example.com/cdn/assets/ELX-0002-thumb.jpg";
const LEGACY_URL =
  "https://prod-files-secure.s3.amazonaws.com/legacy-featured.png";

/** Notion `url` property as the API returns it. */
function urlProp(url: string | null) {
  return { id: "x", type: "url", url };
}

/** Notion `files` property (internal upload) as the API returns it. */
function filesProp(url: string) {
  return {
    id: "y",
    type: "files",
    files: [{ name: "legacy.png", type: "file", file: { url, expiry_time: "" } }],
  };
}

/** Notion `files` property holding an external link. */
function externalFilesProp(url: string) {
  return {
    id: "y",
    type: "files",
    files: [{ name: "legacy.png", type: "external", external: { url } }],
  };
}

function page(properties: Record<string, unknown>): NotionPageLike {
  return { properties };
}

describe("resolveArticleImages — Asset Hub column wins", () => {
  it("uses 🌐 Roji: Hero Image for mainImage when the Asset Hub has assigned one", () => {
    const result = resolveArticleImages(
      page({ [ARTICLE_IMAGE_PROPS.hero]: urlProp(HERO_URL) }),
    );
    expect(result.mainImageUrl).toBe(HERO_URL);
    expect(result.mainImageSource).toBe("hero");
  });

  it("uses 🌐 Roji: Thumbnail for the thumbnail, independent of the hero", () => {
    const result = resolveArticleImages(
      page({
        [ARTICLE_IMAGE_PROPS.hero]: urlProp(HERO_URL),
        [ARTICLE_IMAGE_PROPS.thumbnail]: urlProp(THUMB_URL),
      }),
    );
    expect(result.mainImageUrl).toBe(HERO_URL);
    expect(result.thumbnailUrl).toBe(THUMB_URL);
    expect(result.thumbnailSource).toBe("thumbnail");
  });

  it("prefers the Asset Hub hero over a legacy Featured Image", () => {
    const result = resolveArticleImages(
      page({
        [ARTICLE_IMAGE_PROPS.hero]: urlProp(HERO_URL),
        [ARTICLE_IMAGE_PROPS.legacy]: filesProp(LEGACY_URL),
      }),
    );
    expect(result.mainImageUrl).toBe(HERO_URL);
    expect(result.mainImageSource).toBe("hero");
  });

  it("resolves a thumbnail even when only 🌐 Roji: Thumbnail is set", () => {
    const result = resolveArticleImages(
      page({ [ARTICLE_IMAGE_PROPS.thumbnail]: urlProp(THUMB_URL) }),
    );
    expect(result.thumbnailUrl).toBe(THUMB_URL);
    expect(result.thumbnailSource).toBe("thumbnail");
    // No hero and no legacy image -> the article has no header image.
    expect(result.mainImageUrl).toBe("");
    expect(result.mainImageSource).toBe("none");
  });
});

describe("resolveArticleImages — legacy fallback (existing articles must not break)", () => {
  it("falls back to Featured Image when no Asset Hub column is set", () => {
    const result = resolveArticleImages(
      page({ [ARTICLE_IMAGE_PROPS.legacy]: filesProp(LEGACY_URL) }),
    );
    expect(result.mainImageUrl).toBe(LEGACY_URL);
    expect(result.mainImageSource).toBe("legacy");
  });

  it("mirrors the header into the thumbnail when no thumbnail is assigned (previous behaviour)", () => {
    const result = resolveArticleImages(
      page({ [ARTICLE_IMAGE_PROPS.legacy]: filesProp(LEGACY_URL) }),
    );
    expect(result.thumbnailUrl).toBe(LEGACY_URL);
    expect(result.thumbnailSource).toBe("legacy");
  });

  it("mirrors an Asset Hub hero into the thumbnail when no thumbnail is assigned", () => {
    const result = resolveArticleImages(
      page({ [ARTICLE_IMAGE_PROPS.hero]: urlProp(HERO_URL) }),
    );
    expect(result.thumbnailUrl).toBe(HERO_URL);
    expect(result.thumbnailSource).toBe("hero");
  });

  it("falls back when the hero column exists but is empty", () => {
    const result = resolveArticleImages(
      page({
        [ARTICLE_IMAGE_PROPS.hero]: urlProp(null),
        [ARTICLE_IMAGE_PROPS.legacy]: filesProp(LEGACY_URL),
      }),
    );
    expect(result.mainImageUrl).toBe(LEGACY_URL);
    expect(result.mainImageSource).toBe("legacy");
  });

  it("ignores a non-http value in the hero column rather than shadowing the legacy image", () => {
    const result = resolveArticleImages(
      page({
        [ARTICLE_IMAGE_PROPS.hero]: urlProp("not a url"),
        [ARTICLE_IMAGE_PROPS.legacy]: filesProp(LEGACY_URL),
      }),
    );
    expect(result.mainImageUrl).toBe(LEGACY_URL);
    expect(result.mainImageSource).toBe("legacy");
  });
});

describe("resolveArticleImages — no image at all", () => {
  it("returns empty strings and 'none' sources for an article with no image columns", () => {
    const result = resolveArticleImages(page({}));
    expect(result).toEqual({
      mainImageUrl: "",
      mainImageSource: "none",
      thumbnailUrl: "",
      thumbnailSource: "none",
    });
  });

  it("treats empty url props and an empty files array as no image", () => {
    const result = resolveArticleImages(
      page({
        [ARTICLE_IMAGE_PROPS.hero]: urlProp(null),
        [ARTICLE_IMAGE_PROPS.thumbnail]: urlProp(""),
        [ARTICLE_IMAGE_PROPS.legacy]: { id: "y", type: "files", files: [] },
      }),
    );
    expect(result.mainImageUrl).toBe("");
    expect(result.thumbnailUrl).toBe("");
    expect(result.mainImageSource).toBe("none");
    expect(result.thumbnailSource).toBe("none");
  });
});

describe("property readers", () => {
  it("readUrlProperty returns '' for a non-url property type", () => {
    expect(
      readUrlProperty(
        page({ [ARTICLE_IMAGE_PROPS.hero]: filesProp(LEGACY_URL) }),
        ARTICLE_IMAGE_PROPS.hero,
      ),
    ).toBe("");
  });

  it("readFilesProperty returns '' for a non-files property type", () => {
    expect(
      readFilesProperty(
        page({ [ARTICLE_IMAGE_PROPS.legacy]: urlProp(HERO_URL) }),
        ARTICLE_IMAGE_PROPS.legacy,
      ),
    ).toBe("");
  });

  it("readFilesProperty reads external file urls", () => {
    expect(
      readFilesProperty(
        page({ [ARTICLE_IMAGE_PROPS.legacy]: externalFilesProp(LEGACY_URL) }),
        ARTICLE_IMAGE_PROPS.legacy,
      ),
    ).toBe(LEGACY_URL);
  });

  it("property names match the elxea-asset-hub write side (ARTICLE_IMAGE_FIELDS)", () => {
    // SoT: elxea-asset-hub lib/article-assign.ts ARTICLE_IMAGE_FIELDS.
    expect(ARTICLE_IMAGE_PROPS.hero).toBe("🌐 Roji: Hero Image");
    expect(ARTICLE_IMAGE_PROPS.thumbnail).toBe("🌐 Roji: Thumbnail");
    expect(ARTICLE_IMAGE_PROPS.legacy).toBe("Featured Image");
  });
});

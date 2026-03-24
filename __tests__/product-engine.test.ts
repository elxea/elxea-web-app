import { describe, it, expect } from "vitest";
import {
  scoreProduct,
  PERSONA_TAG_AFFINITY,
} from "@/lib/recommendations/product-engine";
import type { Product } from "@/lib/shopify/types";
import type { TasteProfile } from "@/lib/firebase/types";

/**
 * Minimal Product factory for testing scoreProduct.
 * Only `tags` is relevant to scoring; other fields are stubs.
 */
function makeProduct(tags: string[]): Product {
  return {
    id: "gid://shopify/Product/1",
    handle: "test-product",
    title: "Test Product",
    description: "",
    descriptionHtml: "",
    tags,
    availableForSale: true,
    priceRange: {
      minVariantPrice: { amount: "1000", currencyCode: "JPY" },
      maxVariantPrice: { amount: "1000", currencyCode: "JPY" },
    },
    featuredImage: null,
    images: [],
    variants: [],
    sellingPlanGroups: [],
    metafields: {
      features: [],
      howToEnjoy: null,
      menuNumber: null,
      teaCategory: null,
      variety: null,
      season: null,
      taste: null,
      aroma: null,
    },
    vendor: "elxea",
  };
}

describe("scoreProduct", () => {
  it("returns 0 when no persona and no taste profile", () => {
    const product = makeProduct(["floral", "green-tea"]);
    expect(scoreProduct(product, null, null)).toBe(0);
  });

  it("adds +3 for persona tag affinity match (serenity + floral)", () => {
    const product = makeProduct(["floral"]);
    expect(scoreProduct(product, "serenity", null)).toBe(3);
  });

  it("adds +3 for persona tag affinity match (explorer + citrus)", () => {
    const product = makeProduct(["citrus", "natural"]);
    expect(scoreProduct(product, "explorer", null)).toBe(3);
  });

  it("adds +3 for persona tag affinity match (sensory + matcha)", () => {
    const product = makeProduct(["matcha"]);
    expect(scoreProduct(product, "sensory", null)).toBe(3);
  });

  it("returns 0 when persona tags do not match product tags", () => {
    const product = makeProduct(["rare", "limited"]);
    // "rare" and "limited" are explorer tags, not serenity tags
    expect(scoreProduct(product, "serenity", null)).toBe(0);
  });

  it("adds +1 for taste profile flavor match", () => {
    const taste: TasteProfile = {
      preferredCategories: [],
      flavorPreferences: ["floral"],
      scenePref: null,
    };
    const product = makeProduct(["jasmine"]); // jasmine is in FLAVOR_TO_TAG_MAP["floral"]
    expect(scoreProduct(product, null, taste)).toBe(1);
  });

  it("caps taste profile bonus at +1 even with multiple flavor matches", () => {
    const taste: TasteProfile = {
      preferredCategories: [],
      flavorPreferences: ["floral", "umami", "sweet"],
      scenePref: null,
    };
    const product = makeProduct(["jasmine", "gyokuro", "hojicha"]);
    expect(scoreProduct(product, null, taste)).toBe(1);
  });

  it("combines persona (+3) and taste (+1) for a total of 4", () => {
    const taste: TasteProfile = {
      preferredCategories: [],
      flavorPreferences: ["sweet"],
      scenePref: null,
    };
    // "hojicha" matches serenity persona AND sweet flavor map
    const product = makeProduct(["hojicha"]);
    expect(scoreProduct(product, "serenity", taste)).toBe(4);
  });

  it("is case-insensitive for product tags", () => {
    const product = makeProduct(["Floral", "GREEN-TEA"]);
    expect(scoreProduct(product, "serenity", null)).toBe(3);
  });

  it("returns 0 for empty tags", () => {
    const product = makeProduct([]);
    expect(scoreProduct(product, "serenity", null)).toBe(0);
  });

  it("returns 0 for empty flavor preferences", () => {
    const taste: TasteProfile = {
      preferredCategories: [],
      flavorPreferences: [],
      scenePref: null,
    };
    const product = makeProduct(["floral"]);
    expect(scoreProduct(product, null, taste)).toBe(0);
  });

  it("PERSONA_TAG_AFFINITY has entries for all persona types", () => {
    expect(Object.keys(PERSONA_TAG_AFFINITY)).toEqual(
      expect.arrayContaining(["serenity", "explorer", "sensory"]),
    );
  });
});

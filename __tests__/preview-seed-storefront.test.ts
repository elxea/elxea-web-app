import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  previewSeedStorefrontEnabled,
  seedProductByHandle,
  seedProductCatalogue,
  seedSearchProducts,
} from "@/lib/preview-seed-storefront";

/**
 * 見本カタログ (`PREVIEW_SEED_STOREFRONT=1`)。
 *
 * CI には Shopify Storefront の資格情報が無く、商品まわりのページが一様に
 * 「商品を読み込めませんでした」へ退避していた。その副作用として
 * 不存在 slug が 200 (soft-404) を返し、0 件検索が障害文言になっていた。
 * 見本カタログはその 3 症状を同時に解く供給元。
 *
 * ここで固定したい契約は 3 つある:
 *   1. フラグは厳密に文字列 "1" のときだけ有効 (truthy 文字列で入らない)
 *   2. 未知の handle は `null` — 呼び出し側が `notFound()` に落として 404 を返せる
 *   3. 検索は部分一致で、ヒットしない語には空配列 — 「0 件」と「壊れている」を
 *      画面上で区別できる唯一の条件
 */

const FLAG = "PREVIEW_SEED_STOREFRONT";
const MASTER = "PREVIEW_SEED";
const LEGACY = "PREVIEW_SEED_EVENTS";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of [FLAG, MASTER, LEGACY]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of [FLAG, MASTER, LEGACY]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("previewSeedStorefrontEnabled", () => {
  it('要求するのは文字列 "1" だけ (truthy 文字列では入らない)', () => {
    expect(previewSeedStorefrontEnabled()).toBe(false);

    process.env[FLAG] = "0";
    expect(previewSeedStorefrontEnabled()).toBe(false);

    process.env[FLAG] = "true";
    expect(previewSeedStorefrontEnabled()).toBe(false);

    process.env[FLAG] = "1";
    expect(previewSeedStorefrontEnabled()).toBe(true);
  });

  it("統合フラグ PREVIEW_SEED=1 でも有効になる", () => {
    process.env[MASTER] = "1";
    expect(previewSeedStorefrontEnabled()).toBe(true);
  });
});

describe("seedProductCatalogue", () => {
  const catalogue = seedProductCatalogue();

  it("handle が一意で、すべて seed- 前置される (実データと混ざらない)", () => {
    const handles = catalogue.map((p) => p.handle);
    expect(handles.length).toBeGreaterThan(1);
    expect(new Set(handles).size).toBe(handles.length);
    for (const p of catalogue) {
      expect(p.handle.startsWith("seed-")).toBe(true);
      expect(p.id.startsWith("seed-")).toBe(true);
    }
  });

  it("商品一覧のチップを組めるだけ productType が散っている", () => {
    // app/[locale]/products/page.tsx は productType の集合からチップを組む。
    // 1 種類しか無いと絞り込み UI が事実上出ないので、複数種を要求する。
    const types = new Set(catalogue.map((p) => p.productType));
    expect(types.size).toBeGreaterThanOrEqual(3);
  });

  it("カード描画が要求する値 (価格・画像・variant) を欠けなく持つ", () => {
    for (const p of catalogue) {
      expect(Number(p.priceRange.minVariantPrice.amount)).toBeGreaterThan(0);
      expect(p.priceRange.minVariantPrice.currencyCode).toBe("JPY");
      expect(p.featuredImage?.url).toMatch(/^\//);
      expect(p.images.length).toBeGreaterThan(0);
      expect(p.variants.length).toBeGreaterThan(0);
    }
  });

  it("定期便 (sellingPlanGroups) は意図的に空", () => {
    // 見本で「定期購入」だけ出しても、カート書き込みは Shopify 実契約が無いと
    // 必ず失敗する。定期便系 e2e は資格情報ゲートのまま残す設計。
    for (const p of catalogue) expect(p.sellingPlanGroups).toEqual([]);
  });

  it("在庫あり / 売り切れの両方を含む (在庫バッジの描画経路が通る)", () => {
    expect(catalogue.some((p) => p.availableForSale)).toBe(true);
    expect(catalogue.some((p) => !p.availableForSale)).toBe(true);
  });

  it("既定の並び (新着順) の先頭は購入可能 = 売り切れは最古の 1 件", () => {
    // 商品一覧の既定は CREATED_AT の降順。先頭カードが売り切れだと
    // 「一覧の最初の商品を開いてバリアントを選ぶ」e2e が disabled ボタンを
    // 掴んで固まる (product.spec.ts で実測)。
    const newestFirst = [...catalogue].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(newestFirst[0].availableForSale).toBe(true);
    expect(newestFirst[0].variants.every((v) => v.availableForSale)).toBe(true);
  });

  it("英語語 (tea) でも検索がヒットするタグを持つ", () => {
    // e2e/search.spec.ts は `q=tea` を投げる。実 Shopify の商品も英語タグを
    // 持つので、見本でも英語で引けることを契約にする。
    expect(seedSearchProducts("tea").length).toBeGreaterThan(0);
  });
});

describe("seedProductByHandle", () => {
  it("既知の handle を返す", () => {
    const first = seedProductCatalogue()[0];
    expect(seedProductByHandle(first.handle)?.title).toBe(first.title);
  });

  it("未知の handle は null (soft-404 ではなく 404 に落とすため)", () => {
    expect(seedProductByHandle("does-not-exist")).toBeNull();
    expect(seedProductByHandle("")).toBeNull();
  });
});

describe("seedSearchProducts", () => {
  it("題名・種類・タグの部分一致でヒットする", () => {
    expect(seedSearchProducts("煎茶").length).toBeGreaterThan(0);
    expect(seedSearchProducts("ほうじ茶").length).toBeGreaterThan(0);
  });

  it("ヒットしない語は空配列 (0 件と障害を画面で区別できる条件)", () => {
    expect(seedSearchProducts("zzz-nonexistent-zzz")).toEqual([]);
  });

  it("空クエリで全件を返さない", () => {
    expect(seedSearchProducts("")).toEqual([]);
    expect(seedSearchProducts("   ")).toEqual([]);
  });
});

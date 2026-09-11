/**
 * デグレ検知テスト: 「本番への書き込みが既定になっている」状態に戻ったら赤くなる。
 *
 * 対象は 2 本の保守スクリプトと、その判定を担う resolver:
 *   - scripts/tag-articles.ts        (Sanity / lib/sanity/write-target.ts)
 *   - scripts/shopify-product-tags.ts (Shopify / lib/shopify/write-target.ts)
 *
 * どちらも以前は「引数を何も渡さずに実行すると本番に書く」形だった。Sanity 側は
 * `const SANITY_DATASET = "production"` のハードコード、Shopify 側は「手元の
 * 認証情報が指している店」がそのまま書き込み先になる形で、どちらも *宣言* では
 * なく *たまたまの状態* が本番書き込みを決めていた。
 *
 * 検査の向きに注意: 「守りが有ること」ではなく **「守りが外れた状態を不合格にする」**
 * 向きに書いてある。ハードコードが戻ってきたら赤、resolver の呼び出しが消えたら赤。
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCredentialsMatchStore,
  isProductionStore,
  PRODUCTION_CONFIRM_FLAG,
  resolveWriteStore,
  ShopifyWriteTargetError,
} from "../lib/shopify/write-target";

const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf-8");

describe("書き込み先の既定値を持たない (Sanity / Shopify)", () => {
  it("tag-articles.ts が production をハードコードせず resolver を使う", () => {
    const src = read("scripts/tag-articles.ts");
    expect(src).not.toMatch(/const SANITY_DATASET\s*=\s*"production"/);
    expect(src).toContain("resolveWriteDatasetOrExit");
  });

  it("shopify-product-tags.ts が store を明示要求する", () => {
    const src = read("scripts/shopify-product-tags.ts");
    expect(src).toContain("resolveWriteStoreOrExit");
    expect(src).toContain("assertCredentialsMatchStoreOrExit");
  });

  it("store 未指定は拒否 (何も書かない)", () => {
    expect(() =>
      resolveWriteStore({
        scriptName: "scripts/shopify-product-tags.ts",
        env: {},
        argv: [],
      }),
    ).toThrow(ShopifyWriteTargetError);
  });

  it("本番 store は確認フラグ無しでは拒否", () => {
    expect(() =>
      resolveWriteStore({
        scriptName: "scripts/shopify-product-tags.ts",
        env: {},
        argv: ["--store", "elxea.myshopify.com"],
      }),
    ).toThrow(/refusing to write to the production store/);

    expect(
      resolveWriteStore({
        scriptName: "scripts/shopify-product-tags.ts",
        env: {},
        argv: ["--store", "elxea.myshopify.com", PRODUCTION_CONFIRM_FLAG],
      }),
    ).toBe("elxea.myshopify.com");
  });

  it("分類は fail-closed: 見慣れない store 名は production 扱い", () => {
    expect(isProductionStore("elxea.myshopify.com")).toBe(true);
    expect(isProductionStore("whatever-shop")).toBe(true);
    expect(isProductionStore("elxea-staging.myshopify.com")).toBe(false);
    expect(isProductionStore("elxea-dev.myshopify.com")).toBe(false);
  });

  it("非本番 store は確認フラグ無しで通る", () => {
    expect(
      resolveWriteStore({
        scriptName: "scripts/shopify-product-tags.ts",
        env: { SHOPIFY_STORE_TARGET: "elxea-staging.myshopify.com" },
        argv: [],
      }),
    ).toBe("elxea-staging.myshopify.com");
  });

  it("宣言した store と手元の認証情報がズレていたら拒否", () => {
    expect(() =>
      assertCredentialsMatchStore(
        "scripts/shopify-product-tags.ts",
        "elxea-staging.myshopify.com",
        "elxea.myshopify.com",
      ),
    ).toThrow(/different stores/);

    expect(() =>
      assertCredentialsMatchStore(
        "scripts/shopify-product-tags.ts",
        "elxea.myshopify.com",
        "ELXEA.myshopify.com",
      ),
    ).not.toThrow();
  });

  it("SHOPIFY_STORE_TARGET は registry 経由で解決できる (env 省略時も生きている)", () => {
    // 既定は envSnapshot()。registry に宣言が無いと、この呼び出しは env var を
    // 設定していても「未指定」として拒否されてしまう。宣言が消えたらここが赤くなる。
    const spec = read("lib/config/spec.ts");
    expect(spec).toContain("SHOPIFY_STORE_TARGET");

    const target = read("lib/shopify/write-target.ts");
    expect(target).toContain("envSnapshot()");
    // lib/** は process.env 直読み禁止 (憲章 R4)。コメントではなく実コードで見る。
    const executable = target
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
    expect(executable).not.toContain("process.env");
  });
});

/**
 * デグレ検知テスト: 「安全側に倒した 3 件」を後から誰かが緩めたら赤くなる。
 *
 *  1. prod-main-sync.yml — `| tee` で監視スクリプトの終了コードが握り潰されない
 *  2. middleware / lib/site-gate — 本番で SITE_PASSWORD が無ければ配信を拒否する
 *  3. scripts/tag-articles.ts, scripts/shopify-product-tags.ts — 書き込み先の
 *     既定値 (production) を持たない
 *
 * どれも「守りを外したら赤くなる」向きに書いてある (守りが有ることの検査ではなく、
 * 守りが外れた状態を不合格にする検査)。
 */

import { execFileSync } from "node:child_process";
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
import { resolveSiteGateMode } from "../lib/site-gate";

const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf-8");

// ───────────────────────────────────────────────────────────────
// 1. 監視の失敗が握り潰されない
// ───────────────────────────────────────────────────────────────

describe("prod-main-sync workflow: パイプで終了コードが消えない", () => {
  const workflow = read(".github/workflows/prod-main-sync.yml");

  it("これが事故の実体: pipefail の無い bash では非 0 終了がパイプに吸われる", () => {
    // GitHub Actions の既定シェルは `bash -e {0}` (pipefail 無し)。
    // このテストは「なぜ shell: bash が要るのか」を実測で固定する。
    const runExitCode = (shellArgs: string[]): number => {
      try {
        execFileSync("bash", [...shellArgs, "-c", "exit 3 | tee /dev/null"], {
          stdio: "ignore",
        });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? -1;
      }
    };

    expect(runExitCode(["-e"])).toBe(0); // 既定シェル相当 = 握り潰される
    expect(runExitCode(["-eo", "pipefail"])).toBe(3); // 明示 shell 相当 = 伝わる
  });

  it("check step が明示 shell (pipefail 付き) で動く", () => {
    expect(workflow).toMatch(/^\s*shell: bash$/m);
    expect(workflow).toContain("set -euo pipefail");
  });

  it("`| tee` を含む run ブロックはすべて pipefail 配下にある", () => {
    // run: | ブロック単位に切り出し、tee を使うブロックが pipefail を宣言して
    // いるか、pipefail 付き shell を指定した step 内にあるかを見る。
    const steps = workflow
      .split(/\n(?=      - name: )/)
      // 先頭チャンクは `on:` / `jobs:` のヘッダ (step ではない) なので落とす
      .filter((chunk) => chunk.startsWith("      - name: "));
    const teeSteps = steps.filter((step) => /\|\s*tee\b/.test(step));
    expect(teeSteps.length).toBeGreaterThan(0);
    for (const step of teeSteps) {
      const guarded =
        /set -[a-z]*o pipefail/.test(step) ||
        /set -o pipefail/.test(step) ||
        /shell: bash/.test(step);
      expect(guarded, `pipefail 無しで tee を使う step がある:\n${step}`).toBe(
        true,
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────
// 2. サイトのパスワード保護が無言で外れない
// ───────────────────────────────────────────────────────────────

describe("site gate: 本番は fail-closed / ローカルは開く / preview は現状維持", () => {
  it("本番 + SITE_PASSWORD 未設定 → deny (以前は素通りだった)", () => {
    expect(resolveSiteGateMode({ VERCEL_ENV: "production" })).toBe("deny");
    expect(
      resolveSiteGateMode({ VERCEL_ENV: "production", SITE_PASSWORD: "" }),
    ).toBe("deny");
    expect(
      resolveSiteGateMode({ VERCEL_ENV: "production", SITE_PASSWORD: "   " }),
    ).toBe("deny");
  });

  it("本番 + SITE_PASSWORD 設定済み → 従来どおりパスワード検査 (保護を弱めない)", () => {
    expect(
      resolveSiteGateMode({ VERCEL_ENV: "production", SITE_PASSWORD: "x" }),
    ).toBe("require-password");
  });

  it("ローカル (VERCEL_ENV 未設定) + 未設定 → 開く (開発が止まらない)", () => {
    expect(resolveSiteGateMode({})).toBe("open");
    expect(resolveSiteGateMode({ VERCEL_ENV: "development" })).toBe("open");
  });

  it("ローカル + SITE_PASSWORD 設定済み → 従来どおり検査", () => {
    expect(resolveSiteGateMode({ SITE_PASSWORD: "x" })).toBe(
      "require-password",
    );
  });

  it("preview は現状維持 (設定の有無によらず免除)", () => {
    expect(resolveSiteGateMode({ VERCEL_ENV: "preview" })).toBe("open");
    expect(
      resolveSiteGateMode({ VERCEL_ENV: "preview", SITE_PASSWORD: "x" }),
    ).toBe("open");
  });

  it("判定はプラットフォーム値のみ: クライアント由来の入力では覆らない", () => {
    // ヘッダ・ホスト・クッキーを詐称しても本番の deny は覆らない
    const spoofed = {
      VERCEL_ENV: "production",
      "x-vercel-deployment-url": "preview.example.com",
      host: "localhost:3000",
      cookie: "site_auth=whatever",
      NODE_ENV: "development",
    } as Record<string, string>;
    expect(resolveSiteGateMode(spoofed)).toBe("deny");
  });

  it("middleware から fail-open の一行 (`if (!SITE_PASSWORD) return null;`) が消えている", () => {
    const middleware = read("middleware.ts");
    expect(middleware).not.toMatch(/if \(!SITE_PASSWORD\) return null;/);
    expect(middleware).toContain("resolveSiteGateMode");
    expect(middleware).toContain("SITE_GATE_DENY_STATUS");
  });
});

// ───────────────────────────────────────────────────────────────
// 3. 本番に書き込む既定が残っていない
// ───────────────────────────────────────────────────────────────

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
});

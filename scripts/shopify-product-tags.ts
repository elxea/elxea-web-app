/**
 * Shopify product tag enrichment script
 * Run with: pnpm tsx scripts/shopify-product-tags.ts --store <domain>
 * Dry run:   pnpm tsx scripts/shopify-product-tags.ts --store <domain> --dry-run
 *
 * There is no default store. `--dry-run` is opt-in, so a bare invocation used to
 * mutate whichever shop the on-disk credentials happened to belong to; the
 * target must now be named explicitly and a live shop additionally requires
 * --i-know-this-is-production (see lib/shopify/write-target.ts).
 *
 * Adds tea-type and flavor-profile tags to Shopify products for
 * persona×product recommendation affinity mapping.
 *
 * tag format:
 *   tea-type:<value>     — green / black / oolong / hojicha / herb / event
 *   flavor-profile:<value> — floral / earthy / umami / sweet / citrus / rich
 *
 * Admin API token is read from SHOPIFY_ACCESS_TOKEN in elxea-broadcaster .env.local
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  assertCredentialsMatchStoreOrExit,
  resolveWriteStoreOrExit,
} from "../lib/shopify/write-target";

// ─── Config ──────────────────────────────────────────────────

const SCRIPT_NAME = "scripts/shopify-product-tags.ts";

// Fail-closed: resolved before any credential is read and before any Admin API
// call. Exits non-zero (writing nothing) when the target store is unnamed, or
// when it is a live shop without the explicit confirmation flag.
const REQUESTED_STORE = resolveWriteStoreOrExit({ scriptName: SCRIPT_NAME });

// Load token from elxea-broadcaster .env.local
const broadcasterEnvPath = join(
  process.env.HOME || "",
  "github/elxea/agents/elxea-broadcaster/.env.local"
);
let SHOPIFY_ACCESS_TOKEN = "";
let SHOPIFY_STORE_DOMAIN = "";
try {
  const lines = readFileSync(broadcasterEnvPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^(\w+)=(.+)$/);
    if (!m) continue;
    if (m[1] === "SHOPIFY_ACCESS_TOKEN") SHOPIFY_ACCESS_TOKEN = m[2].trim();
    if (m[1] === "SHOPIFY_STORE_DOMAIN") SHOPIFY_STORE_DOMAIN = m[2].trim();
  }
} catch {
  console.error(`Could not read ${broadcasterEnvPath}`);
  process.exit(1);
}

if (!SHOPIFY_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
  console.error("Missing SHOPIFY_ACCESS_TOKEN or SHOPIFY_STORE_DOMAIN");
  process.exit(1);
}

// The credentials file is not a declaration of intent: refuse when the operator
// named one store but is holding another store's Admin API token.
assertCredentialsMatchStoreOrExit(
  SCRIPT_NAME,
  REQUESTED_STORE,
  SHOPIFY_STORE_DOMAIN,
);

const isDryRun = process.argv.includes("--dry-run");

// ─── Tag additions per product (Shopify GID) ─────────────────
//
// tea-type values:  green | black | oolong | event
// flavor-profile:   floral | earthy | umami | sweet | citrus | rich
//
// Existing tags are preserved; only the new tags are added.

type ProductTagSpec = {
  title: string;
  addTags: string[];
};

const PRODUCT_TAG_SPECS: Record<string, ProductTagSpec> = {
  // ── 単品: 和紅茶 ──────────────────────────────────────────
  "gid://shopify/Product/6827728699550": {
    title: "N°01 香駿",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7093785034910": {
    title: "N°02 べにふうき",
    addTags: ["tea-type:black", "flavor-profile:floral"],
  },
  "gid://shopify/Product/7093786247326": {
    title: "N°03 べにふうき",
    addTags: ["tea-type:black", "flavor-profile:floral"],
  },
  "gid://shopify/Product/7722896523422": {
    title: "べにふうきの和紅茶",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7722896851102": {
    title: "いずみの和紅茶",
    addTags: ["tea-type:black", "flavor-profile:rich", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7756199821470": {
    title: "香駿の和紅茶",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  // ── 単品: 緑茶 ──────────────────────────────────────────
  "gid://shopify/Product/7718802030750": {
    title: "やぶきたの手摘み煎茶",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7718815105182": {
    title: "大井早生の手摘み煎茶",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7718815203486": {
    title: "ふくみどりの萎凋釜炒り緑茶入り",
    addTags: ["tea-type:green", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7718815727774": {
    title: "香駿の萎凋釜炒り緑茶",
    addTags: ["tea-type:green", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7718865338526": {
    title: "みなみさやかの萎凋釜炒り緑茶",
    addTags: ["tea-type:green", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7756120424606": {
    title: "静七一三二の萎凋煎茶",
    addTags: ["tea-type:green", "flavor-profile:floral", "flavor-profile:umami"],
  },
  // ── 単品: 烏龍茶 ─────────────────────────────────────────
  "gid://shopify/Product/7718871433374": {
    title: "香駿の和烏龍茶 (A)",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7718877954206": {
    title: "香駿の和烏龍茶 (B)",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7718881427614": {
    title: "みなみさやかの和烏龍茶",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  // ── 定期便（初回特別価格）────────────────────────────────
  "gid://shopify/Product/7681256685726": {
    title: "緑茶の定期便：翠【初回特別価格】",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7709451288734": {
    title: "和烏龍茶の定期便：纁【初回特別価格】",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7709459087518": {
    title: "和紅茶の定期便：茜【初回特別価格】",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  // ── 定期便（通常）────────────────────────────────────────
  "gid://shopify/Product/7927856201886": {
    title: "和烏龍茶の定期便：纁",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/7927856398494": {
    title: "和紅茶の定期便：茜",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/7927856464030": {
    title: "緑茶の定期便：翠",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  // ── サンプル ──────────────────────────────────────────────
  "gid://shopify/Product/8261514723486": {
    title: "【サンプル】和紅茶のアソートセット：茜",
    addTags: ["tea-type:black", "flavor-profile:floral", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/8261516656798": {
    title: "【サンプル】和烏龍茶のアソートセット：纁",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/8261516853406": {
    title: "【サンプル】緑茶のアソートセット：翠",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  // ── アソートセット: 茜（和紅茶）────────────────────────────
  "gid://shopify/Product/8604656238750": {
    title: "茜 Vol.01｜芳醇な味わいの和紅茶のアソートセット",
    addTags: ["tea-type:black", "flavor-profile:rich", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/8604656271518": {
    title: "茜 Vol.02｜花香る和紅茶のアソートセット",
    addTags: ["tea-type:black", "flavor-profile:floral"],
  },
  "gid://shopify/Product/8604656304286": {
    title: "茜 Vol.03｜香り深まる滋味の和紅茶のアソートセット",
    addTags: ["tea-type:black", "flavor-profile:rich", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/8604656337054": {
    title: "茜 Vol.04｜瑞々しく爽快な和紅茶のアソートセット",
    addTags: ["tea-type:black", "flavor-profile:citrus"],
  },
  "gid://shopify/Product/8604656369822": {
    title: "茜 Vol.05｜和紅茶のアソートセット",
    addTags: ["tea-type:black", "flavor-profile:sweet"],
  },
  // ── アソートセット: 翠（緑茶）────────────────────────────
  "gid://shopify/Product/8604656435358": {
    title: "翠 Vol.01｜手摘み煎茶のアソートセット",
    addTags: ["tea-type:green", "flavor-profile:umami", "flavor-profile:sweet"],
  },
  "gid://shopify/Product/8604656500894": {
    title: "翠 Vol.02｜釜炒り茶のアソートセット",
    addTags: ["tea-type:green", "flavor-profile:earthy", "flavor-profile:floral"],
  },
  "gid://shopify/Product/8604656533662": {
    title: "翠 Vol.03｜萎凋煎茶のアソートセット",
    addTags: ["tea-type:green", "flavor-profile:floral"],
  },
  "gid://shopify/Product/8604656566430": {
    title: "翠 Vol.04｜緑茶のアソートセット",
    addTags: ["tea-type:green", "flavor-profile:umami"],
  },
  "gid://shopify/Product/8604656599198": {
    title: "翠 Vol.05｜昔づくりのお茶のアソートセット",
    addTags: ["tea-type:green", "flavor-profile:earthy", "flavor-profile:sweet"],
  },
  // ── アソートセット: 纁（和烏龍茶）───────────────────────────
  "gid://shopify/Product/8604656631966": {
    title: "纁 Vol.01｜やわらかな花香の和烏龍茶のアソートセット",
    addTags: ["tea-type:oolong", "flavor-profile:floral"],
  },
  "gid://shopify/Product/8604656664734": {
    title: "纁 Vol.02｜澄んだ味わいの和烏龍茶のアソートセット",
    addTags: ["tea-type:oolong", "flavor-profile:sweet", "flavor-profile:floral"],
  },
  "gid://shopify/Product/8604656697502": {
    title: "纁 Vol.03｜和烏龍茶のアソートセット",
    addTags: ["tea-type:oolong", "flavor-profile:earthy"],
  },
  "gid://shopify/Product/8604656730270": {
    title: "纁 Vol.04｜和烏龍茶のアソートセット",
    addTags: ["tea-type:oolong", "flavor-profile:floral", "flavor-profile:rich"],
  },
  "gid://shopify/Product/8604656763038": {
    title: "纁 Vol.05｜和烏龍茶のアソートセット",
    addTags: ["tea-type:oolong", "flavor-profile:sweet", "flavor-profile:earthy"],
  },
  // ── イベント ──────────────────────────────────────────────
  "gid://shopify/Product/7088963879070": {
    title: "世界の喫茶文化にふれる",
    addTags: ["tea-type:event"],
  },
  "gid://shopify/Product/7088964010142": {
    title: "やさしい循環 | 鍼灸×薬膳×茶",
    addTags: ["tea-type:event"],
  },
};

// ─── Shopify GraphQL helpers ─────────────────────────────────

async function fetchProductTags(productId: string): Promise<string[]> {
  const query = `{
    product(id: "${productId}") {
      tags
    }
  }`;
  const res = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const json = (await res.json()) as {
    data?: { product?: { tags: string[] } };
    errors?: unknown[];
  };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data?.product?.tags ?? [];
}

async function updateProductTags(
  productId: string,
  tags: string[]
): Promise<void> {
  const mutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id tags }
        userErrors { field message }
      }
    }
  `;
  const res = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: { input: { id: productId, tags } },
      }),
    }
  );
  const json = (await res.json()) as {
    data?: { productUpdate?: { userErrors: { message: string }[] } };
    errors?: unknown[];
  };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const userErrors = json.data?.productUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join(", "));
  }
}

// ─── Coverage summary ─────────────────────────────────────────

function printCoverageSummary() {
  const teaTypeCounts: Record<string, number> = {};
  const flavorCounts: Record<string, number> = {};

  for (const spec of Object.values(PRODUCT_TAG_SPECS)) {
    for (const tag of spec.addTags) {
      if (tag.startsWith("tea-type:")) {
        const v = tag.slice(9);
        teaTypeCounts[v] = (teaTypeCounts[v] || 0) + 1;
      } else if (tag.startsWith("flavor-profile:")) {
        const v = tag.slice(15);
        flavorCounts[v] = (flavorCounts[v] || 0) + 1;
      }
    }
  }

  console.log("\n── Coverage Summary ──────────────────────────────────");
  console.log("tea-type:      ", teaTypeCounts);
  console.log("flavor-profile:", flavorCounts);
  console.log("Total products:", Object.keys(PRODUCT_TAG_SPECS).length);
  console.log("──────────────────────────────────────────────────────\n");
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(
    isDryRun
      ? "[DRY RUN] No writes will be made.\n"
      : "[EXECUTE] Writing to Shopify...\n"
  );

  printCoverageSummary();

  let successCount = 0;
  let errorCount = 0;

  for (const [productId, spec] of Object.entries(PRODUCT_TAG_SPECS)) {
    console.log(`[${spec.title}]`);
    console.log(`  id:       ${productId}`);
    console.log(`  add tags: ${spec.addTags.join(", ")}`);

    if (!isDryRun) {
      try {
        // Fetch current tags and merge
        const currentTags = await fetchProductTags(productId);
        const newTagsToAdd = spec.addTags.filter((t) => !currentTags.includes(t));
        if (newTagsToAdd.length === 0) {
          console.log(`  -> already tagged, skipped`);
          successCount++;
          continue;
        }
        const mergedTags = [...currentTags, ...newTagsToAdd];
        await updateProductTags(productId, mergedTags);
        console.log(`  -> updated (+${newTagsToAdd.join(", ")})`);
        successCount++;
      } catch (err) {
        console.error(`  -> ERROR:`, err);
        errorCount++;
      }
    } else {
      console.log(`  -> (dry run, skipped)`);
      successCount++;
    }
  }

  console.log(
    `\nDone. ${successCount} products ${isDryRun ? "checked" : "updated"}, ${errorCount} errors.`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

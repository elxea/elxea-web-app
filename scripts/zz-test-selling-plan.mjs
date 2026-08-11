/**
 * zz テスト用 50 円定期便プランの検証・後片付けスクリプト (一時的)
 *
 * 実カード決済テスト専用に作成した selling plan group
 *   「zz 動作確認用プラン (テスト後削除)」 (SellingPlanGroup/2833744030)
 * と、テスト商品 zz-internal-payment-test-subscription を扱う。
 *
 * 使い方:
 *   node scripts/zz-test-selling-plan.mjs verify    # 現状確認 (読み取りのみ)
 *   node scripts/zz-test-selling-plan.mjs cleanup   # テスト完了後の後片付け
 *
 * cleanup がやること:
 *   1. テスト用 selling plan group を削除 (本番「elxea 定期便プラン」には触れない)
 *   2. テスト商品 2 種 (単発 / 定期便) を DRAFT に戻す
 *
 * 認証情報は elxea-web-app/.env.local のみを参照する (lib/shopify/admin-client.ts と同じ env)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv();
const API_VERSION = "2025-04";

async function admin(query, variables) {
  const res = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (json.errors) console.error("GRAPHQL_ERRORS", JSON.stringify(json.errors, null, 2));
  return json;
}

const show = (label, obj) => {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(obj, null, 2));
};

const TEST_GROUP_ID = "gid://shopify/SellingPlanGroup/2833744030";
const PROD_GROUP_ID = "gid://shopify/SellingPlanGroup/2088960158";
const TEST_PRODUCT_IDS = [
  "gid://shopify/Product/8831072600222", // zz-internal-payment-test-onetime
  "gid://shopify/Product/8831072632990", // zz-internal-payment-test-subscription
];

async function verify() {
  const r = await admin(`
    query {
      testGroup: sellingPlanGroup(id: "${TEST_GROUP_ID}") {
        id name merchantCode productsCount { count }
        products(first: 20) { edges { node { handle } } }
        sellingPlans(first: 10) { edges { node {
          id name
          pricingPolicies {
            ... on SellingPlanFixedPricingPolicy { adjustmentType adjustmentValue { ... on MoneyV2 { amount currencyCode } } }
            ... on SellingPlanRecurringPricingPolicy { adjustmentType afterCycle adjustmentValue { ... on MoneyV2 { amount currencyCode } } }
          }
        } } }
      }
      prodGroup: sellingPlanGroup(id: "${PROD_GROUP_ID}") {
        id name productsCount { count }
        products(first: 20) { edges { node { handle } } }
      }
    }
  `);
  show("VERIFY", r.data);
}

async function cleanup() {
  const del = await admin(
    `mutation Del($id: ID!) {
      sellingPlanGroupDelete(id: $id) {
        deletedSellingPlanGroupId
        userErrors { field message }
      }
    }`,
    { id: TEST_GROUP_ID }
  );
  show("DELETE_TEST_GROUP", del.data?.sellingPlanGroupDelete);

  for (const id of TEST_PRODUCT_IDS) {
    const r = await admin(
      `mutation Draft($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id handle status }
          userErrors { field message }
        }
      }`,
      { input: { id, status: "DRAFT" } }
    );
    show(`DRAFT_PRODUCT ${id}`, r.data?.productUpdate);
  }
}

const cmd = process.argv[2];
if (cmd === "verify") await verify();
else if (cmd === "cleanup") await cleanup();
else {
  console.error("usage: node scripts/zz-test-selling-plan.mjs <verify|cleanup>");
  process.exit(1);
}

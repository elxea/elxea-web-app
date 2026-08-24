// Read-only: Storefront API check — does the test subscription product expose
// its selling plan group / allocations to the headless storefront?
import { readFileSync } from "node:fs";
const APP = "/Users/setaka/github/elxea/products/elxea-web-app";
function loadEnv(p) {
  const o = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}
const e = { ...loadEnv(`${APP}/.env`), ...loadEnv(`${APP}/.env.local`) };
const domain = e.SHOPIFY_STORE_DOMAIN.trim();
const token = e.SHOPIFY_STOREFRONT_ACCESS_TOKEN.trim();
const VER = "2026-07";

const query = `
{
  a: product(handle: "zz-internal-payment-test-subscription") {
    id title availableForSale requiresSellingPlan
    sellingPlanGroups(first: 5) { edges { node { name options { name values } sellingPlans(first: 5) { edges { node { id name recurringDeliveries } } } } } }
    variants(first: 3) { edges { node { id title
      sellingPlanAllocations(first: 5) { edges { node { sellingPlan { id name } priceAdjustments { price { amount currencyCode } } } } }
    } } }
  }
  b: product(handle: "zz-internal-payment-test") {
    id title availableForSale
    sellingPlanGroups(first: 5) { edges { node { name } } }
  }
}`;

const res = await fetch(`https://${domain}/api/${VER}/graphql.json`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Storefront-Access-Token": token,
  },
  body: JSON.stringify({ query }),
});
console.log("http", res.status);
console.log(JSON.stringify(await res.json(), null, 2));

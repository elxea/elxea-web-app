/**
 * Shopify data backup script.
 *
 * Exports key Shopify data (products, customers, orders) to local JSON files
 * via the Shopify Admin GraphQL API.
 *
 * Usage:
 *   npx tsx scripts/backup-shopify.ts
 *   npx tsx scripts/backup-shopify.ts --output ./backups --types products,customers
 *
 * Requirements:
 *   - SHOPIFY_STORE_DOMAIN in .env (e.g. your-store.myshopify.com)
 *   - SHOPIFY_ADMIN_ACCESS_TOKEN in .env (needs read_products, read_customers, read_orders)
 *
 * Output:
 *   ./backups/shopify-{type}-{YYYY-MM-DD}.json
 *
 * Recovery procedure:
 *   See the "Recovery" section at the bottom of this file.
 *
 * NOTE: Shopify does not support bulk re-import via API for all data types.
 * Backups are primarily for audit/reference. Structural data (products) can
 * be re-created via Shopify REST/GraphQL. Orders and customers cannot be
 * re-imported and serve as records only.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { readFileSync } from "fs";

import { SHOPIFY_API_VERSION } from "../lib/shopify/api-version";

// ─── Config ───────────────────────────────────────────────────────────

// Load .env manually (tsx doesn't auto-load it)
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(join(process.cwd(), ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env not found; rely on process.env
  }
  return env;
}

const localEnv = loadEnv();
const getEnv = (key: string): string =>
  process.env[key] || localEnv[key] || "";

const STORE_DOMAIN = getEnv("SHOPIFY_STORE_DOMAIN");
const ACCESS_TOKEN = getEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const API_VERSION = SHOPIFY_API_VERSION;
const ADMIN_ENDPOINT = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string): string => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};
const OUTPUT_DIR = getArg("--output", join(process.cwd(), "backups"));
const TYPE_ARG = getArg("--types", "products,customers,orders");
const BACKUP_TYPES = TYPE_ARG.split(",").map((t) => t.trim()) as BackupType[];

type BackupType = "products" | "customers" | "orders";

// ─── GraphQL helpers ──────────────────────────────────────────────────

type AdminResponse<T> = {
  data: T;
  errors?: { message: string }[];
};

async function adminFetch<T>(query: string): Promise<T> {
  if (!STORE_DOMAIN || !ACCESS_TOKEN) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env"
    );
  }

  const res = await fetch(ADMIN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  const json: AdminResponse<T> = await res.json();
  if (json.errors) {
    throw new Error(
      `GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }
  return json.data;
}

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

/** Paginate through a Shopify connection and collect all nodes. */
async function fetchAll<TNode>(
  queryFn: (after: string | null) => string,
  extractPage: (data: unknown) => { nodes: TNode[]; pageInfo: PageInfo }
): Promise<TNode[]> {
  const all: TNode[] = [];
  let cursor: string | null = null;
  let page = 1;

  while (true) {
    process.stdout.write(`  page ${page}...`);
    const data = await adminFetch<unknown>(queryFn(cursor));
    const { nodes, pageInfo } = extractPage(data);
    all.push(...nodes);
    process.stdout.write(` ${nodes.length} records\n`);

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
    page++;

    // Polite rate-limit pause (250ms between pages)
    await new Promise((r) => setTimeout(r, 250));
  }

  return all;
}

// ─── Queries ──────────────────────────────────────────────────────────

const PRODUCTS_QUERY = (after: string | null) => `
  {
    products(first: 250${after ? `, after: "${after}"` : ""}) {
      nodes {
        id title handle status vendor productType tags createdAt updatedAt
        variants(first: 100) {
          nodes { id title sku price inventoryQuantity }
        }
        images(first: 5) {
          nodes { url altText }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CUSTOMERS_QUERY = (after: string | null) => `
  {
    customers(first: 250${after ? `, after: "${after}"` : ""}) {
      nodes {
        id displayName email phone createdAt ordersCount tags note
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDERS_QUERY = (after: string | null) => `
  {
    orders(first: 250${after ? `, after: "${after}"` : ""}, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id name createdAt financialStatus fulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id displayName email }
        lineItems(first: 50) {
          nodes { title quantity variant { sku } }
        }
        shippingAddress {
          firstName lastName address1 address2 city province country zip
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

function saveJson(data: unknown, filename: string): void {
  const outputPath = join(OUTPUT_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  const sizeKB = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024);
  console.log(`Saved: ${outputPath} (${sizeKB} KB)`);
}

// ─── Backup runners ───────────────────────────────────────────────────

async function backupProducts() {
  console.log("\n[Products] Fetching...");
  type D = { products: { nodes: unknown[]; pageInfo: PageInfo } };
  const items = await fetchAll<unknown>(PRODUCTS_QUERY, (d) => (d as D).products);
  saveJson(
    { exportedAt: new Date().toISOString(), count: items.length, products: items },
    `shopify-products-${isoDate()}.json`
  );
  console.log(`Products: ${items.length} exported`);
}

async function backupCustomers() {
  console.log("\n[Customers] Fetching...");
  type D = { customers: { nodes: unknown[]; pageInfo: PageInfo } };
  const items = await fetchAll<unknown>(CUSTOMERS_QUERY, (d) => (d as D).customers);
  saveJson(
    { exportedAt: new Date().toISOString(), count: items.length, customers: items },
    `shopify-customers-${isoDate()}.json`
  );
  console.log(`Customers: ${items.length} exported`);
}

async function backupOrders() {
  console.log("\n[Orders] Fetching (latest first)...");
  type D = { orders: { nodes: unknown[]; pageInfo: PageInfo } };
  const items = await fetchAll<unknown>(ORDERS_QUERY, (d) => (d as D).orders);
  saveJson(
    { exportedAt: new Date().toISOString(), count: items.length, orders: items },
    `shopify-orders-${isoDate()}.json`
  );
  console.log(`Orders: ${items.length} exported`);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Shopify Data Backup ===");
  console.log(`Store:  ${STORE_DOMAIN || "(not set)"}`);
  console.log(`Types:  ${BACKUP_TYPES.join(", ")}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  ensureDir(OUTPUT_DIR);

  const runners: Record<BackupType, () => Promise<void>> = {
    products: backupProducts,
    customers: backupCustomers,
    orders: backupOrders,
  };

  for (const type of BACKUP_TYPES) {
    if (runners[type]) {
      await runners[type]();
    } else {
      console.warn(`Unknown backup type: ${type}. Skipping.`);
    }
  }

  console.log("\n=== Backup complete ===");
}

main().catch((err) => {
  console.error("\nBackup failed:", err.message);
  process.exit(1);
});

/*
 * ─── Recovery Procedure ───────────────────────────────────────────────
 *
 * ## Products (can be re-imported via Shopify CSV or API)
 *
 * Option A — Shopify Admin CSV import:
 *   1. Convert the JSON to Shopify's product CSV format
 *   2. Shopify Admin > Products > Import
 *
 * Option B — Shopify Admin API (programmatic):
 *   Use `productCreate` / `productUpdate` mutations with the exported data.
 *   Each product node in the JSON backup maps 1:1 to the API schema.
 *
 * ## Customers
 *   Shopify does NOT support bulk customer re-import via API.
 *   Customer backups serve as an audit record.
 *   To restore customer data, use:
 *     Shopify Admin > Customers > Import customers (CSV)
 *   Note: Passwords, metafields, and some metadata cannot be restored.
 *
 * ## Orders
 *   Shopify does NOT support order re-import.
 *   Order backups are for reference/audit only.
 *   In disaster scenarios, contact Shopify Support for data restoration.
 *
 * ## Recommended backup schedule
 *   - Products: Weekly (products change infrequently)
 *   - Customers: Weekly
 *   - Orders: Daily (orders accumulate continuously)
 *
 * ## Automation (example cron)
 *   # Add to crontab or a CI/CD scheduled job:
 *   0 2 * * * cd /path/to/elxea-developer && npx tsx scripts/backup-shopify.ts
 */

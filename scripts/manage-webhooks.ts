#!/usr/bin/env npx tsx
/**
 * Shopify Webhook Management Script
 *
 * Usage:
 *   npx tsx scripts/manage-webhooks.ts list       # List all webhooks
 *   npx tsx scripts/manage-webhooks.ts cleanup     # Delete preview URL webhooks
 *   npx tsx scripts/manage-webhooks.ts register    # Register production webhooks
 *   npx tsx scripts/manage-webhooks.ts sync        # cleanup + register (idempotent)
 *
 * Requires .env.local with:
 *   SHOPIFY_STORE_DOMAIN
 *   SHOPIFY_ADMIN_ACCESS_TOKEN
 */

import { config } from "dotenv";
import path from "path";

// Load .env.local from project root
config({ path: path.resolve(__dirname, "../.env.local") });

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2025-04";
const PRODUCTION_HOST = "elxea.com";

if (!STORE_DOMAIN || !ACCESS_TOKEN) {
  console.error(
    "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN in .env.local",
  );
  process.exit(1);
}

const baseUrl = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyWebhook {
  id: number;
  address: string;
  topic: string;
  created_at: string;
  updated_at: string;
  format: string;
  api_version: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function shopifyRest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify REST ${method} ${path}: ${res.status} ${text}`);
  }

  // DELETE returns 200 with empty body
  if (method === "DELETE") return {} as T;

  return res.json() as Promise<T>;
}

async function listWebhooks(): Promise<ShopifyWebhook[]> {
  const data = await shopifyRest<{ webhooks: ShopifyWebhook[] }>(
    "/webhooks.json",
  );
  return data.webhooks;
}

async function deleteWebhook(id: number): Promise<void> {
  await shopifyRest(`/webhooks/${id}.json`, "DELETE");
}

async function createWebhook(
  topic: string,
  address: string,
): Promise<ShopifyWebhook> {
  const data = await shopifyRest<{ webhook: ShopifyWebhook }>(
    "/webhooks.json",
    "POST",
    {
      webhook: {
        topic,
        address,
        format: "json",
      },
    },
  );
  return data.webhook;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(): Promise<void> {
  const webhooks = await listWebhooks();

  if (webhooks.length === 0) {
    console.log("No webhooks registered.");
    return;
  }

  console.log(`\nFound ${webhooks.length} webhook(s):\n`);
  console.log(
    "ID".padEnd(15) +
      "Topic".padEnd(45) +
      "Address".padEnd(60) +
      "API Version",
  );
  console.log("-".repeat(130));

  for (const wh of webhooks) {
    const isPreview = wh.address.includes(".vercel.app");
    const marker = isPreview ? " [PREVIEW]" : "";
    console.log(
      String(wh.id).padEnd(15) +
        wh.topic.padEnd(45) +
        (wh.address + marker).padEnd(60) +
        wh.api_version,
    );
  }
}

async function cmdCleanup(): Promise<number> {
  const webhooks = await listWebhooks();
  const previewWebhooks = webhooks.filter((wh) =>
    wh.address.includes(".vercel.app"),
  );

  if (previewWebhooks.length === 0) {
    console.log("No preview URL webhooks found. Nothing to clean up.");
    return 0;
  }

  console.log(
    `\nFound ${previewWebhooks.length} preview webhook(s) to delete:\n`,
  );

  for (const wh of previewWebhooks) {
    console.log(`  Deleting: [${wh.topic}] ${wh.address} (id=${wh.id})`);
    await deleteWebhook(wh.id);
    console.log(`  Deleted.`);
  }

  console.log(`\nCleaned up ${previewWebhooks.length} preview webhook(s).`);
  return previewWebhooks.length;
}

/**
 * Desired production webhooks. Add new topics here to auto-register.
 */
const DESIRED_WEBHOOKS: { topic: string; path: string }[] = [
  { topic: "orders/create", path: "/api/webhooks/orders" },
  {
    topic: "subscription_contracts/create",
    path: "/api/subscription/webhook",
  },
  {
    topic: "subscription_contracts/update",
    path: "/api/subscription/webhook",
  },
  {
    topic: "subscription_billing_attempts/success",
    path: "/api/subscription/webhook",
  },
  {
    topic: "subscription_billing_attempts/failure",
    path: "/api/subscription/webhook",
  },
  // Inventory monitoring (triggers pipeline job)
  {
    topic: "inventory_levels/update",
    path: "/api/webhooks/inventory",
  },
  // GDPR mandatory webhooks
  {
    topic: "customers/data_request",
    path: "/api/webhooks/gdpr/customers-data-request",
  },
  {
    topic: "customers/redact",
    path: "/api/webhooks/gdpr/customers-redact",
  },
  {
    topic: "shop/redact",
    path: "/api/webhooks/gdpr/shop-redact",
  },
];

async function cmdRegister(): Promise<number> {
  const existing = await listWebhooks();
  let created = 0;

  for (const desired of DESIRED_WEBHOOKS) {
    const address = `https://${PRODUCTION_HOST}${desired.path}`;

    const alreadyExists = existing.some(
      (wh) => wh.topic === desired.topic && wh.address === address,
    );

    if (alreadyExists) {
      console.log(`  [skip] ${desired.topic} -> ${address} (already exists)`);
      continue;
    }

    console.log(`  [create] ${desired.topic} -> ${address}`);
    const wh = await createWebhook(desired.topic, address);
    console.log(`  Created webhook id=${wh.id}`);
    created++;
  }

  if (created === 0) {
    console.log("\nAll production webhooks already registered.");
  } else {
    console.log(`\nRegistered ${created} new webhook(s).`);
  }

  return created;
}

async function cmdSync(): Promise<void> {
  console.log("=== Step 1: Cleanup preview webhooks ===");
  await cmdCleanup();

  console.log("\n=== Step 2: Register production webhooks ===");
  await cmdRegister();

  console.log("\n=== Final state ===");
  await cmdList();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "list":
      await cmdList();
      break;
    case "cleanup":
      await cmdCleanup();
      break;
    case "register":
      await cmdRegister();
      break;
    case "sync":
      await cmdSync();
      break;
    default:
      console.log("Usage: npx tsx scripts/manage-webhooks.ts <command>");
      console.log("");
      console.log("Commands:");
      console.log("  list       List all registered webhooks");
      console.log("  cleanup    Delete webhooks pointing to preview URLs (*.vercel.app)");
      console.log("  register   Register production webhooks (idempotent)");
      console.log("  sync       cleanup + register + list");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

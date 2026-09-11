/**
 * Create Shopify Customer Metafield Definitions (MS1-2)
 *
 * Creates the following metafield definitions under the `elxea` namespace
 * for the Customer resource:
 *
 *   1. elxea.taste_profile  (json)                   — persona, depthLevel, preferredCategories, etc.
 *   2. elxea.line_linked    (boolean)                 — LINE account link status
 *   3. elxea.referral_code  (single_line_text_field)  — B2B revenue share tracking code
 *
 * Usage:
 *   npx tsx scripts/create-customer-metafields.ts
 *   npx tsx scripts/create-customer-metafields.ts --dry-run
 *
 * Requirements:
 *   - SHOPIFY_STORE_DOMAIN in .env or .env.local (e.g. your-store.myshopify.com)
 *   - SHOPIFY_ADMIN_ACCESS_TOKEN in .env or .env.local (needs write_customers scope)
 *
 * Idempotent: skips definitions that already exist.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { SHOPIFY_API_VERSION } from "../lib/shopify/api-version";

// ─── Env loading (same pattern as backup-shopify.ts) ─────────────────────────

function loadEnvFile(filename: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(join(process.cwd(), filename), "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // file not found — ignore
  }
  return env;
}

const localEnv = { ...loadEnvFile(".env"), ...loadEnvFile(".env.local") };
const getEnv = (key: string): string => process.env[key] ?? localEnv[key] ?? "";

const SHOPIFY_STORE_DOMAIN = getEnv("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_ADMIN_ACCESS_TOKEN = getEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const API_VERSION = SHOPIFY_API_VERSION;
const DRY_RUN = process.argv.includes("--dry-run");

// ─── GraphQL types ────────────────────────────────────────────────────────────

type MetafieldDefinitionInput = {
  name: string;
  namespace: string;
  key: string;
  description: string;
  type: string;
  ownerType: string;
};

type MetafieldDefinitionCreateResponse = {
  metafieldDefinitionCreate: {
    createdDefinition: {
      id: string;
      name: string;
      namespace: string;
      key: string;
      type: { name: string };
    } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
};

type MetafieldDefinitionsQueryResponse = {
  metafieldDefinitions: {
    edges: {
      node: {
        id: string;
        namespace: string;
        key: string;
        name: string;
        type: { name: string };
      };
    }[];
  };
};

// ─── GraphQL queries / mutations ─────────────────────────────────────────────

const METAFIELD_DEFINITION_CREATE_MUTATION = /* GraphQL */ `
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
        type { name }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String!) {
    metafieldDefinitions(ownerType: $ownerType, namespace: $namespace, first: 50) {
      edges {
        node {
          id
          namespace
          key
          name
          type { name }
        }
      }
    }
  }
`;

// ─── API client ───────────────────────────────────────────────────────────────

async function adminFetch<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error(
      "Missing required environment variables: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN"
    );
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify Admin API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
  }

  return json.data;
}

// ─── Definitions to create ────────────────────────────────────────────────────

const DEFINITIONS: MetafieldDefinitionInput[] = [
  {
    name: "Taste Profile",
    namespace: "elxea",
    key: "taste_profile",
    description:
      "CRM persona and taste profile synced from Firestore. " +
      "JSON fields: persona (serenity|explorer|sensory|null), depthLevel (entry|explore|deep), " +
      "preferredCategories (string[]), flavorPreferences (string[]), scenePref (string|null), " +
      "lastUpdated (ISO-8601).",
    type: "json",
    ownerType: "CUSTOMER",
  },
  {
    name: "LINE Linked",
    namespace: "elxea",
    key: "line_linked",
    description: "True when the customer's Shopify account is linked to a LINE user ID.",
    type: "boolean",
    ownerType: "CUSTOMER",
  },
  {
    name: "Referral Code",
    namespace: "elxea",
    key: "referral_code",
    description:
      "B2B revenue share tracking code recorded at first purchase. " +
      "Format: ELX-{PARTNER}-{RANDOM4} (e.g. ELX-CAFE123-A7B2).",
    type: "single_line_text_field",
    ownerType: "CUSTOMER",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nelxea Shopify Customer Metafield Setup");
  console.log(`Store: ${SHOPIFY_STORE_DOMAIN || "(not set)"}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log("─".repeat(50));

  // In dry-run mode without credentials, just show what would be created
  if (DRY_RUN && (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN)) {
    console.log("\n[DRY-RUN] Credentials not set — showing planned definitions only:\n");
    for (const def of DEFINITIONS) {
      console.log(`  ${def.namespace}.${def.key} (${def.type})`);
      console.log(`    name: ${def.name}`);
      console.log(`    description: ${def.description}\n`);
    }
    console.log("Run without --dry-run after setting SHOPIFY_ADMIN_ACCESS_TOKEN.");
    return;
  }

  // Fetch existing definitions to enable idempotency
  const existing = await adminFetch<MetafieldDefinitionsQueryResponse>(
    METAFIELD_DEFINITIONS_QUERY,
    { ownerType: "CUSTOMER", namespace: "elxea" }
  );

  const existingKeys: Record<string, boolean> = {};
  for (const edge of existing.metafieldDefinitions.edges) {
    existingKeys[`${edge.node.namespace}.${edge.node.key}`] = true;
  }

  console.log(`\nExisting elxea.* definitions: ${Object.keys(existingKeys).length}`);
  for (const key of Object.keys(existingKeys)) {
    console.log(`  - ${key}`);
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const definition of DEFINITIONS) {
    const qualifiedKey = `${definition.namespace}.${definition.key}`;

    if (existingKeys[qualifiedKey]) {
      console.log(`\n[SKIP] ${qualifiedKey} — already exists`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`\n[DRY-RUN] Would create: ${qualifiedKey} (${definition.type})`);
      created++;
      continue;
    }

    console.log(`\n[CREATE] ${qualifiedKey} (${definition.type}) ...`);

    try {
      const result = await adminFetch<MetafieldDefinitionCreateResponse>(
        METAFIELD_DEFINITION_CREATE_MUTATION,
        { definition }
      );

      const { createdDefinition, userErrors } = result.metafieldDefinitionCreate;

      if (userErrors.length > 0) {
        console.error(`  ERROR: ${userErrors.map((e) => e.message).join("; ")}`);
        failed++;
        continue;
      }

      if (createdDefinition) {
        console.log(`  OK: id=${createdDefinition.id}`);
        created++;
      }
    } catch (err) {
      console.error(`  EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log("Summary:");
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

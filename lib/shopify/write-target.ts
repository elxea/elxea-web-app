/**
 * Fail-closed resolution of the Shopify store a script is allowed to mutate.
 *
 * This is the Shopify-side twin of `lib/sanity/write-target.ts` and deliberately
 * copies its two rules rather than inventing a new mechanism:
 *
 *  1. No implicit default. A maintenance script must be told which store it may
 *     touch (`--store <domain>` or `SHOPIFY_STORE_TARGET`). Reading the domain
 *     out of a credentials file is *not* a target declaration — that is how a
 *     script ends up writing to the live shop just because the operator happened
 *     to have prod credentials on disk.
 *  2. Production needs an explicit second opt-in
 *     (`--i-know-this-is-production`), so a leftover env var alone cannot reach
 *     live data.
 *
 * Classification is fail-closed: a store is treated as production **unless** its
 * domain carries an obvious non-production marker. An unrecognised store name
 * therefore requires the confirmation flag rather than silently passing.
 */

export const STORE_ENV_VAR = "SHOPIFY_STORE_TARGET";
export const STORE_ARG = "--store";
export const PRODUCTION_CONFIRM_FLAG = "--i-know-this-is-production";

/** Substrings that mark a store domain as clearly NOT live data. */
export const NON_PRODUCTION_MARKERS: readonly string[] = [
  "staging",
  "sandbox",
  "-dev",
  "dev-",
  "-test",
  "test-",
];

export class ShopifyWriteTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyWriteTargetError";
  }
}

/** Fail-closed: anything not obviously a dev/staging store counts as production. */
export function isProductionStore(store: string): boolean {
  const s = store.trim().toLowerCase();
  return !NON_PRODUCTION_MARKERS.some((marker) => s.includes(marker));
}

/** Reads `--store <value>` / `--store=<value>` from argv. */
function storeFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === STORE_ARG) return argv[i + 1];
    if (arg.startsWith(`${STORE_ARG}=`)) return arg.slice(STORE_ARG.length + 1);
  }
  return undefined;
}

export interface ResolveWriteStoreOptions {
  /** Shown in error messages so the operator knows what to re-run. */
  scriptName: string;
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to `process.argv.slice(2)`. */
  argv?: readonly string[];
  /** Whether the script mutates Shopify. Write-capable scripts are the default. */
  writes?: boolean;
}

function missingTargetMessage(scriptName: string, writes: boolean): string {
  const confirm = writes ? ` ${PRODUCTION_CONFIRM_FLAG}` : "";
  return [
    `${scriptName}: refusing to run because no Shopify store was specified.`,
    "",
    "There is deliberately no default: reading the domain out of a credentials",
    "file is not a declaration of intent. Name the target explicitly, e.g.",
    "",
    `  ${STORE_ARG} my-staging-store.myshopify.com`,
    `  ${STORE_ENV_VAR}=my-staging-store.myshopify.com npx tsx ${scriptName}`,
    "",
    `To act on the live shop you must ALSO pass${confirm || " nothing extra (read-only script)"}:`,
    `  ${STORE_ENV_VAR}=<live-domain> npx tsx ${scriptName}${confirm}`,
    "",
    "Nothing was written.",
  ].join("\n");
}

function unconfirmedProductionMessage(
  scriptName: string,
  store: string,
): string {
  return [
    `${scriptName}: refusing to write to the production store "${store}".`,
    "",
    "This script mutates Shopify product data. Stores are treated as live",
    `unless the domain says otherwise (${NON_PRODUCTION_MARKERS.join(", ")}).`,
    `Add ${PRODUCTION_CONFIRM_FLAG} if that is really what you want:`,
    "",
    `  ${STORE_ENV_VAR}=${store} npx tsx ${scriptName} ${PRODUCTION_CONFIRM_FLAG}`,
    "",
    "Otherwise re-run against a non-production store.",
    "",
    "Nothing was written.",
  ].join("\n");
}

function credentialsMismatchMessage(
  scriptName: string,
  requested: string,
  credentialed: string,
): string {
  return [
    `${scriptName}: refusing to run because the declared target and the loaded`,
    "credentials point at different stores.",
    "",
    `  declared target (${STORE_ARG}/${STORE_ENV_VAR}): ${requested}`,
    `  store the loaded Admin API token belongs to: ${credentialed}`,
    "",
    "Saying 'staging' while holding production credentials is exactly the",
    "mistake this guard exists for. Load the matching credentials, or name the",
    "store the credentials actually belong to.",
    "",
    "Nothing was written.",
  ].join("\n");
}

/**
 * Returns the store the caller may use, or throws `ShopifyWriteTargetError`.
 * Never returns a fallback value.
 */
export function resolveWriteStore(options: ResolveWriteStoreOptions): string {
  const {
    scriptName,
    env = process.env,
    argv = process.argv.slice(2),
    writes = true,
  } = options;

  const raw = storeFromArgv(argv) ?? env[STORE_ENV_VAR];
  const store = typeof raw === "string" ? raw.trim() : "";

  if (!store) {
    throw new ShopifyWriteTargetError(missingTargetMessage(scriptName, writes));
  }

  if (writes && isProductionStore(store)) {
    if (!argv.includes(PRODUCTION_CONFIRM_FLAG)) {
      throw new ShopifyWriteTargetError(
        unconfirmedProductionMessage(scriptName, store),
      );
    }
  }

  return store;
}

/**
 * Guards against "declared staging, holding production credentials". Call once
 * the Admin API credentials are loaded.
 */
export function assertCredentialsMatchStore(
  scriptName: string,
  requestedStore: string,
  credentialedStore: string,
): void {
  const a = requestedStore.trim().toLowerCase();
  const b = credentialedStore.trim().toLowerCase();
  if (a !== b) {
    throw new ShopifyWriteTargetError(
      credentialsMismatchMessage(scriptName, requestedStore, credentialedStore),
    );
  }
}

/**
 * Script entry-point helper: resolves the store or prints the reason and exits
 * non-zero before any Admin API client is used.
 */
export function resolveWriteStoreOrExit(
  options: ResolveWriteStoreOptions,
): string {
  try {
    return resolveWriteStore(options);
  } catch (error) {
    if (error instanceof ShopifyWriteTargetError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** `assertCredentialsMatchStore` with the same print-and-exit behaviour. */
export function assertCredentialsMatchStoreOrExit(
  scriptName: string,
  requestedStore: string,
  credentialedStore: string,
): void {
  try {
    assertCredentialsMatchStore(scriptName, requestedStore, credentialedStore);
  } catch (error) {
    if (error instanceof ShopifyWriteTargetError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

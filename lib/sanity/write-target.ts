/**
 * Fail-closed resolution of the Sanity dataset a script is allowed to touch.
 *
 * Why this exists: several maintenance scripts used to default to
 * `NEXT_PUBLIC_SANITY_DATASET || "production"`. Omitting the variable silently
 * pointed a dummy-content seeder at the live dataset, which is how fictional
 * documents ended up in production (and in the public sitemap).
 *
 * The rules enforced here:
 *  1. No implicit default. If no dataset is given, resolution throws and the
 *     caller must exit without writing anything.
 *  2. Production needs an explicit second opt-in. A write-capable script that
 *     resolves to a production dataset must also be passed
 *     `--i-know-this-is-production`, so a mistyped/leftover env var alone
 *     cannot reach live data.
 *
 * Read-only scripts pass `writes: false` and skip rule 2 (rule 1 still applies).
 */

export const DATASET_ENV_VAR = "NEXT_PUBLIC_SANITY_DATASET";
export const DATASET_ARG = "--dataset";
export const PRODUCTION_CONFIRM_FLAG = "--i-know-this-is-production";

/** Dataset names treated as live data. */
export const PRODUCTION_DATASETS: readonly string[] = ["production", "prod"];

export class WriteTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteTargetError";
  }
}

export function isProductionDataset(dataset: string): boolean {
  return PRODUCTION_DATASETS.includes(dataset.trim().toLowerCase());
}

/** Reads `--dataset <value>` / `--dataset=<value>` from argv. */
function datasetFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === DATASET_ARG) return argv[i + 1];
    if (arg.startsWith(`${DATASET_ARG}=`)) {
      return arg.slice(DATASET_ARG.length + 1);
    }
  }
  return undefined;
}

export interface ResolveWriteDatasetOptions {
  /** Shown in error messages so the operator knows what to re-run. */
  scriptName: string;
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to `process.argv.slice(2)`. */
  argv?: readonly string[];
  /**
   * Whether the script mutates Sanity. Write-capable scripts (the default)
   * additionally require the production confirmation flag.
   */
  writes?: boolean;
}

function missingTargetMessage(scriptName: string, writes: boolean): string {
  const confirm = writes ? ` ${PRODUCTION_CONFIRM_FLAG}` : "";
  return [
    `${scriptName}: refusing to run because no Sanity dataset was specified.`,
    "",
    "There is deliberately no default: an implicit default once pointed a dummy",
    "seeder at the live dataset. Name the target explicitly, e.g.",
    "",
    `  ${DATASET_ARG} staging`,
    `  ${DATASET_ENV_VAR}=staging npx tsx ${scriptName}`,
    "",
    `To act on live data you must ALSO pass${confirm || " nothing extra (read-only script)"}:`,
    `  ${DATASET_ENV_VAR}=production npx tsx ${scriptName}${confirm}`,
    "",
    "Nothing was written.",
  ].join("\n");
}

function unconfirmedProductionMessage(
  scriptName: string,
  dataset: string
): string {
  return [
    `${scriptName}: refusing to write to the production dataset "${dataset}".`,
    "",
    `This script mutates Sanity. Add ${PRODUCTION_CONFIRM_FLAG} if that is`,
    "really what you want:",
    "",
    `  ${DATASET_ENV_VAR}=${dataset} npx tsx ${scriptName} ${PRODUCTION_CONFIRM_FLAG}`,
    "",
    "Otherwise re-run against a non-production dataset, e.g.",
    `  ${DATASET_ARG} staging`,
    "",
    "Nothing was written.",
  ].join("\n");
}

/**
 * Returns the dataset the caller may use, or throws `WriteTargetError`.
 * Never returns a fallback value.
 */
export function resolveWriteDataset(
  options: ResolveWriteDatasetOptions
): string {
  const {
    scriptName,
    env = process.env,
    argv = process.argv.slice(2),
    writes = true,
  } = options;

  const raw = datasetFromArgv(argv) ?? env[DATASET_ENV_VAR];
  const dataset = typeof raw === "string" ? raw.trim() : "";

  if (!dataset) {
    throw new WriteTargetError(missingTargetMessage(scriptName, writes));
  }

  if (writes && isProductionDataset(dataset)) {
    if (!argv.includes(PRODUCTION_CONFIRM_FLAG)) {
      throw new WriteTargetError(
        unconfirmedProductionMessage(scriptName, dataset)
      );
    }
  }

  return dataset;
}

/**
 * Script entry-point helper: resolves the dataset or prints the reason and
 * exits non-zero before any client is constructed.
 */
export function resolveWriteDatasetOrExit(
  options: ResolveWriteDatasetOptions
): string {
  try {
    return resolveWriteDataset(options);
  } catch (error) {
    if (error instanceof WriteTargetError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

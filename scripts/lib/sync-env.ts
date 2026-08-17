/**
 * Env resolution for standalone sync scripts.
 *
 * Single source of truth: `process.env`. Nothing in this module (or in its
 * callers) may read a config file and use the value directly — that is what
 * made `sync-notion-to-sanity.ts` Mac-only:
 *
 *   - it read `~/.config/sanity/config.json` (created by `npx sanity login`,
 *     which only ever exists on a developer machine), and
 *   - it read `join(process.cwd(), ".env")` as a *file*, so it died on any
 *     runner where config arrives as environment variables.
 *
 * `loadDotEnvIntoProcessEnv()` keeps local `pnpm sync:notion` convenient, but
 * it only *populates* `process.env` and returns nothing — there is no path
 * where a file value is consumed without going through `process.env`.
 */

import { readFileSync } from "fs";
import { join } from "path";

/**
 * Populate `process.env` from a dotenv file, for local runs only.
 *
 * - Real environment variables always win (never clobber CI-provided values).
 * - A missing file is not an error: on a runner there is no `.env` at all.
 * - Skipped entirely when `CI` is set, so CI can never accidentally depend on
 *   a checked-in or leftover file.
 *
 * Returns the number of keys it injected (0 when skipped), for logging only.
 */
export function loadDotEnvIntoProcessEnv(
  file = join(process.cwd(), ".env")
): number {
  if (process.env.CI) return 0;

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return 0;
  }

  let injected = 0;
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    let value = match[2].trim();
    // Strip one layer of matching quotes, if present.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
    injected++;
  }

  return injected;
}

/** Thrown when required configuration is absent. Callers classify this as a config error, not a data error. */
export class MissingEnvError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them in the runner's secrets (CI) or in .env (local).`
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/**
 * Read every required variable and report *all* missing names at once.
 *
 * Reporting them together matters on a runner: a one-at-a-time
 * `process.exit(1)` per variable means each fix costs another failed run.
 * Never include values in the error — only names.
 */
export function requireEnv<K extends string>(names: readonly K[]): Record<K, string> {
  const resolved = {} as Record<K, string>;
  const missing: string[] = [];

  for (const name of names) {
    const value = process.env[name];
    if (value === undefined || value === "") {
      missing.push(name);
      continue;
    }
    resolved[name] = value;
  }

  if (missing.length > 0) throw new MissingEnvError(missing);
  return resolved;
}

/** Read an optional variable, falling back to `fallback`. */
export function optionalEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

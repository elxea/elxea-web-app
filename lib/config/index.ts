/**
 * @sot env-access
 *
 * The only way application code reads configuration.
 *
 * `env("NAME")` returns the normalised value declared for that variable in
 * `lib/config/spec.ts`. `assertEnvValid()` checks the whole registry at once
 * and is called from `instrumentation.ts` so that a deployment with a
 * malformed value refuses to start instead of serving broken output.
 *
 * Everything outside `lib/config/**` is blocked from touching `process.env`
 * by the `no-restricted-syntax` rule in `eslint.config.mjs`. That pairing is
 * the point: a shared accessor that call sites may bypass is what produced the
 * 63-file spread this replaces (憲章 R8「装置導入は全件移行 + 再流入止めで 1 セット」).
 *
 * ## Why nothing is cached
 *
 * Values are read through on every call. Two reasons:
 *
 *   1. `vi.stubEnv` mutates `process.env` after import, and 49 test files rely
 *      on it. A module-level cache would hand those tests a stale value and the
 *      tests would pass while asserting nothing.
 *   2. A cache is a second source of truth for the same fact, which is the
 *      class of defect R5 exists to prevent.
 *
 * The cost is one `safeParse` of a single string per read, which is well below
 * the cost of the `process.env` lookup itself on the Node runtime.
 */

import { ENV_NAMES, ENV_SPEC, type EnvName, type EnvValue } from "@/lib/config/spec";

/**
 * A configuration value did not satisfy its declared schema.
 *
 * The message names the variable and the constraint it failed, and **never**
 * the value. A config error is frequently about a credential; putting the
 * received bytes into a log line or a stack trace would turn a
 * misconfiguration into a disclosure. The whole point of the registry is that
 * the variable name plus its declared shape is enough to fix the problem.
 */
export class EnvConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n` +
        issues.map((i) => `  - ${i}`).join("\n") +
        `\n\nEach variable is declared in lib/config/spec.ts. ` +
        `Values are never logged — fix the named variable in the deployment environment.`,
    );
    this.name = "EnvConfigError";
    this.issues = issues;
  }
}

/**
 * Describe why a value was rejected, without reproducing the value.
 *
 * Zod's default messages for some issue kinds embed the received input. This
 * builds the message from the variable name and the declared constraint only.
 */
function describeIssues(name: EnvName, error: { issues: ReadonlyArray<{ message: string }> }): string[] {
  return error.issues.map((issue) => `${name}: ${issue.message}`);
}

/**
 * Read one configuration value, normalised according to its declaration.
 *
 * Throws {@link EnvConfigError} when the value is present but malformed. In a
 * correctly configured deployment this cannot happen at a call site, because
 * `assertEnvValid()` already rejected the deployment at boot.
 */
export function env<K extends EnvName>(name: K): EnvValue<K> {
  const entry = ENV_SPEC[name];
  const parsed = entry.schema.safeParse(entry.read());
  if (!parsed.success) {
    throw new EnvConfigError(describeIssues(name, parsed.error));
  }
  return parsed.data as EnvValue<K>;
}

/**
 * Every problem with the current environment, as a list of messages.
 *
 * Returns rather than throws so that callers can decide the severity — the
 * boot check throws, a diagnostic route could render.
 */
export function collectEnvIssues(): string[] {
  const issues: string[] = [];
  for (const name of ENV_NAMES) {
    const entry = ENV_SPEC[name];
    const parsed = entry.schema.safeParse(entry.read());
    if (!parsed.success) issues.push(...describeIssues(name, parsed.error));
  }
  return issues;
}

/**
 * Should a malformed value stop the process, or only be reported?
 *
 * Fatal on anything Vercel deployed — production **and** preview. Preview is
 * included deliberately: it is where a bad value should be discovered, and a
 * preview that boots happily on a broken config cannot demonstrate that the
 * gate works.
 *
 * Local development and the test runner report instead of throwing, because a
 * half-configured `.env.local` is a normal state to be in while working and
 * refusing to start would only teach people to delete the check.
 */
function shouldFailFast(): boolean {
  return env("NODE_ENV") === "production" || env("VERCEL_ENV") !== undefined;
}

/**
 * Validate the whole registry. Called once from `instrumentation.ts#register`,
 * before the process accepts its first request.
 *
 * @throws {EnvConfigError} on a deployed environment with a malformed value.
 */
export function assertEnvValid(): void {
  const issues = collectEnvIssues();
  if (issues.length === 0) return;

  if (shouldFailFast()) throw new EnvConfigError(issues);

  console.warn(
    `[config] ${issues.length} environment problem(s) — not fatal outside a deployment:\n` +
      issues.map((i) => `  - ${i}`).join("\n"),
  );
}

/**
 * The whole registry as a plain `Record<name, string | undefined>`.
 *
 * Exists for the handful of modules that take an "env-like" object as a
 * parameter so tests can inject one — `lib/firebase/firestore-target.ts`,
 * `lib/sanity/write-target.ts`, `lib/line/login-channel.ts`. Those signatures
 * are a deliberate seam and are kept; only their **default** moves from the
 * raw `process.env` to this normalised snapshot.
 *
 * Values are normalised, so a consumer that trims again is simply idempotent.
 * Non-string outputs (there are none today beyond `NODE_ENV`, which is a string
 * union) are stringified so the shape matches what `process.env` would give.
 */
export function envSnapshot(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const name of ENV_NAMES) {
    const value = env(name);
    out[name] = value === undefined ? undefined : String(value);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Named helpers for the values read most often.
 *
 * These exist only so the common comparisons read as intent rather than as
 * string equality. They add no rule of their own.
 * ------------------------------------------------------------------ */

export function nodeEnv(): "development" | "test" | "production" {
  return env("NODE_ENV");
}

export function isProduction(): boolean {
  return env("NODE_ENV") === "production";
}

export function isTest(): boolean {
  return env("NODE_ENV") === "test";
}

export function isDevelopment(): boolean {
  return env("NODE_ENV") === "development";
}

export type { EnvName, EnvValue };

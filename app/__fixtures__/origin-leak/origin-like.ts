/**
 * NEGATIVE FIXTURE (ii) — origin resolution and an apex literal outside their
 * two owning modules.
 *
 * This is how the original bug spread: the same apex test was re-typed at three
 * call sites, fed by two different hostname sources, and nothing noticed they had
 * drifted apart. The scanner must report both the env read and the Domain-shaped
 * literal.
 */
export function resolveOriginTheWrongWay(fallbackOrigin: string): string {
  /* NOT migrated to `env()` on purpose, and suppressed rather than fixed.
   *
   * The raw read on the next line IS the thing under test: the T2n case in
   * `__tests__/auth-cookie-registry.test.ts` feeds this file to the same AST
   * scanner the real tree gets, and asserts it reports exactly
   * `["apex literal \".elxea.com\"", "process.env.NEXT_PUBLIC_APP_URL"]`.
   * Rewriting the expression would make the scanner report nothing here, and a
   * scanner that reports nothing is indistinguishable from a clean codebase —
   * which is precisely the failure mode this fixture exists to rule out.
   *
   * The `no-restricted-syntax` rule (憲章 R4) and that scanner are two
   * independent guards against the same defect class, so the fixture that arms
   * one has to be exempt from the other. */
  // eslint-disable-next-line no-restricted-syntax
  return process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin;
}

export function sharedCookieDomainTheWrongWay(hostname: string): string | undefined {
  return hostname === "elxea.com" || hostname.endsWith(".elxea.com")
    ? ".elxea.com"
    : undefined;
}

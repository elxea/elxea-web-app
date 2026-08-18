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
  return process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin;
}

export function sharedCookieDomainTheWrongWay(hostname: string): string | undefined {
  return hostname === "elxea.com" || hostname.endsWith(".elxea.com")
    ? ".elxea.com"
    : undefined;
}

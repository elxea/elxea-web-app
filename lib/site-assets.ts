/**
 * Site-body static image read side (M33 spec 39c70c9d Phase C) — the elxea-web-app
 * counterpart of elxea-asset-hub's assign-site write side.
 *
 * The Asset Hub crops an adopted ledger asset to each site slot's ratio, uploads
 * it to R2 `cdn/site/ELX/<slot>.jpg`, and upserts an index
 * `cdn/site/manifest-ELX.json` shaped `slot_id -> { url, asset_id, updated_at }`.
 * This module reads that manifest at build/ISR time and resolves a slot_id to its
 * assigned image url, falling back to the site's current static asset when the
 * slot is unassigned or the manifest is unreachable. That fallback is the whole
 * "don't break the current look" guarantee: an empty/failed manifest must leave
 * every frame rendering exactly what it renders today.
 *
 * Contract SoT lives in elxea-asset-hub (lib/site-slots.json / lib/site-assign.ts).
 * This file intentionally does NOT import across repos; it mirrors only the two
 * facts the read side needs (manifest key + R2 public domain), both env-overridable.
 */

/**
 * R2 managed public domain that serves the site manifest and cropped images.
 * Mirrors elxea-asset-hub lib/r2.ts R2_PUBLIC_DOMAIN. Overridable via env for
 * staging/preview buckets (rarely needed).
 */
export const R2_PUBLIC_DOMAIN =
  process.env.R2_PUBLIC_DOMAIN?.trim() ||
  'pub-90a0485599904fee8228ef56bb51c2e6.r2.dev';

/** The elxea org token used in the manifest / R2 key path. */
export const SITE_ORG = 'ELX';

/** R2 object key for the per-org site manifest (mirrors siteManifestR2Key). */
export const SITE_MANIFEST_KEY = `cdn/site/manifest-${SITE_ORG}.json`;

/** Full public URL of the site manifest the Asset Hub upserts. */
export const SITE_MANIFEST_URL = `https://${R2_PUBLIC_DOMAIN}/${SITE_MANIFEST_KEY}`;

/**
 * ISR window (seconds) for the manifest fetch. An Asset Hub re-assign becomes
 * visible on the site within this window without a rebuild (spec Open item 1:
 * R2 manifest + ISR). 5 min balances freshness against R2 request volume.
 */
export const SITE_MANIFEST_REVALIDATE_SECONDS = 300;

/** One manifest entry — mirrors elxea-asset-hub SiteManifestEntry. */
export interface SiteManifestEntry {
  url: string;
  asset_id: string;
  updated_at: string;
}

/** slot_id -> current placement. */
export type SiteManifest = Record<string, SiteManifestEntry>;

/**
 * Pure resolver (network-free, unit-tested): given a manifest (possibly null),
 * a slot id, and the site's current fallback src, return the url to render.
 *
 * Returns the assigned manifest url ONLY when it is a present, non-empty string;
 * otherwise returns `fallbackSrc`. This is deliberately defensive — a malformed
 * manifest (missing/empty/non-string url, wrong shape) resolves to the fallback
 * rather than emitting a broken <img src>. Unassigned slots therefore keep the
 * current static image, unchanged.
 */
export function resolveSiteAsset(
  manifest: SiteManifest | null | undefined,
  slotId: string,
  fallbackSrc: string,
): string {
  const entry = manifest && typeof manifest === 'object' ? manifest[slotId] : undefined;
  const url = entry && typeof entry === 'object' ? entry.url : undefined;
  if (typeof url === 'string' && url.trim().length > 0) {
    return url;
  }
  return fallbackSrc;
}

/**
 * Fetch the site manifest from R2 with ISR. Best-effort: any failure (network,
 * non-200, invalid JSON, wrong shape) resolves to an empty manifest so every
 * slot falls back to its current static image. Never throws.
 */
export async function getSiteManifest(): Promise<SiteManifest> {
  try {
    const res = await fetch(SITE_MANIFEST_URL, {
      next: { revalidate: SITE_MANIFEST_REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      return {};
    }
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {};
    }
    return data as SiteManifest;
  } catch {
    return {};
  }
}

/**
 * Resolve a single site slot to the image url to render. Reads the manifest
 * (ISR-cached) and applies {@link resolveSiteAsset}. `fallbackSrc` is the site's
 * current static asset for the frame (e.g. "/hero-day.jpg"), returned whenever
 * the slot is unassigned or the manifest is unreachable.
 */
export async function getSiteAsset(
  slotId: string,
  fallbackSrc: string,
): Promise<string> {
  const manifest = await getSiteManifest();
  return resolveSiteAsset(manifest, slotId, fallbackSrc);
}

/**
 * Site-body static image read side (M33 spec 39c70c9d Phase C) — the elxea-web-app
 * counterpart of elxea-asset-hub's assign-site write side.
 *
 * The Asset Hub crops an adopted ledger asset **once per surface** (a slot that
 * shows at 5:4 on phones and 864:560 on desktop is baked twice), uploads each to
 * R2 `cdn/site/ELX/<slot>__<surface>.jpg`, and upserts an index
 * `cdn/site/manifest-ELX.json` shaped
 * `slot_id -> { surfaces: { <surface_id>: { url, ratio } }, url, asset_id, updated_at }`.
 * `surfaces` is the body; the top-level `url` is a single representative crop kept
 * for readers that can only take one image (asset-hub picks the most portrait
 * surface, so a wide reader never chops the subject out of a tall frame).
 *
 * This module reads that manifest at build/ISR time and resolves a slot to a url
 * **per declared surface**, falling back — surface url -> representative url ->
 * the site's current static asset — at each step. That fallback chain is the whole
 * "don't break the current look" guarantee: an empty/failed manifest, an old
 * manifest with no `surfaces` at all, or a manifest missing one surface must all
 * leave every frame rendering something valid, and an unassigned frame must render
 * exactly what it renders today.
 *
 * 枠がどれだけ存在するか (枠の宣言) の SoT はこのリポジトリ側、
 * `public/site-slots.manifest.json` にある (`lib/site-slots.ts` 参照)。asset-hub は
 * それを URL で読むだけで、枠を宣言しない。ここが扱うのは「枠に何が割り当たって
 * いるか」= R2 manifest (割当の記録) の読み取りだけで、両者は別物。
 *
 * This file intentionally does NOT import across repos; it mirrors only the two
 * facts the read side needs (manifest key + R2 public domain), both env-overridable.
 */

import { env } from '@/lib/config';
import { R2_PUBLIC_DOMAIN_DEFAULT } from '@/lib/image-hosts';
import { getSiteSlot } from '@/lib/site-slots';
import type { SiteSlot, SiteSlotId } from '@/lib/site-slots';

/**
 * R2 managed public domain that serves the site manifest and cropped images.
 * Mirrors elxea-asset-hub lib/r2.ts R2_PUBLIC_DOMAIN. Overridable via env for
 * staging/preview buckets (rarely needed).
 */
export const R2_PUBLIC_DOMAIN = env('R2_PUBLIC_DOMAIN') ?? R2_PUBLIC_DOMAIN_DEFAULT;

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

/** One baked crop — mirrors elxea-asset-hub SiteManifestSurface. */
export interface SiteManifestSurface {
  url: string;
  /** 焼いた比率。宣言と食い違ったときに asset-hub 側が検出するための記録。 */
  ratio?: { width: number; height: number };
}

/**
 * One manifest entry — mirrors elxea-asset-hub SiteManifestEntry.
 *
 * `surfaces` が本体 (surface id -> 切り抜き)。`url` は 1 枚しか読めない読み手のための
 * 代表で、後方互換のためだけに残る。読み口としてはどちらも欠けうる前提で扱う
 * (古いマニフェスト = `url` だけ / 将来のマニフェスト = `surfaces` だけ)。
 */
export interface SiteManifestEntry {
  url?: string;
  surfaces?: Record<string, SiteManifestSurface>;
  asset_id?: string;
  updated_at?: string;
}

/** slot_id -> current placement. */
export type SiteManifest = Record<string, SiteManifestEntry>;

/** 空文字・空白だけ・文字列でない値を「無い」に畳む。 */
function readUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** マニフェストから 1 枠ぶんの記録を取り出す (壊れた形は undefined に畳む)。 */
function readEntry(
  manifest: SiteManifest | null | undefined,
  slotId: string,
): SiteManifestEntry | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  const entry = manifest[slotId];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : undefined;
}

/**
 * 1 枚しか出せない場面で使う代表 url。
 *
 * `url` (asset-hub が入れる代表) を最優先し、それが無いマニフェストでは
 * `surfaces` の中から **一番縦長の面** を選ぶ。横長を選ぶと縦長の枠に置いたときに
 * 左右ではなく上下が足りず被写体が欠けるため (asset-hub 側の代表選びと同じ判断)。
 */
export function representativeUrl(
  entry: SiteManifestEntry | null | undefined,
): string | undefined {
  const direct = readUrl(entry?.url);
  if (direct) return direct;

  const surfaces = entry?.surfaces;
  if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces)) return undefined;

  let best: { url: string; ratio: number } | undefined;
  for (const surface of Object.values(surfaces)) {
    const url = readUrl(surface?.url);
    if (!url) continue;
    const w = surface?.ratio?.width;
    const h = surface?.ratio?.height;
    // 比率が読めない面は「一番縦長」の競争に勝たせない (既に候補があるなら負ける)。
    const ratio =
      typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0
        ? w / h
        : Number.POSITIVE_INFINITY;
    if (!best || ratio < best.ratio) best = { url, ratio };
  }
  return best?.url;
}

/**
 * Pure resolver (network-free, unit-tested): given a manifest (possibly null),
 * a slot id, and the site's current fallback src, return the single url to render.
 *
 * 面ごとの出し分けをしない読み手のための入口。代表 url が引けたときだけそれを返し、
 * それ以外 (未割当・壊れた形・空文字) は `fallbackSrc` を返す。壊れたマニフェストで
 * 空の `<img src>` を出すより、今出ている静的画像を出し続けるほうが正しい。
 */
export function resolveSiteAsset(
  manifest: SiteManifest | null | undefined,
  slotId: string,
  fallbackSrc: string,
): string {
  return representativeUrl(readEntry(manifest, slotId)) ?? fallbackSrc;
}

/** 解決済みの 1 面。 */
export interface ResolvedSiteSurface {
  /** 宣言の surface id (`sp` / `pc` 等)。 */
  id: string;
  /** この面に出す url。 */
  url: string;
  /** この面が選ばれる CSS メディア条件。既定の面は持たない。 */
  media?: string;
  /** `surfaces` から surface id で引けたか (false = 代表 or 静的への後退)。 */
  assigned: boolean;
}

/** 1 枠を描くのに必要なものを全部揃えた形。 */
export interface ResolvedSiteImage {
  /** 既定の面の url = `<img src>`。 */
  src: string;
  /** 既定の面 (media を持たない面)。 */
  base: ResolvedSiteSurface;
  /** `<source>` に載せる面 (media を持つ面・宣言順)。 */
  sources: ResolvedSiteSurface[];
  /**
   * 面ごとに違う url が要るか。
   *
   * false = 全面が同じ 1 枚に解決した (未割当・旧形式の代表 1 枚) ので、`<picture>` を
   * 組む意味が無く、今までどおり 1 本の `<Image>` で出せばよい。**未割当の枠が今日と
   * 寸分違わず描かれる**のはこの分岐が担保している。
   */
  artDirected: boolean;
  /**
   * この枠にマニフェスト由来の写真が 1 枚でも当たっているか。
   *
   * `src` / `sources[].url` だけでは「割り当てられた写真」と「後退先の
   * `fallbackSrc`」を見分けられない。呼び出し側が **写真が無いときは写真を出さない**
   * (灰色の面のまま描く・枠ごと畳む) を選べるように、由来そのものを持つ。
   *
   * `artDirected` とは別物であることに注意 — 1 枚だけ割り当たっている枠は
   * `assigned: true` / `artDirected: false` になる。
   */
  assigned: boolean;
}

/**
 * Pure resolver (network-free, unit-tested): 宣言の surface ごとに url を決める。
 *
 * 面 1 つあたりの後退の順は
 *   `surfaces[<surface id>].url` → 代表 url (`url` / 一番縦長の面) → `fallbackSrc`。
 * 「新しい面を宣言に足したが asset-hub がまだ焼いていない」状態でその面だけ穴が空く、
 * を避けるための順序で、欠けた面は必ず何かで埋まる。
 *
 * 既定の面は宣言で media を持たない面 (`validateSiteSlotsManifest` がちょうど 1 件に
 * 強制する)。宣言が壊れていて既定が無い場合でも描画は止めず、先頭の面を既定に
 * 繰り上げる — build ゲートで直すべき問題であって、公開ページを白くする理由ではない。
 */
export function resolveSiteSurfaces(
  manifest: SiteManifest | null | undefined,
  slot: SiteSlot,
  fallbackSrc: string,
): ResolvedSiteImage {
  const entry = readEntry(manifest, slot.id);
  const representative = representativeUrl(entry);
  const baked =
    entry?.surfaces && typeof entry.surfaces === 'object' && !Array.isArray(entry.surfaces)
      ? entry.surfaces
      : undefined;

  const resolved: ResolvedSiteSurface[] = (slot.surfaces ?? []).map((surface) => {
    const own = readUrl(baked?.[surface.id]?.url);
    return {
      id: surface.id,
      media: surface.media,
      url: own ?? representative ?? fallbackSrc,
      assigned: own !== undefined,
    };
  });

  const base =
    resolved.find((s) => s.media === undefined) ??
    resolved[0] ??
    // surfaces を 1 件も持たない宣言は検査で落ちるが、読み口は落とさない。
    { id: '', url: representative ?? fallbackSrc, assigned: false };

  const sources = resolved.filter((s) => s !== base && s.media !== undefined);
  const artDirected = new Set([base.url, ...sources.map((s) => s.url)]).size > 1;
  // 代表 url しか無い旧形式のマニフェストでも「当たっている」と数える。面別に
  // 焼かれているかどうかは割当の有無とは別の話で、ここが見たいのは前者ではない。
  const assigned = representative !== undefined || resolved.some((s) => s.assigned);

  return { src: base.url, base, sources, artDirected, assigned };
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

/**
 * Resolve a site slot to everything needed to render it across its declared
 * surfaces. Reads the manifest (ISR-cached) and applies {@link resolveSiteSurfaces}
 * against the site's own slot declaration (`public/site-slots.manifest.json`).
 *
 * 面の集合を決めるのは**サイトの宣言**であってマニフェストではない。マニフェストが
 * 知らない面を宣言していても、その面は代表 url か `fallbackSrc` で埋まる。
 */
export async function getSiteImage(
  slotId: SiteSlotId,
  fallbackSrc: string,
): Promise<ResolvedSiteImage> {
  const manifest = await getSiteManifest();
  return resolveSiteSurfaces(manifest, getSiteSlot(slotId), fallbackSrc);
}

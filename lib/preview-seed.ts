/**
 * Preview-only seed helpers.
 *
 * Local preview points at the *production* Sanity dataset, which is currently
 * sparse (no future-dated events, farmers/articles without photos, etc.). That
 * makes several pages impossible to review at real layout density.
 *
 * These helpers inject dummy data / placeholder imagery FOR PREVIEW ONLY,
 * gated behind an env flag. When the flag is unset the behaviour is
 * byte-identical to before (normal Sanity fetch, no injection), so production
 * deploys are unaffected. Nothing is ever written back to Sanity/Shopify.
 *
 * Flag:
 *   PREVIEW_SEED=1         -> unified master flag (all seeded sections)
 *   PREVIEW_SEED_EVENTS=1  -> legacy flag, kept for backward compatibility
 *
 * All `imageUrl` values point at existing local /public assets so no external
 * download / remote host is required.
 */

/** True when preview seeding is enabled via either the unified or legacy flag. */
export function previewSeedEnabled(): boolean {
  return (
    process.env.PREVIEW_SEED === "1" || process.env.PREVIEW_SEED_EVENTS === "1"
  );
}

/** Local /public images reused as preview placeholder photography. */
const PREVIEW_IMAGES = [
  "/hero-day.jpg",
  "/hero-night.jpg",
  "/hero-approach.jpg",
  "/placeholder-hero-day.jpg",
  "/placeholder-hero-night.jpg",
  "/placeholder-hero-approach.jpg",
];

/** Deterministic image by numeric index (cycles through the pool). */
export function previewImageAt(index: number): string {
  const n = PREVIEW_IMAGES.length;
  return PREVIEW_IMAGES[((index % n) + n) % n];
}

/** Deterministic image chosen from a string key (stable per id). */
export function previewImageForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return previewImageAt(Math.abs(hash));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SeedEvent = {
  _id: string;
  slug: { current: string };
  imageUrl?: string;
  image?: { asset: object; alt?: string };
  title: string;
  date: string;
  endDate?: string;
  location?: string;
  memberOnly?: boolean;
  externalUrl?: string;
};

/** 3 dummy future events, shared by the top page and the events list page. */
export function seedEvents(): SeedEvent[] {
  return [
    {
      _id: "seed-event-1",
      slug: { current: "seed-event-1" },
      imageUrl: "/hero-day.jpg",
      title: "朝の茶会 — Morning Tea Ceremony",
      date: "2026-07-25T01:00:00.000Z",
      location: "elxea Studio, Tokyo",
    },
    {
      _id: "seed-event-2",
      slug: { current: "seed-event-2" },
      imageUrl: "/hero-night.jpg",
      title: "Farmer's Table：シングルオリジン試飲会",
      date: "2026-08-08T09:00:00.000Z",
      location: "Kyoto Farmhouse",
    },
    {
      _id: "seed-event-3",
      slug: { current: "seed-event-3" },
      imageUrl: "/hero-approach.jpg",
      title: "Creativity & Tea Workshop",
      date: "2026-08-22T05:30:00.000Z",
      location: "elxea Gallery, Osaka",
    },
  ];
}

// ---------------------------------------------------------------------------
// Farmers
// ---------------------------------------------------------------------------

export type SeedFarmer = {
  _id: string;
  slug: { current: string };
  imageUrl?: string;
  photo?: { asset: object; alt?: string };
  name: string;
  region?: string;
  country?: string;
};

const SEED_FARMERS: Array<{ name: string; region: string; country: string }> = [
  { name: "山田 誠", region: "静岡", country: "日本" },
  { name: "中村 果林", region: "京都", country: "日本" },
  { name: "佐藤 大地", region: "鹿児島", country: "日本" },
  { name: "鈴木 惠", region: "福岡", country: "日本" },
  { name: "田中 陽子", region: "三重", country: "日本" },
  { name: "髙橋 純", region: "埼玉", country: "日本" },
];

/**
 * When seeding is enabled, attach preview imagery to real farmers that lack a
 * photo and pad the list up to `target` items so the grid renders at density.
 * When disabled, returns the input untouched.
 */
export function withSeedFarmers<T extends SeedFarmer>(
  real: T[] | null | undefined,
  target = 6,
): (T | SeedFarmer)[] {
  const list = real ?? [];
  if (!previewSeedEnabled()) return list;

  const enriched: (T | SeedFarmer)[] = list.map((f, i) =>
    f.photo?.asset ? f : { ...f, imageUrl: previewImageAt(i) },
  );

  for (let i = enriched.length; i < target; i++) {
    const s = SEED_FARMERS[i % SEED_FARMERS.length];
    enriched.push({
      _id: `seed-farmer-${i}`,
      slug: { current: `seed-farmer-${i}` },
      imageUrl: previewImageAt(i),
      name: s.name,
      region: s.region,
      country: s.country,
    });
  }
  return enriched;
}

// ---------------------------------------------------------------------------
// Elxea Journal (tea-menu journal — akane / sui / sohi themes)
// ---------------------------------------------------------------------------

export type SeedJournal = {
  _id: string;
  slug: { current: string };
  title: string;
  theme: string;
  summary?: string;
  mainImage?: { asset: object; alt?: string };
  thumbnail?: { asset: object; alt?: string };
};

const SEED_JOURNALS: Array<{ title: string; theme: string; summary: string }> = [
  { title: "茜 — 深い焙煎とほうじ茶の余韻", theme: "akane", summary: "赤みを帯びた茶葉から生まれる、香ばしく温かな一杯の物語。" },
  { title: "翠 — 一番茶の澄んだ緑", theme: "sui", summary: "摘みたての新芽が届ける、みずみずしい旨みと透明感。" },
  { title: "そひ — 和と洋のあいだで", theme: "sohi", summary: "ミルクや焼き菓子に寄り添う、やわらかなブレンドの提案。" },
  { title: "茜 — 夜に寄り添う一服", theme: "akane", summary: "一日の終わりに、ゆっくりと解けていく香りの時間。" },
  { title: "翠 — 産地を旅する試飲会", theme: "sui", summary: "シングルオリジンで巡る、土地ごとの個性の違い。" },
  { title: "そひ — 季節のペアリング", theme: "sohi", summary: "旬の素材と合わせて楽しむ、移ろう季節のお茶。" },
];

/**
 * When seeding is enabled and the real journal list is empty, return dummy
 * journal entries so the grid renders. Images are resolved by the page's
 * per-id placeholder fallback. No effect when disabled or when real data exists.
 */
export function withSeedJournals<T extends SeedJournal>(
  real: T[] | null | undefined,
): (T | SeedJournal)[] {
  const list = real ?? [];
  if (!previewSeedEnabled() || list.length > 0) return list;

  return SEED_JOURNALS.map((s, i) => ({
    _id: `seed-journal-${i}`,
    slug: { current: `seed-journal-${i}` },
    title: s.title,
    theme: s.theme,
    summary: s.summary,
  }));
}

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

/**
 * Prefix stamped on every id produced by the seed helpers below. Real Sanity
 * documents never use this prefix, so it doubles as a reliable "this card is
 * dummy preview data" flag.
 */
export const SEED_ID_PREFIX = "seed-";

/**
 * True when an id was produced by the preview seed helpers (dummy data). Cards
 * backed by a seeded id have no real detail route, so callers should render
 * them as non-interactive. Always false in production (no seeded ids exist).
 */
export function isSeedId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SEED_ID_PREFIX);
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
// Farmer detail (R2 確定版 — Figma 8079:3748 / 8079:3966)
// ---------------------------------------------------------------------------

/**
 * 農家詳細の確定版は 9 節構成だが、production dataset の farmer ドキュメントは
 * まだ R2 のフィールド (work / interview / profileBand / fieldBand /
 * fieldSeasons …) を持たない。素のままではほぼ全節が「データ無し = 非表示」に
 * なり、レイアウトのレビューも Figma との実測対比もできない。
 *
 * そこで **プレビュー時のみ** 未入力フィールドを Figma 確定版の見本文言で
 * 埋める。フラグが無いときは入力をそのまま返すので production は無影響
 * (Sanity への書き戻しも一切しない)。
 *
 * 埋めるのは「未入力のフィールドだけ」。実データが入っている項目は上書きしない
 * ので、編集側が本文を入れていくにつれて見本は自動的に減っていく。
 */
export type SeedFarmerDetail = {
  kicker?: string;
  role?: string;
  meta?: string;
  stats?: { value: string; label: string }[];
  interviewer?: { name: string; role?: string; image?: { asset: object; alt?: string } };
  quote?: string;
  quoteBy?: string;
  workHead?: string;
  work?: { name: string; description?: string; photo?: { asset: object; alt?: string } }[];
  interview?: { question: string; answer: string }[];
  profileBand?: { label: string; value: string }[];
  fieldBand?: { label: string; value: string }[];
  fieldHead?: string;
  fieldSeasons?: {
    name: string;
    description?: string;
    photo?: { asset: object; alt?: string };
  }[];
  teasHead?: string;
};

/** Figma 確定版 (8079:3748) の見本文言。プレビュー専用の見本であり正本ではない。 */
const SEED_FARMER_DETAIL = {
  kicker: "PEOPLE 04 — ROASTER, HONYAMA",
  role: "焙煎士 ／ roji の火入れを担う",
  meta: "静岡県 本山｜2007年から、roji に届くすべての茶葉に火を入れている。",
  stats: [
    { value: "18", label: "YEARS" },
    { value: "6", label: "STORIES" },
  ],
  interviewer: { name: "髙橋 志乃", role: "roji 編集 ／ 産地取材担当" },
  quote:
    "火は、こちらの都合では動いてくれない。その日の葉がどんな顔をしているかで、決めさせてもらう。",
  workHead: "火入れは、三度に分けて決まる",
  work: [
    {
      name: "葉を見る",
      description:
        "袋を開けて、まず匂いを嗅ぐ。数値は後から。手ざわりと香りで、その日の火の強さを決める。",
    },
    {
      name: "火を入れる",
      description:
        "一度に仕上げず、弱い火で三度に分ける。急がないぶん、葉の芯まで均一に熱が通る。",
    },
    {
      name: "止める",
      description:
        "いちばん難しいのは止めどき。冷まし台に広げた瞬間の香りで、合っていたかどうかが分かる。",
    },
  ],
  interview: [
    {
      question: "焙煎士になろうと思ったきっかけは何でしたか。",
      answer:
        "なろうと思ったことはないんです。製材所にいたころ、木を乾かす釜の番をしていて、同じ木でも日によって仕上がりが変わるのが面白かった。お茶に変わっただけで、やっていることはあまり変わっていません。",
    },
    {
      question: "いちばん難しいのはどの工程ですか。",
      answer:
        "止めどきです。火を入れるのは誰でもできますが、止めるのは戻せない。あと十秒いけるかもしれない、と思ったところで下ろします。",
    },
    {
      question: "roji で飲む人に、何を届けたいですか。",
      answer:
        "「今日の分」でいいと思っています。毎日ちがう葉に、毎日ちがう火を入れているので、同じ味は二度と出ません。それを欠点だと思っていた時期もありましたが、いまはそれごと飲んでもらえたらいい。正解を決めてしまうと、次の年の葉が入る場所がなくなるので。",
    },
  ],
  profileBand: [
    { label: "拠点", value: "静岡県 静岡市 葵区 本山" },
    { label: "担当", value: "火入れ・仕上げ（全ライン）" },
    { label: "はじまり", value: "2007年 ／ 前職は製材所の乾燥釜" },
    { label: "手の届く量", value: "年間 約1.2t まで" },
  ],
  fieldBand: [
    { label: "産地", value: "静岡県 静岡市 葵区 本山 ／ 安倍川上流" },
    { label: "標高", value: "320〜480m ／ 川霧の出る谷あい" },
    { label: "品種", value: "やぶきた・つゆひかり・在来" },
    { label: "栽培", value: "自然仕立て ／ 農薬不使用 (2015年〜)" },
  ],
  fieldHead: "畑の一年は、三つの季節で決まる",
  fieldSeasons: [
    {
      name: "芽をまつ",
      description:
        "冬のあいだ畝の草は残しておく。土の温度が落ちきらないぶん、春の芽が揃って動きだす。",
    },
    {
      name: "摘む",
      description:
        "一番茶は手摘みと機械を使い分ける。同じ畑でも斜面の上と下で三日ずれる、その差を待つ。",
    },
    {
      name: "休ませる",
      description: "摘んだあとは肥料を足さずに休ませる。収量は落ちるが、翌年の香りが変わる。",
    },
  ],
  teasHead: "このひとが火を入れたお茶",
} as const;

/** 確定版 8 節「このひとが育てたお茶」の見本 (Shopify にハンドルが無いとき用)。 */
export const SEED_FARMER_TEAS: { title: string; note: string; price: string }[] = [
  { title: "本山 やぶきた 一番茶", note: "三度火・弱", price: "¥ 1,480" },
  { title: "川根 在来 秋摘み", note: "二度火・中", price: "¥ 1,280" },
  { title: "本山 くき ほうじ", note: "直火・強", price: "¥ 980" },
];

/**
 * 未入力の R2 フィールドを見本で埋めた農家ドキュメントを返す。
 * フラグ未設定なら入力をそのまま返す (production は完全に無影響)。
 */
export function withSeedFarmerDetail<T extends SeedFarmerDetail & { name: string }>(
  farmer: T,
): T {
  if (!previewSeedEnabled()) return farmer;

  const s = SEED_FARMER_DETAIL;
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

  return {
    ...farmer,
    kicker: has(farmer.kicker) ? farmer.kicker : s.kicker,
    role: has(farmer.role) ? farmer.role : s.role,
    meta: has(farmer.meta) ? farmer.meta : s.meta,
    stats: has(farmer.stats) ? farmer.stats : [...s.stats],
    interviewer: has(farmer.interviewer) ? farmer.interviewer : { ...s.interviewer },
    quote: has(farmer.quote) ? farmer.quote : s.quote,
    // 帰属は実在の氏名を使う (見本の氏名を inject しない)。
    quoteBy: has(farmer.quoteBy)
      ? farmer.quoteBy
      : `${farmer.name} ／ ${has(farmer.role) ? farmer.role : s.role}`,
    workHead: has(farmer.workHead) ? farmer.workHead : s.workHead,
    work: has(farmer.work) ? farmer.work : s.work.map((w) => ({ ...w })),
    interview: has(farmer.interview) ? farmer.interview : s.interview.map((q) => ({ ...q })),
    profileBand: has(farmer.profileBand)
      ? farmer.profileBand
      : s.profileBand.map((r) => ({ ...r })),
    fieldBand: has(farmer.fieldBand) ? farmer.fieldBand : s.fieldBand.map((r) => ({ ...r })),
    fieldHead: has(farmer.fieldHead) ? farmer.fieldHead : s.fieldHead,
    fieldSeasons: has(farmer.fieldSeasons)
      ? farmer.fieldSeasons
      : s.fieldSeasons.map((f) => ({ ...f })),
    teasHead: has(farmer.teasHead) ? farmer.teasHead : s.teasHead,
  };
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

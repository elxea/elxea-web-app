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

import type { AccountView } from "@/lib/account-view";
import type { SubscriptionContract } from "@/lib/shopify/customer";
import type { Cart } from "@/lib/shopify/types";

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
      // 1 件目は Figma【R2: 確定版】イベント詳細 6657:7931 の見本と同じ値にして
      // ある (一覧カード → 詳細で同じイベントが出る + 詳細を Figma と同条件で
      // 実測できる)。日時は 2026-08-10 14:00 JST = 05:00 UTC。
      _id: "seed-event-1",
      slug: { current: "seed-event-1" },
      imageUrl: "/hero-day.jpg",
      title: "新茶テイスティング会 2026",
      date: "2026-08-10T05:00:00.000Z",
      location: "東京・南青山 elxea atelier",
      memberOnly: true,
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

// ---------------------------------------------------------------------------
// Elxea Journal 詳細【R2: 確定版】(Figma PC 8110:46893 / SP 8110:47043)
// ---------------------------------------------------------------------------

/** PortableText の素の段落 / 見出しを 1 ブロック作る。 */
function seedBlock(style: "normal" | "h2", text: string, key: string) {
  return {
    _type: "block",
    _key: key,
    style,
    markDefs: [],
    children: [{ _type: "span", _key: `${key}s`, text, marks: [] }],
  };
}

/** 確定版の本文 (見出し 3 本 + 段落) の見本。文言は Figma 正本から写した。 */
const SEED_JOURNAL_BODY = [
  seedBlock(
    "normal",
    "このページは、一杯を飲み終えるくらいの時間で読み切れる長さにしています。続きを探しに、どこかへ移動する必要はありません。",
    "b0"
  ),
  seedBlock("h2", "霧が、茶葉を遅くする", "b1"),
  seedBlock(
    "normal",
    "霧の多い畑では、日射しが柔らかくなり、葉の育ちが数日ぶん遅れます。その遅れが、旨みの層をひとつ増やす。急がなかった葉は、湯の中でも急ぎません。",
    "b2"
  ),
  seedBlock(
    "normal",
    "この号の三種は、その遅さの度合いで選びました。もっとも霧の深い区画のものを一煎目に、風の通る尾根のものを最後に。順番そのものが、この号の編集です。",
    "b3"
  ),
  seedBlock(
    "normal",
    "「どれから飲むか」を決めるのは、いつも読み手のほうです。ただ、この号にかぎっては、こちらで順番を決めさせてもらいました。三煎のあいだに季節がひとつ動く、その速さを味わってほしかったからです。",
    "b4"
  ),
  seedBlock("h2", "二杯目の時間", "b5"),
  seedBlock(
    "normal",
    "一煎目を飲み終えて、二煎目を淹れるまでの数分間。急須の中では、まだ葉が開き続けています。この待ち時間のために、読みものの分量を決めました。",
    "b6"
  ),
  seedBlock(
    "normal",
    "二煎目の湯を注ぐころ、ちょうどこの節を読み終えるはずです。音は流したままで構いません。ページを閉じずに、そのまま次の段落へ進めるようにしてあります。",
    "b7"
  ),
  seedBlock("h2", "読み終えたら、三杯目を", "b8"),
  seedBlock(
    "normal",
    "この号の読みものは、ここで終わります。続きを探して別のページへ移る必要はありません。もし気が向いたら、下にあるほかの読みものを、このまま開いてください。",
    "b9"
  ),
  seedBlock(
    "normal",
    "霧は、朝のあいだだけのものです。この号が手元にある数週間も、たぶん同じくらいの長さでしょう。急がずに、三種を飲み終えるまで置いておいてください。",
    "b10"
  ),
];

/** 確定版の節に必要な欄だけを持つ最小形 (page 側の型と構造だけ合わせる)。 */
export type SeedJournalDetail = {
  summary?: string;
  body?: unknown[];
  mainImageCaption?: string;
  author?: { name: string; role?: string };
  teaMenus?: {
    _id: string;
    slug: { current: string };
    displayName?: string;
    title?: string;
    origin?: string;
    variety?: string;
  }[];
  otherReads?: { _id: string; title: string; slug: { current: string } }[];
  nextReadTags?: { _id: string; title: string; slug: { current: string } }[];
};

const SEED_JOURNAL_DETAIL = {
  summary:
    "この号の茶葉は、霧の多い斜面で育ちました。読みものと音楽を同じ時間から選んでいます。まずは一煎目を淹れて、湯気の向こうで読んでください。",
  mainImageCaption: "PHOTO — 朝霧の斜面 5:40",
  author: { name: "高橋 志乃", role: "elxea 茶師 / この号の選茶" },
  teaMenus: [
    {
      title: "霧尾",
      displayName: "霧尾 — くらしげ農園 2026 一番茶",
      origin: "静岡・本山 標高620m",
      variety: "やぶきた",
      slug: "seed-tea-kirio",
    },
  ],
  otherReads: [
    { title: "霧が茶をつくる", slug: "seed-read-0" },
    { title: "湯冷ましという時間", slug: "seed-read-1" },
    { title: "くらしげ農園の一年", slug: "seed-read-2" },
  ],
  nextReadTags: [
    { title: "霧", slug: "seed-tag-kiri" },
    { title: "産地のこと", slug: "seed-tag-sanchi" },
  ],
} as const;

/**
 * 未入力の確定版フィールドを見本で埋めた journal ドキュメントを返す。
 * フラグ未設定なら入力をそのまま返す (production は完全に無影響)。
 *
 * production の Sanity dataset の journal は確定版のフィールド
 * (`author` / `mainImage.caption` / `otherReads` / `nextReadTags`) が未整備で、
 * 素のままでは該当の節が「データ無し = 非表示」になり実寸計測ができない。
 */
export function withSeedJournalDetail<T extends SeedJournalDetail>(journal: T): T {
  if (!previewSeedEnabled()) return journal;

  const s = SEED_JOURNAL_DETAIL;
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

  return {
    ...journal,
    summary: has(journal.summary) ? journal.summary : s.summary,
    body: has(journal.body) ? journal.body : SEED_JOURNAL_BODY,
    mainImageCaption: has(journal.mainImageCaption)
      ? journal.mainImageCaption
      : s.mainImageCaption,
    author: has(journal.author) ? journal.author : { ...s.author },
    teaMenus: has(journal.teaMenus)
      ? journal.teaMenus
      : s.teaMenus.map((t, i) => ({
          _id: `seed-tea-${i}`,
          slug: { current: t.slug },
          title: t.title,
          displayName: t.displayName,
          origin: t.origin,
          variety: t.variety,
        })),
    otherReads: has(journal.otherReads)
      ? journal.otherReads
      : s.otherReads.map((r, i) => ({
          _id: `seed-read-${i}`,
          title: r.title,
          slug: { current: r.slug },
        })),
    nextReadTags: has(journal.nextReadTags)
      ? journal.nextReadTags
      : s.nextReadTags.map((r, i) => ({
          _id: `seed-tag-${i}`,
          title: r.title,
          slug: { current: r.slug },
        })),
  };
}

/**
 * `seed-journal-N` (一覧の見本カード) を開いたときに返す見本の詳細。
 * 実データが引けなかったときだけ使う。フラグ未設定なら常に null。
 */
export function seedJournalDetail(slug: string) {
  if (!previewSeedEnabled()) return null;
  const match = /^seed-journal-(\d+)$/.exec(slug);
  if (!match) return null;
  const index = Number(match[1]);
  const base = SEED_JOURNALS[index];
  if (!base) return null;

  return withSeedJournalDetail({
    _id: `seed-journal-${index}`,
    title: base.title,
    slug: { current: slug },
    theme: base.theme,
    summary: base.summary,
  });
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/**
 * 見本のカート (計測用)。
 *
 * `/ja/cart` は Shopify の cart cookie が無いと常に空カートになるため、確定版の
 * レイアウト (2 行 = 通常購入 + 定期便 / 小計 / 合計 / 決済ボタン) を実寸で計測
 * できない。見本は Figma【R2: 確定版】カート 変A の PC フレーム (6684:8698) に
 * 載っている値をそのまま使う。
 *
 * - フラグ未設定時 (= production / Vercel Preview の既定) は `null` を返すので、
 *   描画は見本導入前と byte-identical
 * - Shopify へは一切書き込まない (読み取りもしない。純粋なオブジェクトリテラル)
 * - `checkoutUrl` は Shopify の実 URL ではなく `#` 相当のダミー。見本カートから
 *   決済に進めないのは意図どおり (注文確定はしない)
 */
export function seedCart(): Cart | null {
  if (!previewSeedEnabled()) return null;

  const jpy = (amount: string) => ({ amount, currencyCode: "JPY" });
  const product = (handle: string, title: string) => ({
    id: `${SEED_ID_PREFIX}product-${handle}`,
    handle,
    title,
    featuredImage: {
      url: previewImageForKey(handle),
      altText: title,
      width: 1600,
      height: 1067,
    },
    vendor: "roji",
  });

  return {
    id: `${SEED_ID_PREFIX}cart`,
    checkoutUrl: "#preview-seed-no-checkout",
    totalQuantity: 3,
    cost: {
      subtotalAmount: jpy("6000"),
      totalAmount: jpy("6000"),
      totalTaxAmount: null,
    },
    lines: [
      {
        id: `${SEED_ID_PREFIX}cart-line-1`,
        quantity: 2,
        merchandise: {
          id: `${SEED_ID_PREFIX}variant-akane-100g`,
          title: "100g",
          selectedOptions: [{ name: "内容量", value: "100g" }],
          product: product("sencha-akane", "煎茶 茜 -akane-"),
          price: jpy("1800"),
        },
        cost: { totalAmount: jpy("3600") },
        sellingPlanAllocation: {
          sellingPlan: {
            id: `${SEED_ID_PREFIX}selling-plan-monthly`,
            name: "毎月1回お届け",
          },
        },
      },
      {
        id: `${SEED_ID_PREFIX}cart-line-2`,
        quantity: 1,
        merchandise: {
          id: `${SEED_ID_PREFIX}variant-midori-50g`,
          title: "50g",
          selectedOptions: [{ name: "内容量", value: "50g" }],
          product: product("gyokuro-midori", "玉露 翠 -midori-"),
          price: jpy("2400"),
        },
        cost: { totalAmount: jpy("2400") },
        sellingPlanAllocation: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Account (マイページ)【R2: 確定版】(Figma 親 8095:731 / PC 8095:733 / SP 8095:792)
// ---------------------------------------------------------------------------

/**
 * 見本のマイページ (計測用)。
 *
 * `/ja/account` はログイン必須で、ログインしていないとログイン誘導だけが出る。
 * 確定版の 4 節 (これから / 続き / これまで / お支払い方法) をカードが載った状態で
 * 実寸計測するには、**セッション無しでも確定版の骨格を描ける見本**が必要になる。
 * 値は Figma 確定版のフレームに載っている見本文言・見本日付をそのまま写した。
 *
 * - フラグ未設定時 (= production / Vercel Preview の既定) は `null` を返すので、
 *   描画は見本導入前と byte-identical (ログイン誘導のまま)
 * - Shopify / Firestore には読み書きしない (純粋なオブジェクトリテラル)
 * - 実在の顧客データは 1 件も含まない。メールは予約ドメイン (example.com) の見本
 * - 実セッションがあるときは呼ばれない (実データが優先。見本で上書きしない)
 */
export function seedAccountView(): AccountView | null {
  if (!previewSeedEnabled()) return null;

  return {
    displayName: "結城",
    email: "yuki@example.com",
    upcoming: [
      {
        id: `${SEED_ID_PREFIX}subscription-1`,
        kind: "subscription",
        date: "2026-08-20T00:00:00.000Z",
        title: "深蒸し煎茶「やまかげ」",
        href: "/account/subscriptions",
      },
      {
        id: `${SEED_ID_PREFIX}account-event-1`,
        kind: "event",
        date: "2026-09-02T00:00:00.000Z",
        title: "火入れの飲みくらべ会",
        href: "/events/seed-event-1",
      },
      {
        id: `${SEED_ID_PREFIX}account-event-2`,
        kind: "event",
        date: "2026-09-14T00:00:00.000Z",
        title: "秋のお茶会",
        href: "/events/seed-event-2",
      },
    ],
    continueItems: [
      {
        id: `${SEED_ID_PREFIX}account-favorite-1`,
        kind: "favorite-article",
        title: "火入れという時間のかけ方",
        imageUrl: previewImageAt(0),
        href: "/journal/seed-journal-0",
      },
      {
        id: `${SEED_ID_PREFIX}account-favorite-2`,
        kind: "favorite-article",
        title: "八女、白折の朝",
        imageUrl: previewImageAt(1),
        href: "/journal/seed-journal-1",
      },
    ],
    past: [
      {
        id: `${SEED_ID_PREFIX}account-order-1`,
        kind: "order",
        date: "2026-07-06T00:00:00.000Z",
        title: "#1042",
        amount: { value: "4200", currencyCode: "JPY" },
      },
      {
        id: `${SEED_ID_PREFIX}account-order-2`,
        kind: "order",
        date: "2026-06-12T00:00:00.000Z",
        title: "#1031",
        amount: { value: "6000", currencyCode: "JPY" },
      },
      {
        id: `${SEED_ID_PREFIX}account-order-3`,
        kind: "order",
        date: "2026-05-24T00:00:00.000Z",
        title: "#1018",
        amount: { value: "2400", currencyCode: "JPY" },
      },
    ],
    // 確定版の「お支払い方法」を計測するために見本のカードを 1 枚だけ持つ。
    // 実データ経路は無い (アプリ権限 read_customer_payment_methods 未付与) ので、
    // これは**プレビュー限定の見本**であり実登録カードではない。
    paymentMethod: { brand: "VISA", last4: "1234" },
    seeded: true,
  };
}

// ---------------------------------------------------------------------------
// Events (detail) — イベント詳細【R2: 確定版】(Figma PC 6657:7932 / SP 6662:8160)
// ---------------------------------------------------------------------------

/**
 * 確定版の本文 (Body 6661:13492 / 6664:8170)。
 *
 * 1 段落目は **Figma 正本から写した文言そのまま** (節の見え方を Figma と同条件で
 * 測るため)。2 段落目以降は見本の増量で、実データの長さ (Sanity の PortableText は
 * 通常もっと長い) に近づけるために足してある。段落が 1 本だけだとページが 1 画面に
 * 収まり、**SP 追従バー (6664:13496) が出る条件 (登録カードもフッターも視界に
 * 無い) を満たせず実測できない**ため、計測用の密度としてここで確保する。
 */
const SEED_EVENT_BODY = [
  seedBlock(
    "normal",
    "会員の皆さまに向けた、季節のお茶を少人数で楽しむ集まりです。当日の内容や持ち物、参加方法の詳細は、下記の申し込みページよりご確認ください。",
    "e0",
  ),
  seedBlock(
    "normal",
    "当日は摘みたての一番茶を三種、湯温を変えながら順にお出しします。同じ葉でも湯の温度で表情が変わることを、飲みくらべながら確かめていただく時間です。急須の扱いに慣れていない方には、淹れ方からご案内します。",
    "e1",
  ),
  seedBlock(
    "normal",
    "会場は南青山のアトリエ。定員は 12 名で、席は先着順にお取りしています。開始 10 分前から受付を開けていますので、少し早めにお越しいただけると落ち着いてお座りいただけます。",
    "e2",
  ),
  seedBlock(
    "normal",
    "お持ちいただくものはとくにありません。お気に入りの器がある方は、ご持参いただければその器でお出しします。当日のお茶は、後日オンラインでもお求めいただけます。",
    "e3",
  ),
];

export type SeedEventDetail = {
  _id: string;
  title: string;
  slug: { current: string };
  imageUrl?: string;
  date: string;
  endDate?: string;
  location?: string;
  memberOnly?: boolean;
  requiredTier?: "none";
  externalUrl?: string;
  description: unknown[];
};

/**
 * `seed-event-N` (一覧の見本カード) を開いたときに返す見本の詳細。
 * 実データが引けなかったときだけ使う。フラグ未設定なら常に null。
 *
 * production の Sanity dataset には未来日のイベントが無く、`/ja/events/[slug]`
 * は素のままでは 404 になるため確定版のレイアウトを実寸計測できない。
 *
 * `requiredTier: "none"` を明示しているのは**計測のため**。`memberOnly` だけを
 * true にすると tier ゲートが閉じ、未ログインの Preview では「詳細・申し込み」節が
 * MemberGate に置き換わって Body を測れない。見本は「会員限定バッジ + 登録カードの
 * 注記は出るが、本文は見える」状態 (= Figma のフレームと同じ見た目) にしてある。
 * 本番データは `requiredTier` を Sanity 側の値でそのまま評価するので影響しない。
 */
export function seedEventDetail(slug: string): SeedEventDetail | null {
  if (!previewSeedEnabled()) return null;

  const base = seedEvents().find((e) => e.slug.current === slug);
  if (!base) return null;

  return {
    _id: base._id,
    title: base.title,
    slug: base.slug,
    imageUrl: base.imageUrl,
    date: base.date,
    endDate: base.endDate,
    location: base.location,
    memberOnly: base.memberOnly,
    requiredTier: "none",
    externalUrl: "https://elxea.com/",
    description: SEED_EVENT_BODY,
  };
}

// ---------------------------------------------------------------------------
// 定期便管理【R2: 確定版】(Figma section 6717:14526 / PC 6717:14527 / SP 6723:14747)
// ---------------------------------------------------------------------------

/**
 * 見本の定期便契約 3 件 (計測用)。
 *
 * `/ja/account/subscriptions` はログイン必須で、さらに Shopify に定期便契約が
 * 無いと確定版の 3 状態 (契約中 / 一時停止中 / 解約済み) を実寸計測できない。
 * 値は Figma 確定版のカードに載っている見本文言・見本価格・見本日付をそのまま写した。
 *
 * - フラグ未設定時 (= production / Vercel Preview の既定) は `null` を返すので、
 *   描画は見本導入前と byte-identical (ログイン誘導のまま)
 * - Shopify には読み書きしない (純粋なオブジェクトリテラル)
 * - 実在の顧客データ・実在の契約 ID は 1 件も含まない。ID は `seed-` 前置きで、
 *   Shopify の `gid://shopify/SubscriptionContract/...` 形式では**ない**
 * - 画面側は見本のとき `preview` を立てて Server Action を 1 度も呼ばない。
 *   見本から実契約への mutation が飛ぶ経路は作らない
 * - 実セッションがあるときは呼ばれない (実データが優先)
 *
 * `PREVIEW_SEED_SUBSCRIPTIONS_EMPTY=1` を足すと**空配列**を返す。確定版の
 * 「契約 0 件の表示」(EmptyCard 6720:9378) はログイン済みで契約が 0 件のときだけ
 * 出る状態で、セッション無しでは到達できないため、計測用にこの入口を用意している
 * (空配列は truthy なのでログイン誘導ではなく 0 件表示に落ちる)。
 */
export function seedSubscriptionContracts(): SubscriptionContract[] | null {
  if (!previewSeedEnabled()) return null;
  if (process.env.PREVIEW_SEED_SUBSCRIPTIONS_EMPTY === "1") return [];

  const line = (
    key: string,
    title: string,
    variantTitle: string | null,
    quantity: number,
    amount: string
  ) => ({
    node: {
      id: `${SEED_ID_PREFIX}subscription-line-${key}`,
      title,
      variantTitle,
      quantity,
      currentPrice: { amount, currencyCode: "JPY" },
      variantImage: null,
    },
  });

  return [
    {
      // 契約中 (Figma 6717:14573 / SP 6723:14760)
      id: `${SEED_ID_PREFIX}subscription-contract-active`,
      status: "ACTIVE",
      createdAt: "2026-03-15T00:00:00.000Z",
      nextBillingDate: "2026-06-15T00:00:00.000Z",
      deliveryPolicy: { interval: "MONTH", intervalCount: { count: 1 } },
      lines: {
        edges: [
          line("coffee", "深煎りブレンド コーヒー豆（200g）", "粉 / 中挽き", 1, "1800"),
          line("tea", "和紅茶ティーバッグ（12個入）", "標準", 2, "2400"),
        ],
      },
    },
    {
      // 一時停止中 (Figma 6718:14888 / SP 6723:14796)
      id: `${SEED_ID_PREFIX}subscription-contract-paused`,
      status: "PAUSED",
      createdAt: "2026-02-02T00:00:00.000Z",
      nextBillingDate: null,
      deliveryPolicy: { interval: "WEEK", intervalCount: { count: 2 } },
      lines: {
        edges: [line("tea-paused", "和紅茶ティーバッグ（12個入）", "標準", 1, "2400")],
      },
    },
    {
      // 解約済み (Figma 6718:14906 / SP 6723:14813)
      id: `${SEED_ID_PREFIX}subscription-contract-cancelled`,
      status: "CANCELLED",
      createdAt: "2025-11-08T00:00:00.000Z",
      nextBillingDate: null,
      deliveryPolicy: { interval: "MONTH", intervalCount: { count: 1 } },
      lines: {
        edges: [
          line("coffee-cancelled", "深煎りブレンド コーヒー豆（200g）", "粉 / 中挽き", 1, "1800"),
        ],
      },
    },
  ];
}

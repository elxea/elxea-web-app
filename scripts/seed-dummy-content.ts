/**
 * Seed dummy content into Sanity for development/preview.
 * Run with: npx tsx scripts/seed-dummy-content.ts
 *
 * Creates: categories, tags, authors, articles, events, farmers,
 *          tea menus, playlists, elxea journals
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveWriteDatasetOrExit } from "../lib/sanity/write-target";

// Load env vars
const envPath = join(process.cwd(), ".env");
const envContent = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

// Get Sanity CLI auth token
const sanityConfigPath = join(
  process.env.HOME || "",
  ".config/sanity/config.json"
);
let authToken = "";
try {
  const sanityConfig = JSON.parse(readFileSync(sanityConfigPath, "utf-8"));
  authToken = sanityConfig.authToken;
} catch {
  console.error("Could not read Sanity CLI config. Run `npx sanity login` first.");
  process.exit(1);
}

const dataset = resolveWriteDatasetOrExit({
  scriptName: "scripts/seed-dummy-content.ts",
  env: { ...process.env, ...env },
});

const client = createClient({
  projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID || "5s8ahx87",
  dataset,
  apiVersion: "2024-12-01",
  useCdn: false,
  token: authToken,
});

// ─── Helper ──────────────────────────────────────────────────────────

function ref(id: string) {
  return { _type: "reference", _ref: id };
}

function block(text: string) {
  return [
    {
      _type: "block",
      _key: crypto.randomUUID().slice(0, 8),
      style: "normal",
      children: [
        {
          _type: "span",
          _key: crypto.randomUUID().slice(0, 8),
          text,
          marks: [],
        },
      ],
      markDefs: [],
    },
  ];
}

function futureDate(daysFromNow: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

// ─── Data ────────────────────────────────────────────────────────────

const categories = [
  { _id: "cat-column", _type: "category", title: "コラム", slug: { _type: "slug", current: "column" } },
  { _id: "cat-recipe", _type: "category", title: "レシピ", slug: { _type: "slug", current: "recipe" } },
  { _id: "cat-interview", _type: "category", title: "インタビュー", slug: { _type: "slug", current: "interview" } },
  { _id: "cat-knowledge", _type: "category", title: "お茶の知識", slug: { _type: "slug", current: "tea-knowledge" } },
];

const tags = [
  { _id: "tag-japanese-tea", _type: "tag", title: "日本茶", slug: { _type: "slug", current: "japanese-tea" } },
  { _id: "tag-matcha", _type: "tag", title: "抹茶", slug: { _type: "slug", current: "matcha" } },
  { _id: "tag-sencha", _type: "tag", title: "煎茶", slug: { _type: "slug", current: "sencha" } },
  { _id: "tag-seasonal", _type: "tag", title: "季節", slug: { _type: "slug", current: "seasonal" } },
  { _id: "tag-brewing", _type: "tag", title: "淹れ方", slug: { _type: "slug", current: "brewing" } },
];

const authors = [
  {
    _id: "author-setaka",
    _type: "author",
    name: "Setaka",
    slug: { _type: "slug", current: "setaka" },
    role: "Founder",
    bio: "elxea 代表。日本各地の茶農家を訪問し、スペシャルティティーの魅力を発信しています。",
  },
  {
    _id: "author-roji",
    _type: "author",
    name: "roji 編集部",
    slug: { _type: "slug", current: "roji-editorial" },
    role: "Editorial",
    bio: "elxea のオウンドメディア「roji」編集チーム。お茶にまつわる物語をお届けします。",
  },
];

const articles = [
  {
    _id: "article-mindfulness",
    _type: "article",
    title: "お茶とマインドフルネス — 一杯の時間が生む静寂",
    slug: { _type: "slug", current: "tea-and-mindfulness" },
    language: "ja",
    excerpt: "忙しい毎日のなかで、お茶を淹れる時間は心を整えるひとときになります。マインドフルネスの視点から、お茶の楽しみ方を考えます。",
    body: block("お茶を淹れるという行為は、それ自体がひとつの瞑想です。湯を沸かし、茶葉を量り、温度を測り、注ぐ。この一連の動作に意識を向けるとき、私たちは「今ここ」に戻ってきます。\n\n日本の茶道が「一期一会」を重んじるのは、まさにこのマインドフルネスの精神です。同じ茶葉、同じ水、同じ器を使っても、二度と同じ一杯は生まれません。\n\nまずは朝の一杯から。スマートフォンを置き、お茶を淹れる3分間だけ、自分のためだけの時間を過ごしてみてください。"),
    publishedAt: "2026-02-15T09:00:00Z",
    category: ref("cat-column"),
    author: ref("author-setaka"),
    tags: [ref("tag-japanese-tea"), ref("tag-seasonal")],
    requiredTier: "none",
    memberOnly: false,
  },
  {
    _id: "article-cold-brew",
    _type: "article",
    title: "夏の水出し煎茶 — 甘みを引き出すレシピ",
    slug: { _type: "slug", current: "cold-brew-sencha" },
    language: "ja",
    excerpt: "水出しで淹れる煎茶は、熱湯では感じられない甘みとまろやかさが特徴。夏にぴったりの水出しレシピをご紹介します。",
    body: block("水出し煎茶は、低温でじっくり抽出することで、カテキンの渋みを抑えながらテアニンの甘みを最大限に引き出します。\n\n【材料】\n・煎茶 10g\n・水（軟水） 500ml\n・ガラスポット\n\n【手順】\n1. ポットに茶葉を入れる\n2. 常温の水を注ぐ\n3. 冷蔵庫で4〜6時間抽出\n4. 茶漉しで注ぐ\n\nポイントは水の温度。常温から冷蔵庫に入れることで、ゆっくりと抽出されます。"),
    publishedAt: "2026-02-20T09:00:00Z",
    category: ref("cat-recipe"),
    author: ref("author-roji"),
    tags: [ref("tag-sencha"), ref("tag-brewing")],
    requiredTier: "none",
    memberOnly: false,
  },
  {
    _id: "article-farmer-story",
    _type: "article",
    title: "静岡の茶農家・山田さんが語る「手摘み」へのこだわり",
    slug: { _type: "slug", current: "farmer-yamada-interview" },
    language: "ja",
    excerpt: "静岡県牧之原市で三代にわたりお茶を栽培する山田農園。手摘みにこだわる理由と、その味わいの違いについて伺いました。",
    body: block("「機械摘みと手摘みでは、茶葉の傷み方がまったく違います」。そう語るのは、静岡県牧之原市で三代続く茶農家の山田太郎さん（仮名）。\n\n春先の新芽を一枚一枚丁寧に摘む手摘みは、時間も手間もかかります。しかし、茶葉が傷つかないぶん、雑味のないクリアな味わいになるのだそうです。\n\n「お茶は農作物です。その年の天候、土の状態、摘む日のタイミングですべてが変わる。だからこそ面白い」。\n\n※このコンテンツはダミーです。実際の農家インタビューに差し替え予定です。"),
    publishedAt: "2026-03-01T09:00:00Z",
    category: ref("cat-interview"),
    author: ref("author-setaka"),
    tags: [ref("tag-japanese-tea")],
    requiredTier: "standard",
    memberOnly: false,
  },
  {
    _id: "article-brewing-guide",
    _type: "article",
    title: "はじめてのスペシャルティティー — 基本の淹れ方ガイド",
    slug: { _type: "slug", current: "beginners-brewing-guide" },
    language: "ja",
    excerpt: "スペシャルティティーを最大限に楽しむための基本的な淹れ方をご紹介。温度・量・時間の3要素を押さえれば、誰でもおいしいお茶が淹れられます。",
    body: block("スペシャルティティーの味わいを引き出すには、3つの要素が大切です。\n\n【1. 温度】\n煎茶: 70-80℃ / 玉露: 50-60℃ / ほうじ茶: 95-100℃\n\n【2. 茶葉の量】\n一人分 3-5g が目安。多すぎると渋みが出やすくなります。\n\n【3. 抽出時間】\n煎茶: 60-90秒 / 玉露: 120-150秒 / ほうじ茶: 30秒\n\nまずはパッケージに記載された推奨の淹れ方を試し、そこから自分好みに調整していくのがおすすめです。"),
    publishedAt: "2026-03-05T09:00:00Z",
    category: ref("cat-knowledge"),
    author: ref("author-roji"),
    tags: [ref("tag-brewing"), ref("tag-japanese-tea")],
    requiredTier: "none",
    memberOnly: false,
  },
  {
    _id: "article-matcha-latte",
    _type: "article",
    title: "プレミアム会員限定：本格抹茶ラテの作り方",
    slug: { _type: "slug", current: "premium-matcha-latte" },
    language: "ja",
    excerpt: "カフェクオリティの抹茶ラテを自宅で再現。プレミアム会員だけに公開する特別レシピです。",
    body: block("【プレミアム会員限定レシピ】\n\n最高級の抹茶を使った本格抹茶ラテのレシピをご紹介します。\n\n【材料】\n・抹茶（薄茶用） 2g\n・お湯（80℃） 30ml\n・牛乳またはオーツミルク 150ml\n・お好みで甜菜糖\n\n【手順】\n1. 茶漉しで抹茶をふるう\n2. 少量のお湯で抹茶をダマなく練る\n3. 残りのお湯を加え、茶筅で点てる\n4. 温めたミルクをフォーマーで泡立てる\n5. 抹茶にミルクを注ぐ\n\n※このコンテンツはダミーです。"),
    publishedAt: "2026-03-10T09:00:00Z",
    category: ref("cat-recipe"),
    author: ref("author-setaka"),
    tags: [ref("tag-matcha"), ref("tag-brewing")],
    requiredTier: "premium",
    memberOnly: false,
  },
];

const events = [
  {
    _id: "event-tea-tasting",
    _type: "event",
    title: "春の新茶テイスティング会",
    slug: { _type: "slug", current: "spring-tea-tasting-2026" },
    language: "ja",
    date: futureDate(30),
    endDate: futureDate(30),
    location: "東京・渋谷 elxea ポップアップスペース",
    description: block("2026年春の新茶を一足先にテイスティングできるイベントです。静岡、京都、鹿児島の茶農家から届いた新茶を飲み比べ。農家さんとのオンライン中継も予定しています。\n\n定員: 20名\n参加費: 無料（elxea 会員限定）\n\n※このイベントはダミーです。"),
    requiredTier: "standard",
    memberOnly: false,
  },
  {
    _id: "event-brewing-workshop",
    _type: "event",
    title: "はじめてのお茶ワークショップ",
    slug: { _type: "slug", current: "beginners-tea-workshop" },
    language: "ja",
    date: futureDate(45),
    endDate: futureDate(45),
    location: "オンライン（Zoom）",
    externalUrl: "https://example.com/workshop",
    description: block("お茶の基本的な淹れ方から、品種ごとの味わいの違いまで。初心者向けのオンラインワークショップです。事前にお茶セットをお届けし、画面越しに一緒に淹れながら学びます。\n\n定員: 30名\n参加費: 無料\n\n※このイベントはダミーです。"),
    requiredTier: "none",
    memberOnly: false,
  },
];

const farmers = [
  {
    _id: "farmer-yamada",
    _type: "farmer",
    name: "山田農園",
    slug: { _type: "slug", current: "yamada-farm" },
    language: "ja",
    region: "静岡県牧之原市",
    country: "日本",
    bio: block("三代にわたりお茶を栽培する山田農園。手摘みにこだわり、有機栽培に取り組んでいます。代表の山田太郎さんは「土づくりがお茶の味を決める」と語ります。\n\n主な品種: やぶきた、さえみどり\n\n※このプロフィールはダミーです。実際の農家情報に差し替え予定です。"),
  },
  {
    _id: "farmer-tanaka",
    _type: "farmer",
    name: "田中茶園",
    slug: { _type: "slug", current: "tanaka-tea-garden" },
    language: "ja",
    region: "京都府宇治市",
    country: "日本",
    bio: block("宇治で100年以上の歴史を持つ田中茶園。覆い下栽培による玉露と抹茶の生産を得意とし、全国品評会で数々の受賞歴があります。\n\n主な品種: さみどり、ごこう\n\n※このプロフィールはダミーです。"),
  },
];

const teaMenus = [
  {
    _id: "tea-sencha-spring",
    _type: "teaMenu",
    title: "Spring Sencha",
    displayName: "春摘み煎茶",
    slug: { _type: "slug", current: "spring-sencha" },
    language: "ja",
    category: "sencha",
    variety: "やぶきた",
    season: "2026年 春",
    origin: "静岡県牧之原市",
    productNumber: 1,
    netWeight: "50g",
    description: block("春の一番茶を丁寧に蒸し上げた深蒸し煎茶。甘みと旨味のバランスに優れ、毎日の一杯に最適です。"),
    brewingGuide: {
      temperature: "75℃",
      water: "150ml",
      time: "60秒",
    },
  },
  {
    _id: "tea-gyokuro",
    _type: "teaMenu",
    title: "Premium Gyokuro",
    displayName: "玉露 — 宇治",
    slug: { _type: "slug", current: "uji-gyokuro" },
    language: "ja",
    category: "gyokuro",
    variety: "さみどり",
    season: "2026年 春",
    origin: "京都府宇治市",
    productNumber: 2,
    netWeight: "30g",
    description: block("20日間以上の被覆栽培で育てた宇治玉露。濃厚な旨味と覆い香が特徴です。少量のぬるめのお湯でじっくりと。"),
    brewingGuide: {
      temperature: "55℃",
      water: "50ml",
      time: "120秒",
    },
  },
  {
    _id: "tea-hojicha",
    _type: "teaMenu",
    title: "Roasted Hojicha",
    displayName: "焙じ茶 — 加賀",
    slug: { _type: "slug", current: "kaga-hojicha" },
    language: "ja",
    category: "hojicha",
    variety: "やぶきた（茎茶）",
    season: "通年",
    origin: "石川県加賀市",
    productNumber: 3,
    netWeight: "60g",
    description: block("茎を丁寧に焙じた加賀棒茶。香ばしさのなかに甘みがあり、カフェインが少ないので夜のリラックスタイムにもおすすめです。"),
    brewingGuide: {
      temperature: "95℃",
      water: "200ml",
      time: "30秒",
    },
  },
];

const playlists = [
  {
    _id: "playlist-morning-forest",
    _type: "playlist",
    title: "Morning Forest",
    slug: { _type: "slug", current: "morning-forest" },
    category: "forest",
    description: block("早朝の森で録音した環境音。鳥のさえずり、木々を抜ける風、小川のせせらぎ。お茶の時間のBGMに。"),
    dateRecorded: "2026-01-15",
    recordedAt: "長野県・上高地",
    artist: ref("author-setaka"),
    spotifyUrl: "https://open.spotify.com/playlist/example1",
    colors: {
      primary: "#2D5016",
      secondary: "#8BC34A",
    },
  },
  {
    _id: "playlist-rain-on-leaves",
    _type: "playlist",
    title: "Rain on Tea Leaves",
    slug: { _type: "slug", current: "rain-on-tea-leaves" },
    category: "rain",
    description: block("茶畑に降る雨の音。静岡の茶畑で録音した、雨粒が茶葉に当たる繊細な音を集めました。"),
    dateRecorded: "2026-02-20",
    recordedAt: "静岡県・牧之原",
    artist: ref("author-roji"),
    spotifyUrl: "https://open.spotify.com/playlist/example2",
    colors: {
      primary: "#1565C0",
      secondary: "#90CAF9",
    },
  },
];

const journals = [
  {
    _id: "journal-spring-2026",
    _type: "journal",
    title: "elxea Journal — 春号 2026",
    slug: { _type: "slug", current: "spring-2026" },
    language: "ja",
    theme: "akane",
    body: block("春の訪れとともに、今年最初の新茶が届きました。今号では静岡の山田農園を訪ね、春摘み煎茶ができるまでの物語をお届けします。\n\n茶畑を吹き抜ける春風の心地よさ、手摘みの丁寧さ、そして一杯に込められた想い。お茶を通じて感じる、日本の春をお楽しみください。\n\n※このコンテンツはダミーです。"),
    publishedAt: "2026-03-01T09:00:00Z",
    relatedPost: ref("article-mindfulness"),
    playlist: ref("playlist-morning-forest"),
    teaMenus: [ref("tea-sencha-spring")],
  },
  {
    _id: "journal-winter-2025",
    _type: "journal",
    title: "elxea Journal — 冬号 2025",
    slug: { _type: "slug", current: "winter-2025" },
    language: "ja",
    theme: "sui",
    body: block("冬の寒さのなかで飲む一杯のお茶は、格別の温かさを与えてくれます。今号では加賀の焙じ茶文化と、冬の夜に楽しむお茶の時間について。\n\n※このコンテンツはダミーです。"),
    publishedAt: "2025-12-01T09:00:00Z",
    relatedPost: ref("article-brewing-guide"),
    playlist: ref("playlist-rain-on-leaves"),
    teaMenus: [ref("tea-hojicha")],
  },
];

// ─── Seed ────────────────────────────────────────────────────────────

async function seed() {
  const allDocs = [
    ...categories,
    ...tags,
    ...authors,
    ...articles,
    ...events,
    ...farmers,
    ...teaMenus,
    ...playlists,
    ...journals,
  ];

  console.log(`Seeding ${allDocs.length} documents...`);

  let created = 0;
  let skipped = 0;

  for (const doc of allDocs) {
    try {
      // Check if document already exists
      const existing = await client.getDocument(doc._id);
      if (existing) {
        console.log(`  ⏭ ${doc._type}/${doc._id} (already exists)`);
        skipped++;
        continue;
      }
    } catch {
      // Document doesn't exist, proceed with creation
    }

    try {
      await client.createOrReplace(doc);
      console.log(`  ✓ ${doc._type}/${doc._id}`);
      created++;
    } catch (error) {
      console.error(`  ✗ ${doc._type}/${doc._id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

seed().catch(console.error);

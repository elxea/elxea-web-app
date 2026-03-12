/**
 * Migration script: Webflow → Sanity
 * Run with: npx tsx scripts/migrate-webflow-to-sanity.ts
 *
 * Uses the Sanity CLI auth token from ~/.config/sanity/config.json
 * Requires: NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET env vars
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

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

const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = env.NEXT_PUBLIC_SANITY_DATASET || "production";

if (!projectId) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: "2024-01-01",
  useCdn: false,
  token: authToken,
});

// ─── Categories ──────────────────────────────────────────────
const categories = [
  { title: "産地紹介", slug: "sanchi-shokai", description: "日本各地の茶産地を訪ねるレポート" },
  { title: "インタビュー", slug: "interview", description: "生産者・茶師・クリエイターへのインタビュー" },
  { title: "コラム", slug: "column", description: "お茶にまつわるエッセイ・考察" },
  { title: "楽しみ方", slug: "tanoshimikata", description: "お茶の淹れ方・ペアリング・ギフトガイド" },
  { title: "レシピ", slug: "recipe", description: "お茶を使ったレシピ・アレンジ" },
];

// ─── Tags (common tags extracted from Webflow) ──────────────
const tags: { title: string; slug: string }[] = [
  { title: "日本茶", slug: "nihoncha" },
  { title: "煎茶", slug: "sencha" },
  { title: "ほうじ茶", slug: "hojicha" },
  { title: "抹茶", slug: "matcha" },
  { title: "紅茶", slug: "kocha" },
  { title: "玉露", slug: "gyokuro" },
  { title: "和束", slug: "wazuka" },
  { title: "京都", slug: "kyoto" },
  { title: "静岡", slug: "shizuoka" },
  { title: "鹿児島", slug: "kagoshima" },
  { title: "対馬", slug: "tsushima" },
  { title: "産地", slug: "sanchi" },
  { title: "農家", slug: "nouka" },
  { title: "レシピ", slug: "recipe" },
  { title: "ペアリング", slug: "pairing" },
  { title: "和菓子", slug: "wagashi" },
  { title: "マインドフルネス", slug: "mindfulness" },
  { title: "音楽", slug: "music" },
  { title: "ギフト", slug: "gift" },
  { title: "スローライフ", slug: "slow-life" },
];

// ─── Authors ─────────────────────────────────────────────────
const authors = [
  {
    name: "Setaka On",
    slug: "setaka-on",
    role: "Founder / Editor",
    bio: "elxea創設者。日本茶の可能性を探り、Tea for Creativity.を掲げる。",
    website: "https://elxea.com",
  },
];

// ─── Posts (metadata from Webflow, body to be added later) ──
const posts = [
  {
    title: "和束町の茶畑を歩く —— 京都府唯一の茶産地",
    slug: "wazuka-tea-fields-kyoto",
    category: "sanchi-shokai",
    author: "setaka-on",
    tags: ["日本茶", "京都", "和束", "産地"],
    publishedAt: "2026-02-15",
    excerpt: "京都府の南端に位置する和束町。日本茶の約4割を生産するこの地を歩き、茶畑の風景とそこに暮らす人々の物語を紹介します。",
  },
  {
    title: "陶芸家と急須 —— 手仕事が生む味わい",
    slug: "ceramist-teapot-interview",
    category: "interview",
    author: null,
    tags: ["日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "急須づくりに情熱を注ぐ陶芸家へのインタビュー。手仕事が生み出すお茶の味わいの違いとは。",
  },
  {
    title: "お茶の時間という贅沢 —— スローライフの実践",
    slug: "luxury-of-tea-time-slow-life",
    category: "column",
    author: null,
    tags: ["スローライフ", "マインドフルネス"],
    publishedAt: "2026-02-15",
    excerpt: "忙しい日常の中で、お茶の時間を意識的につくることの意味。スローライフの実践としてのお茶。",
  },
  {
    title: "和菓子とお茶のペアリング —— 季節を味わう組み合わせ",
    slug: "wagashi-tea-pairing",
    category: "tanoshimikata",
    author: null,
    tags: ["ペアリング", "和菓子", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "季節の和菓子とお茶の組み合わせを紹介。春夏秋冬、それぞれの味わいを楽しむペアリングガイド。",
  },
  {
    title: "ほうじ茶ラテの作り方 —— 自宅で簡単カフェ気分",
    slug: "hojicha-latte-recipe",
    category: "recipe",
    author: "setaka-on",
    tags: ["ほうじ茶", "レシピ"],
    publishedAt: "2026-02-15",
    excerpt: "自宅で簡単に作れるほうじ茶ラテのレシピ。香ばしい風味とまろやかなミルクのハーモニー。",
  },
  {
    title: "水出し緑茶のすすめ —— 夏の午後を涼やかに",
    slug: "cold-brew-green-tea-summer",
    category: "tanoshimikata",
    author: "setaka-on",
    tags: ["煎茶", "レシピ"],
    publishedAt: "2026-02-15",
    excerpt: "暑い夏にぴったりの水出し緑茶。まろやかな甘みと旨みが際立つ、冷たいお茶の楽しみ方。",
  },
  {
    title: "生産者インタビュー：つしま大石農園",
    slug: "producer-interview-tsushima-oishi-farm",
    category: "interview",
    author: null,
    tags: ["対馬", "農家", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "対馬で茶園を営む大石農園さんへのインタビュー。離島の茶づくりへの想いと、その味わいの秘密。",
  },
  {
    title: "建築家が設計した茶室 —— 空間とお茶の関係",
    slug: "architect-designs-tea-room",
    category: "interview",
    author: "setaka-on",
    tags: ["日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "現代建築と茶室の融合。建築家が語る、お茶を楽しむための空間づくり。",
  },
  {
    title: "茶師・山田一郎が語る —— 良いお茶とは何か",
    slug: "interview-tea-master-yamada",
    category: "interview",
    author: null,
    tags: ["日本茶", "農家"],
    publishedAt: "2026-02-15",
    excerpt: "数十年のキャリアを持つ茶師が語る、良いお茶の定義とこれからの日本茶。",
  },
  {
    title: "お茶とマインドフルネス",
    slug: "ocha-to-mindfulness",
    category: "column",
    author: null,
    tags: ["マインドフルネス", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "一杯のお茶を丁寧に淹れ、味わう。その所作の中にあるマインドフルネスの実践。",
  },
  {
    title: "旅先のお茶 —— 世界の茶文化を巡って",
    slug: "tea-cultures-around-the-world",
    category: "column",
    author: "setaka-on",
    tags: ["日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "世界各地の茶文化を巡る旅のエッセイ。中国、台湾、モロッコ、イギリス…お茶が紡ぐ物語。",
  },
  {
    title: "お茶と音楽 —— アンビエントサウンドと煎茶の時間",
    slug: "tea-and-ambient-music",
    category: "column",
    author: "setaka-on",
    tags: ["音楽", "煎茶"],
    publishedAt: "2026-02-15",
    excerpt: "お茶の時間をより豊かにするアンビエントミュージック。静かな音と煎茶の香りが織りなす空間。",
  },
  {
    title: "夏のアイスティーの淹れ方",
    slug: "natsu-no-aisutii-no-irikata",
    category: "tanoshimikata",
    author: "setaka-on",
    tags: ["レシピ", "紅茶"],
    publishedAt: "2026-02-15",
    excerpt: "本格アイスティーを自宅で。急冷式と水出し式、それぞれの方法とおすすめ茶葉。",
  },
  {
    title: "紅茶のペアリング：スイーツとの相性",
    slug: "black-tea-pairing-sweets",
    category: "tanoshimikata",
    author: null,
    tags: ["紅茶", "ペアリング"],
    publishedAt: "2026-02-15",
    excerpt: "紅茶とスイーツの絶妙な組み合わせを紹介。ケーキ、チョコレート、焼き菓子…それぞれに合う紅茶とは。",
  },
  {
    title: "お茶のギフト選び —— 大切な人に届ける一杯",
    slug: "tea-gift-guide",
    category: "tanoshimikata",
    author: null,
    tags: ["ギフト", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "大切な人に贈るお茶のギフト選びのポイント。シーン別・予算別のおすすめを紹介。",
  },
  // Additional posts found in related articles
  {
    title: "春の訪れを告げる茶畑の風景",
    slug: "haru-no-tozure-o-tsugeru-chabatake-no-fukei",
    category: "sanchi-shokai",
    author: null,
    tags: ["産地", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "春を迎えた茶畑の美しい風景。新芽が芽吹く季節の移ろいを写真とともに。",
  },
  {
    title: "冬の京都・和束の茶畑で感じる、霧と静寂",
    slug: "winter-kyoto-wazuka-tea-fields",
    category: "sanchi-shokai",
    author: "setaka-on",
    tags: ["京都", "和束", "産地"],
    publishedAt: "2026-02-15",
    excerpt: "冬の和束を訪ねて。霧に包まれた茶畑の静寂と、冬ならではの風景の美しさ。",
  },
  {
    title: "鹿児島県知覧 —— 南国の茶畑に広がる深蒸し茶",
    slug: "chiran-kagoshima-fukamushi",
    category: "sanchi-shokai",
    author: null,
    tags: ["鹿児島", "産地", "煎茶"],
    publishedAt: "2026-02-15",
    excerpt: "鹿児島県知覧の茶畑を訪問。南国の温暖な気候が育む深蒸し茶の魅力とは。",
  },
  {
    title: "静岡県牧之原 —— 日本最大の茶産地を訪ねて",
    slug: "makinohara-shizuoka-tea-region",
    category: "sanchi-shokai",
    author: null,
    tags: ["静岡", "産地", "煎茶"],
    publishedAt: "2026-02-15",
    excerpt: "日本最大の茶産地、静岡県牧之原台地。広大な茶畑と、そこで働く人々の物語。",
  },
];

// ─── Migration logic ─────────────────────────────────────────

async function migrate() {
  console.log(`Migrating to Sanity project: ${projectId} / ${dataset}`);
  console.log("---");

  // 1. Create categories
  console.log("Creating categories...");
  const categoryRefs: Record<string, string> = {};
  for (const cat of categories) {
    const id = `category-${cat.slug}`;
    await client.createOrReplace({
      _id: id,
      _type: "category",
      title: cat.title,
      slug: { _type: "slug", current: cat.slug },
      description: cat.description,
    });
    categoryRefs[cat.slug] = id;
    console.log(`  ✓ ${cat.title}`);
  }

  // 2. Create tags
  console.log("\nCreating tags...");
  const tagRefs: Record<string, string> = {};
  for (const tag of tags) {
    const id = `tag-${tag.slug}`;
    await client.createOrReplace({
      _id: id,
      _type: "tag",
      title: tag.title,
      slug: { _type: "slug", current: tag.slug },
    });
    tagRefs[tag.title] = id;
    console.log(`  ✓ ${tag.title}`);
  }

  // 3. Create authors
  console.log("\nCreating authors...");
  const authorRefs: Record<string, string> = {};
  for (const author of authors) {
    const id = `author-${author.slug}`;
    await client.createOrReplace({
      _id: id,
      _type: "author",
      name: author.name,
      slug: { _type: "slug", current: author.slug },
      role: author.role,
      bio: author.bio,
      website: author.website,
    });
    authorRefs[author.slug] = id;
    console.log(`  ✓ ${author.name}`);
  }

  // 4. Create posts
  console.log("\nCreating posts...");
  for (const post of posts) {
    const id = `article-${post.slug}`;
    const doc: Record<string, unknown> = {
      _id: id,
      _type: "article",
      title: post.title,
      slug: { _type: "slug", current: post.slug },
      excerpt: post.excerpt,
      publishedAt: new Date(`${post.publishedAt}T00:00:00+09:00`).toISOString(),
      language: "ja",
      memberOnly: false,
      featured: false,
      category: {
        _type: "reference",
        _ref: categoryRefs[post.category],
      },
      tags: post.tags.map((tag) => ({
        _type: "reference",
        _ref: tagRefs[tag],
        _key: tagRefs[tag],
      })),
    };

    if (post.author && authorRefs[post.author]) {
      doc.author = {
        _type: "reference",
        _ref: authorRefs[post.author],
      };
    }

    await client.createOrReplace(doc);
    console.log(`  ✓ ${post.title}`);
  }

  console.log("\n---");
  console.log(`Migration complete!`);
  console.log(`  Categories: ${categories.length}`);
  console.log(`  Tags: ${tags.length}`);
  console.log(`  Authors: ${authors.length}`);
  console.log(`  Posts: ${posts.length}`);
  console.log(`\nNote: Post body content (Portable Text) needs to be added separately.`);
  console.log(`Playlists, Tea Menus, and Journals have no data in Webflow yet.`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

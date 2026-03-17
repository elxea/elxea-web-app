/**
 * Migration script: Add body content + missing posts/categories to Sanity
 * Run with: npx tsx scripts/migrate-webflow-bodies.ts
 *
 * Phase 2 follow-up: Adds Portable Text body content scraped from Webflow,
 * plus 3 missing categories and 11 missing posts.
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

// ─── Helper: generate unique _key for Portable Text blocks ────
let keyCounter = 0;
function genKey(): string {
  return `k${Date.now().toString(36)}${(keyCounter++).toString(36)}`;
}

// ─── Helper: HTML body elements → Portable Text blocks ────────
type BodyElement =
  | { type: "h2" | "h3" | "p" | "blockquote"; text: string }
  | { type: "ul" | "ol"; items: string[] };

function toPortableText(elements: BodyElement[]): unknown[] {
  const blocks: unknown[] = [];

  for (const el of elements) {
    if (el.type === "h2" || el.type === "h3") {
      blocks.push({
        _type: "block",
        _key: genKey(),
        style: el.type,
        children: [{ _type: "span", _key: genKey(), text: el.text, marks: [] }],
        markDefs: [],
      });
    } else if (el.type === "p") {
      blocks.push({
        _type: "block",
        _key: genKey(),
        style: "normal",
        children: [{ _type: "span", _key: genKey(), text: el.text, marks: [] }],
        markDefs: [],
      });
    } else if (el.type === "blockquote") {
      blocks.push({
        _type: "block",
        _key: genKey(),
        style: "blockquote",
        children: [{ _type: "span", _key: genKey(), text: el.text, marks: [] }],
        markDefs: [],
      });
    } else if (el.type === "ul" || el.type === "ol") {
      const listItem = el.type === "ul" ? "bullet" : "number";
      for (const item of el.items) {
        blocks.push({
          _type: "block",
          _key: genKey(),
          style: "normal",
          listItem,
          level: 1,
          children: [{ _type: "span", _key: genKey(), text: item, marks: [] }],
          markDefs: [],
        });
      }
    }
  }

  return blocks;
}

// ─── New categories (not in original migration) ───────────────
const newCategories = [
  { title: "季節の話", slug: "kisetsu-no-hanashi", description: "二十四節気や季節にまつわるお茶の話題" },
  { title: "生産者の話", slug: "seisansha-no-hanashi", description: "茶農家や生産者のストーリー" },
  { title: "お茶の知識", slug: "ocha-no-chishiki", description: "お茶の科学・分類・歴史に関する知識" },
];

// ─── New tags ─────────────────────────────────────────────────
const newTags = [
  { title: "烏龍茶", slug: "oolong" },
  { title: "抹茶スイーツ", slug: "matcha-sweets" },
  { title: "焙煎", slug: "baisen" },
  { title: "有機栽培", slug: "organic" },
  { title: "カテキン", slug: "catechin" },
  { title: "茶会", slug: "chakai" },
  { title: "季節", slug: "kisetsu" },
];

// ─── New posts (11 missing from original migration) ──────────
const newPosts = [
  {
    title: "烏龍茶で煮る豚角煮 —— お茶を料理に活かす",
    slug: "oolong-tea-braised-pork",
    category: "recipe",
    author: null,
    tags: ["烏龍茶", "レシピ"],
    publishedAt: "2026-02-15",
    excerpt: "お茶は飲むだけでなく料理にも使える万能素材。烏龍茶で煮る豚角煮のレシピを紹介。",
  },
  {
    title: "冬至と温かいお茶 —— 体を温める一杯",
    slug: "winter-solstice-warm-tea",
    category: "kisetsu-no-hanashi",
    author: null,
    tags: ["季節", "ほうじ茶"],
    publishedAt: "2026-02-15",
    excerpt: "一年で最も夜が長い冬至。温かいお茶が恵み深く感じられる季節。体を温めるお茶の楽しみ方。",
  },
  {
    title: "女性茶農家の視点 —— お茶とジェンダー",
    slug: "women-tea-farmers-perspective",
    category: "seisansha-no-hanashi",
    author: null,
    tags: ["農家", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "かつては男性中心だった茶業界に新しい風が吹いている。女性ならではの視点と未来への展望。",
  },
  {
    title: "焙煎の秘密 —— ほうじ茶はなぜ香ばしいのか",
    slug: "roasting-secret-hojicha",
    category: "ocha-no-chishiki",
    author: "setaka-on",
    tags: ["ほうじ茶", "焙煎"],
    publishedAt: "2026-02-15",
    excerpt: "200℃前後で焙じることでメイラード反応が起き香ばしさが生まれる。焙煎の科学とほうじ茶の秘密。",
  },
  {
    title: "抹茶のティラミス —— 和と洋の出会い",
    slug: "matcha-tiramisu-recipe",
    category: "recipe",
    author: null,
    tags: ["抹茶", "レシピ", "抹茶スイーツ"],
    publishedAt: "2026-02-15",
    excerpt: "抹茶とマスカルポーネチーズが出会う、和と洋の融合スイーツ。自宅で作れるレシピを紹介。",
  },
  {
    title: "秋の茶会 —— 紅葉と共にいただく抹茶",
    slug: "autumn-tea-ceremony-matcha",
    category: "kisetsu-no-hanashi",
    author: "setaka-on",
    tags: ["抹茶", "茶会", "季節"],
    publishedAt: "2026-02-15",
    excerpt: "紅葉の下でいただく抹茶。自然の中での茶会は特別な体験。秋のお茶時間を紹介。",
  },
  {
    title: "茶畑の四季 —— 収穫から製茶までの365日",
    slug: "four-seasons-tea-farm",
    category: "seisansha-no-hanashi",
    author: null,
    tags: ["農家", "産地", "季節"],
    publishedAt: "2026-02-15",
    excerpt: "茶畑で繰り返される四季折々の営み。新芽の萌える春から冬の準備まで、一年を追う。",
  },
  {
    title: "カテキンの科学 —— お茶の健康効果を知る",
    slug: "catechin-science-health-benefits",
    category: "ocha-no-chishiki",
    author: null,
    tags: ["日本茶", "カテキン"],
    publishedAt: "2026-02-15",
    excerpt: "緑茶に豊富に含まれるポリフェノール・カテキン。科学が証明するお茶の健康効果を紹介。",
  },
  {
    title: "立春と新茶 —— 二十四節気で味わう日本茶",
    slug: "risshun-shincha-seasons",
    category: "kisetsu-no-hanashi",
    author: null,
    tags: ["日本茶", "季節"],
    publishedAt: "2026-02-15",
    excerpt: "暦の上では春が始まる立春。八十八夜と新茶の関係、節気ごとのお茶の楽しみ方。",
  },
  {
    title: "三代続く茶農家の挑戦 —— 有機栽培への転換",
    slug: "organic-tea-farming-challenge",
    category: "seisansha-no-hanashi",
    author: null,
    tags: ["農家", "有機栽培", "日本茶"],
    publishedAt: "2026-02-15",
    excerpt: "家業の茶園を継いだ若き農家が有機栽培に挑戦。化学肥料からの脱却と循環型農業の未来。",
  },
  {
    title: "日本茶の六大分類 —— 緑茶・紅茶・烏龍茶の違い",
    slug: "six-types-of-japanese-tea",
    category: "ocha-no-chishiki",
    author: null,
    tags: ["日本茶", "煎茶", "紅茶", "烏龍茶"],
    publishedAt: "2026-02-15",
    excerpt: "緑茶も紅茶もウーロン茶も同じ植物から。発酵度合いによる六大分類とそれぞれの味わい。",
  },
];

// ─── Body content scraped from Webflow (all 30 posts) ────────
const bodyData: Record<string, { body: BodyElement[]; cta: { text: string; url: string } | null }> = {
  "wazuka-tea-fields-kyoto": {
    body: [
      { type: "h2", text: "和束町とは" },
      { type: "p", text: "京都府の南端に位置する和束町。" },
    ],
    cta: { text: "和束町のお茶を味わう", url: "https://shop.elxea.jp/collections/wazuka" },
  },
  "ceramist-teapot-interview": {
    body: [
      { type: "h2", text: "常滑焼の急須" },
      { type: "p", text: "愛知県常滑市は急須の産地として有名。" },
      { type: "h2", text: "手仕事の価値" },
      { type: "p", text: "陶芸家・鈴木謙一さんは一つ一つ手びきで急須を作る。" },
      { type: "h2", text: "急須が味を変える" },
      { type: "p", text: "良い急須で淹れたお茶は確かに味が違う。" },
    ],
    cta: { text: "職人の急須を見る", url: "https://shop.elxea.jp/collections/teaware" },
  },
  "luxury-of-tea-time-slow-life": {
    body: [
      { type: "h2", text: "立ち止まる時間" },
      { type: "p", text: "スマホを置き、湯を沸かし、茶葉の香りを楽しむ。" },
      { type: "h2", text: "お茶が教えてくれること" },
      { type: "p", text: "蒸らし時間を待つ間、心が静かになる。" },
      { type: "h2", text: "毎日の小さな儀式" },
      { type: "p", text: "朝の一杯、午後の休憩、夜のリラックスタイム。" },
    ],
    cta: { text: "日常のお茶を探す", url: "https://shop.elxea.jp/collections/everyday" },
  },
  "wagashi-tea-pairing": {
    body: [
      { type: "h2", text: "和菓子とお茶の関係" },
      { type: "p", text: "甘さがお茶の苦みを引き立てる。" },
      { type: "h2", text: "季節別ペアリング" },
      { type: "p", text: "春は桜餅と新茶、夏は水羊羹と水出し煎茶。" },
      { type: "h2", text: "自宅での楽しみ方" },
      { type: "p", text: "近所の和菓子屋で季節の生菓子を買い、急須で淹れたお茶と合わせる。" },
    ],
    cta: { text: "お茶と和菓子セットを見る", url: "https://shop.elxea.jp/collections/gift-set" },
  },
  "hojicha-latte-recipe": {
    body: [
      { type: "h2", text: "材料（1杯分）" },
      { type: "p", text: "ほうじ茶大さじ2、熱湯100ml、牛乳150ml。" },
      { type: "h2", text: "作り方" },
      { type: "p", text: "ほうじ茶を濃いめに淹れ、温めた牛乳を泡立てて加える。" },
      { type: "h2", text: "アレンジのコツ" },
      { type: "p", text: "夏はアイスで。オーツミルクを使えばナッティな風味も。" },
    ],
    cta: { text: "ほうじ茶を購入する", url: "https://shop.elxea.jp/products/hojicha" },
  },
  "cold-brew-green-tea-summer": {
    body: [
      { type: "h2", text: "水出し緑茶の魅力" },
      { type: "p", text: "茶葉を冷水に浸して4〜8時間抽出。カテキンの苦味が抑えられ、甘みと旨みが引き出される。" },
      { type: "h2", text: "簡単な作り方" },
      { type: "p", text: "茶葉10g、水1リットル、冷蔵庫。" },
      { type: "h2", text: "おすすめの茶葉" },
      { type: "p", text: "深蒸し煎茶や玉露がおすすめ。" },
    ],
    cta: { text: "水出し用の茶葉を探す", url: "https://shop.elxea.jp/collections/cold-brew" },
  },
  "producer-interview-tsushima-oishi-farm": {
    body: [
      { type: "h2", text: "農園の紹介" },
      { type: "p", text: "つしま大石農園は自然豊かな環境の中で多様な作物を栽培。持続可能な農業を実践。" },
      { type: "h2", text: "生産者の背景" },
      { type: "p", text: "大石さんは幼少期から農業に親しみ、大学で農学を学んだ。" },
      { type: "h2", text: "持続可能な農業の取り組み" },
      { type: "p", text: "有機農法を導入し、土壌の健康を保ちながら安全な作物を育てている。" },
    ],
    cta: { text: "つしま大石農園のお茶を見る", url: "https://shop.elxea.jp/collections/producers" },
  },
  "architect-designs-tea-room": {
    body: [
      { type: "h2", text: "現代の茶室" },
      { type: "p", text: "建築家・佐藤美紀さんが設計した茶室は伝統と現代が融合する空間。" },
      { type: "h2", text: "空間が味わいを変える" },
      { type: "p", text: "同じお茶でも飲む空間によって味が変わる。" },
      { type: "h2", text: "自宅での工夫" },
      { type: "p", text: "小さな花を一輪、お気に入りの器、静かな音楽。" },
    ],
    cta: { text: "お茶の空間を作る", url: "https://shop.elxea.jp/collections/teaware" },
  },
  "interview-tea-master-yamada": {
    body: [
      { type: "h2", text: "茶師という仕事" },
      { type: "p", text: "お茶の品質を見極めブレンドを行う専門家。" },
      { type: "h2", text: "良いお茶の条件" },
      { type: "p", text: "「飲んだ人がほっとするかどうか」" },
      { type: "h2", text: "次世代へのメッセージ" },
      { type: "p", text: "「若い人にもっとお茶を飲んでほしい」" },
    ],
    cta: { text: "茶師厳選のお茶を見る", url: "https://shop.elxea.jp/collections/curated" },
  },
  "ocha-to-mindfulness": {
    body: [
      { type: "h2", text: "お茶を淹れる時間の重要性" },
      { type: "p", text: "お茶を淹れる行為は心を整え日常の喧騒から離れるための大切な儀式。" },
      { type: "h2", text: "マインドフルネスとは" },
      { type: "p", text: "今この瞬間に意識を集中させること。お茶を淹れる時間はその絶好の機会。" },
      { type: "h2", text: "お茶を楽しむ瞬間" },
      { type: "p", text: "一口ごとに香りや味の変化を感じる。心を静め味わいを楽しむ。" },
    ],
    cta: { text: "毎日のお茶を探す", url: "https://shop.elxea.jp/collections/everyday" },
  },
  "tea-cultures-around-the-world": {
    body: [
      { type: "h2", text: "英国のアフタヌーンティー" },
      { type: "p", text: "ロンドンのティールームでいただくアフタヌーンティー。" },
      { type: "h2", text: "中国の工夫茶" },
      { type: "p", text: "福建省で出会った工夫茶。小さな茶器で丁寧に淹れる烏龍茶。" },
      { type: "h2", text: "モロッコのミントティー" },
      { type: "p", text: "マラケシュのスークでいただいた甘いミントティー。" },
    ],
    cta: { text: "世界のお茶を探す", url: "https://shop.elxea.jp/collections/all" },
  },
  "tea-and-ambient-music": {
    body: [
      { type: "h2", text: "お茶と静寂" },
      { type: "p", text: "お茶を淹れる行為には独特のリズムがある。" },
      { type: "h2", text: "アンビエントミュージックとの親和性" },
      { type: "p", text: "環境の一部として存在する音楽。" },
      { type: "h2", text: "おすすめの組み合わせ" },
      { type: "p", text: "深蒸し煎茶には坂本龍一、玉露にはハロルド・バッド。" },
    ],
    cta: null,
  },
  "natsu-no-aisutii-no-irikata": {
    body: [
      { type: "h2", text: "アイスティーの基本" },
      { type: "p", text: "熱いお茶を冷やして楽しむ飲み物。茶葉の選び方が重要。" },
      { type: "h2", text: "おすすめの茶葉" },
      { type: "p", text: "緑茶はさわやかな香りと軽やかな味わい。紅茶はしっかりとした味わい。" },
      { type: "h2", text: "アイスティーの淹れ方" },
      { type: "p", text: "茶葉を準備し、適温のお湯で抽出後、氷を入れたグラスに注ぐ。" },
    ],
    cta: { text: "アイスティー向け茶葉を見る", url: "https://shop.elxea.jp/collections/cold-brew" },
  },
  "black-tea-pairing-sweets": {
    body: [
      { type: "h2", text: "紅茶の基本的な特性" },
      { type: "p", text: "紅茶は発酵させた茶葉から作られ、深い色合いと豊かな風味を持つ。" },
      { type: "h2", text: "elxeaの紅茶とスイーツ" },
      { type: "p", text: "アールグレイとシフォンケーキ、ダージリンとマカロン、セイロンとチョコレートケーキ。" },
      { type: "h2", text: "ペアリングの楽しみ方" },
      { type: "p", text: "紅茶を一口飲んで香りや味わいを楽しんだ後にスイーツを味わう。" },
    ],
    cta: { text: "紅茶コレクションを見る", url: "https://shop.elxea.jp/collections/black-tea" },
  },
  "tea-gift-guide": {
    body: [
      { type: "h2", text: "お茶を贈るということ" },
      { type: "p", text: "お茶のギフトは「心と体をいたわってください」というメッセージ。" },
      { type: "h2", text: "シーン別おすすめ" },
      { type: "p", text: "誕生日には特別な単一品種、お正月には縁起の良い新茶。" },
      { type: "h2", text: "パッケージの大切さ" },
      { type: "p", text: "美しい箱と丁寧な包装が贈る喜びを一層引き立てる。" },
    ],
    cta: { text: "ギフトセットを見る", url: "https://shop.elxea.jp/collections/gift" },
  },
  "haru-no-tozure-o-tsugeru-chabatake-no-fukei": {
    body: [
      { type: "h2", text: "茶畑の芽吹き" },
      { type: "p", text: "春の茶畑では茶の新芽が次々と顔を出す。朝日が照らす中、茶の葉がキラキラと輝く。" },
      { type: "h2", text: "産地の空気感" },
      { type: "p", text: "清らかな水と豊かな土壌が茶葉を育てるための理想的な環境を提供する。" },
      { type: "h2", text: "春の茶畑を訪れる" },
      { type: "p", text: "自然の美しさと人々の営みを感じることができる。" },
    ],
    cta: { text: "春のお茶を探す", url: "https://shop.elxea.jp/collections/seasonal" },
  },
  "winter-kyoto-wazuka-tea-fields": {
    body: [
      { type: "h2", text: "霧に包まれた茶畑" },
      { type: "p", text: "朝の霧が立ち込める中、茶畑はまるで別世界のよう。白い霧が茶葉の上に降りかかる。" },
      { type: "h2", text: "冬の寒さと茶葉の力強さ" },
      { type: "p", text: "寒風が吹き抜けるこの季節、茶葉は厳しい環境に耐えながら力強さを増す。" },
      { type: "h2", text: "産地の空気感" },
      { type: "p", text: "新鮮な茶葉の香りが漂い、自然の中で育った茶が持つ力を感じる。" },
    ],
    cta: { text: "和束のお茶を味わう", url: "https://shop.elxea.jp/collections/wazuka" },
  },
  "chiran-kagoshima-fukamushi": {
    body: [
      { type: "h2", text: "知覧とは" },
      { type: "p", text: "日本有数の茶産地。温暖な気候と火山灰の土壌が特徴。" },
      { type: "h2", text: "深蒸し茶の産地" },
      { type: "p", text: "濃い緑色とまろやかな味わいが特徴。" },
      { type: "h2", text: "武家屋敷の町並み" },
      { type: "p", text: "知覧には武家屋敷の美しい町並みが残る。" },
    ],
    cta: { text: "鹿児島茶を探す", url: "https://shop.elxea.jp/collections/kagoshima" },
  },
  "makinohara-shizuoka-tea-region": {
    body: [
      { type: "h2", text: "牧之原台地の茶畑" },
      { type: "p", text: "日本最大級の茶産地。明治期に士族が開拓した歴史を持つ。" },
      { type: "h2", text: "深蒸し製法の誕生" },
      { type: "p", text: "通常より長く蒸すことで、まろやかでコクのある味わい。" },
      { type: "h2", text: "茶畑見学の楽しみ" },
      { type: "p", text: "茶畑見学ツアーや茶摘み体験ができる。" },
    ],
    cta: { text: "静岡茶を探す", url: "https://shop.elxea.jp/collections/shizuoka" },
  },
  "oolong-tea-braised-pork": {
    body: [
      { type: "h2", text: "お茶で料理" },
      { type: "p", text: "お茶は飲むだけでなく料理にも使える。" },
      { type: "h2", text: "材料と作り方" },
      { type: "p", text: "豚バラ肉500g、烏龍茶大さじ4、醤油、みりん、生姜。" },
      { type: "h2", text: "その他のお茶料理" },
      { type: "p", text: "緑茶塩、ほうじ茶プリン、抹茶アイスなど。" },
    ],
    cta: { text: "烏龍茶を購入する", url: "https://shop.elxea.jp/products/oolong" },
  },
  "winter-solstice-warm-tea": {
    body: [
      { type: "h2", text: "冬至とお茶" },
      { type: "p", text: "一年で最も夜が長い冬至。温かいお茶が恵み深く感じられる季節。" },
      { type: "h2", text: "体を温めるお茶" },
      { type: "p", text: "ほうじ茶や玉露、和紅茶など冬に合うお茶は多い。" },
      { type: "h2", text: "冬の夜長のお供" },
      { type: "p", text: "温かいお茶と本。冬の夜長を豊かに過ごす最高の過ごし方。" },
    ],
    cta: { text: "冬のお茶を探す", url: "https://shop.elxea.jp/collections/winter" },
  },
  "women-tea-farmers-perspective": {
    body: [
      { type: "h2", text: "変わりゆく茶業界" },
      { type: "p", text: "かつては男性中心だった茶業界に新しい風が吹いている。" },
      { type: "h2", text: "女性ならではの視点" },
      { type: "p", text: "きめ細かな味覚と美意識。新鮮なアプローチが生まれている。" },
      { type: "h2", text: "未来への展望" },
      { type: "p", text: "多様な視点が入ることで、お茶の世界はもっと豊かになる。" },
    ],
    cta: { text: "生産者のお茶を見る", url: "https://shop.elxea.jp/collections/producers" },
  },
  "roasting-secret-hojicha": {
    body: [
      { type: "h2", text: "焙煎とは" },
      { type: "p", text: "200℃前後で焙じることでメイラード反応が起き香ばしさが生まれる。" },
      { type: "h2", text: "カフェインが減る理由" },
      { type: "p", text: "焙煎によってカフェインが減少。" },
      { type: "h2", text: "焙煎度の違い" },
      { type: "p", text: "浅焙りは茶葉の風味が残り、深焙りは香ばしさが強まる。" },
    ],
    cta: { text: "焙煎したてのほうじ茶", url: "https://shop.elxea.jp/products/hojicha" },
  },
  "matcha-tiramisu-recipe": {
    body: [
      { type: "h2", text: "材料" },
      { type: "p", text: "抹茶大さじ3、マスカルポーネチーズ250g、生クリーム200ml。" },
      { type: "h2", text: "作り方" },
      { type: "p", text: "抹茶を湯で溶かし、ビスケットに浸す。クリームを交互に重ねる。" },
      { type: "h2", text: "アレンジ" },
      { type: "p", text: "仕上げに抹茶を振い、黒豆をトッピングに。" },
    ],
    cta: { text: "抹茶を購入する", url: "https://shop.elxea.jp/products/matcha" },
  },
  "autumn-tea-ceremony-matcha": {
    body: [
      { type: "h2", text: "秋の野点" },
      { type: "p", text: "紅葉の下でいただく抹茶。自然の中での茶会は特別な体験。" },
      { type: "h2", text: "抹茶の味わい" },
      { type: "p", text: "秋の冷たい空気の中で飲む抹茶は温かさが一層身に染みる。" },
      { type: "h2", text: "自宅で楽しむ秋のお茶" },
      { type: "p", text: "紅葉を眺めながら、自宅の縁側で抹茶を点てる。" },
    ],
    cta: { text: "抹茶を購入する", url: "https://shop.elxea.jp/products/matcha" },
  },
  "four-seasons-tea-farm": {
    body: [
      { type: "h2", text: "春——新芽の季節" },
      { type: "p", text: "4月、茶の木が新芽を吹く。" },
      { type: "h2", text: "夏——二番茶と整備" },
      { type: "p", text: "夏には二番茶の摘採と茶畑の整備。" },
      { type: "h2", text: "秋・冬——休息と準備" },
      { type: "p", text: "秋には肥料を与え、冬には防霜対策。" },
    ],
    cta: { text: "産地直送のお茶を見る", url: "https://shop.elxea.jp/collections/direct" },
  },
  "catechin-science-health-benefits": {
    body: [
      { type: "h2", text: "カテキンとは" },
      { type: "p", text: "緑茶に特に豊富に含まれるポリフェノールの一種。" },
      { type: "h2", text: "科学が証明する効果" },
      { type: "p", text: "免疫力の向上、代謝の促進、血圧の安定化。" },
      { type: "h2", text: "効果的な飲み方" },
      { type: "p", text: "70℃前後の湯で淹れることでバランスの良い抽出。" },
    ],
    cta: { text: "健康的なお茶生活を始める", url: "https://shop.elxea.jp/collections/all" },
  },
  "risshun-shincha-seasons": {
    body: [
      { type: "h2", text: "立春——春の始まり" },
      { type: "p", text: "2月4日頃、暦の上では春が始まる。" },
      { type: "h2", text: "八十八夜と新茶" },
      { type: "p", text: "立春から数えて88日目。" },
      { type: "h2", text: "節気ごとのお茶" },
      { type: "p", text: "春には新茶、夏には水出し。" },
    ],
    cta: { text: "季節のお茶セットを見る", url: "https://shop.elxea.jp/collections/seasonal" },
  },
  "organic-tea-farming-challenge": {
    body: [
      { type: "h2", text: "祖父の茶畑を受け継いで" },
      { type: "p", text: "田中健太さんが家業の茶園を継いだのは5年前。" },
      { type: "h2", text: "有機栽培への決断" },
      { type: "p", text: "化学肥料に依存し続けた土壌は、微生物の多様性を失いつつあった。" },
      { type: "h2", text: "循環型農業の未来" },
      { type: "p", text: "落ち葉堆肥や米ぬかを使った自然農法を実践中。" },
    ],
    cta: { text: "有機栽培茶を購入する", url: "https://shop.elxea.jp/collections/organic" },
  },
  "six-types-of-japanese-tea": {
    body: [
      { type: "h2", text: "お茶はすべて同じ植物から" },
      { type: "p", text: "緑茶も紅茶もウーロン茶も、すべて「カメリア・シネンシス」という植物の葉から作られている。" },
      { type: "h2", text: "六大分類とは" },
      { type: "p", text: "発酵度合いによって大きく六つに分類される。" },
      { type: "h2", text: "味わいの違いを楽しむ" },
      { type: "p", text: "それぞれの分類には固有の香り、味わい、色がある。" },
    ],
    cta: { text: "お茶の基本セットを見る", url: "https://shop.elxea.jp/collections/basics" },
  },
};

// ─── Existing category/tag mappings ───────────────────────────
const allCategoryRefs: Record<string, string> = {
  "sanchi-shokai": "category-sanchi-shokai",
  "interview": "category-interview",
  "column": "category-column",
  "tanoshimikata": "category-tanoshimikata",
  "recipe": "category-recipe",
};

const allTagRefs: Record<string, string> = {
  "日本茶": "tag-nihoncha",
  "煎茶": "tag-sencha",
  "ほうじ茶": "tag-hojicha",
  "抹茶": "tag-matcha",
  "紅茶": "tag-kocha",
  "玉露": "tag-gyokuro",
  "和束": "tag-wazuka",
  "京都": "tag-kyoto",
  "静岡": "tag-shizuoka",
  "鹿児島": "tag-kagoshima",
  "対馬": "tag-tsushima",
  "産地": "tag-sanchi",
  "農家": "tag-nouka",
  "レシピ": "tag-recipe",
  "ペアリング": "tag-pairing",
  "和菓子": "tag-wagashi",
  "マインドフルネス": "tag-mindfulness",
  "音楽": "tag-music",
  "ギフト": "tag-gift",
  "スローライフ": "tag-slow-life",
};

// ─── Migration logic ─────────────────────────────────────────

async function migrate() {
  console.log(`Updating Sanity project: ${projectId} / ${dataset}`);
  console.log("---");

  // 1. Create new categories
  console.log("Creating new categories...");
  for (const cat of newCategories) {
    const id = `category-${cat.slug}`;
    await client.createOrReplace({
      _id: id,
      _type: "category",
      title: cat.title,
      slug: { _type: "slug", current: cat.slug },
      description: cat.description,
    });
    allCategoryRefs[cat.slug] = id;
    console.log(`  + ${cat.title}`);
  }

  // 2. Create new tags
  console.log("\nCreating new tags...");
  for (const tag of newTags) {
    const id = `tag-${tag.slug}`;
    await client.createOrReplace({
      _id: id,
      _type: "tag",
      title: tag.title,
      slug: { _type: "slug", current: tag.slug },
    });
    allTagRefs[tag.title] = id;
    console.log(`  + ${tag.title}`);
  }

  // 3. Create new posts (11 missing ones)
  console.log("\nCreating missing posts...");
  for (const post of newPosts) {
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
        _ref: allCategoryRefs[post.category],
      },
      tags: post.tags.map((tag) => ({
        _type: "reference",
        _ref: allTagRefs[tag],
        _key: allTagRefs[tag],
      })),
    };

    if (post.author) {
      doc.author = {
        _type: "reference",
        _ref: `author-${post.author}`,
      };
    }

    // Add body content
    const bd = bodyData[post.slug];
    if (bd) {
      doc.body = toPortableText(bd.body);
      if (bd.cta) {
        doc.cta = {
          title: bd.cta.text,
          url: bd.cta.url,
        };
      }
    }

    await client.createOrReplace(doc);
    console.log(`  + ${post.title}`);
  }

  // 4. Update ALL 30 posts with body content (including existing 19)
  console.log("\nUpdating body content for all posts...");
  const allSlugs = Object.keys(bodyData);
  let updated = 0;

  for (const slug of allSlugs) {
    const id = `article-${slug}`;
    const bd = bodyData[slug];

    const patch: Record<string, unknown> = {
      body: toPortableText(bd.body),
    };

    if (bd.cta) {
      patch.cta = {
        title: bd.cta.text,
        url: bd.cta.url,
      };
    }

    try {
      await client.patch(id).set(patch).commit();
      updated++;
      console.log(`  ✓ ${slug}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${slug}: ${message}`);
    }
  }

  console.log("\n---");
  console.log("Migration update complete!");
  console.log(`  New categories: ${newCategories.length}`);
  console.log(`  New tags: ${newTags.length}`);
  console.log(`  New posts: ${newPosts.length}`);
  console.log(`  Body content updated: ${updated}/${allSlugs.length}`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

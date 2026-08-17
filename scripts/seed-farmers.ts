/**
 * Seed farmer profile data into Sanity for development/preview.
 * Run with: npx tsx scripts/seed-farmers.ts
 *
 * Creates 3 farmer profiles inspired by elxea's brand world:
 * - Single origin tea, small-scale artisan farmers
 * - Fictional profiles (no real personal data)
 * - Brand tone: terroir, craftsmanship, sustainability, one-of-a-kind encounter
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveWriteDatasetOrExit } from "../lib/sanity/write-target";

// Load env vars
const envPath = join(process.cwd(), ".env");
let env: Record<string, string> = {};
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
} catch {
  // .env may not exist in CI; fall back to process.env
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
  scriptName: "scripts/seed-farmers.ts",
  env: { ...process.env, ...env },
});

const client = createClient({
  projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID || "5s8ahx87",
  dataset,
  apiVersion: "2024-12-01",
  useCdn: false,
  token: authToken,
});

// ─── Helpers ─────────────────────────────────────────────────────────

function block(text: string, style: string = "normal") {
  return {
    _type: "block",
    _key: crypto.randomUUID().slice(0, 8),
    style,
    children: [
      {
        _type: "span",
        _key: crypto.randomUUID().slice(0, 8),
        text,
        marks: [],
      },
    ],
    markDefs: [],
  };
}

function blocks(...paragraphs: string[]) {
  return paragraphs.map((p) => block(p));
}

// ─── Farmer Data ─────────────────────────────────────────────────────
//
// Brand tone reference (About elxea):
//  - "一杯を通じた一期一会の出会い" — each cup is a once-in-a-lifetime encounter
//  - "テロワール" — terroir: soil, climate, culture bound in one leaf
//  - "情熱をもってものづくりに励む小規模農家さんの活動をサポート"
//  - Sustainability, traceability, fair trade with local producers
//
// All farmers are fictional. Names, farms, and locations are inspired by
// real tea-producing regions but do not refer to any actual individuals.

const farmers = [
  // ── Farmer 1: Japanese sencha — Kagoshima ──────────────────────────
  {
    _id: "farmer-aoyama-shuichi",
    _type: "farmer",
    name: "青山 修一",
    slug: { _type: "slug", current: "aoyama-shuichi" },
    region: "鹿児島・知覧",
    country: "日本",
    bio: blocks(
      "知覧の急峻な山あいに広がる茶園を、三代にわたって守り続けてきた青山家。" +
        "修一さんはその三代目として、先代から受け継いだ有機栽培の哲学を軸に、" +
        "土の声に耳を澄ませながら茶葉を育てています。",
      "「農薬を使わないことで土が生きる。土が生きることで、葉が本来の甘みを持つようになる。」" +
        "そう語る修一さんの茶園では、周辺の山から流れ込む霧が茶葉に自然なうま味を与えます。" +
        "収穫は手摘みにこだわり、一芯二葉のみを厳選。",
      "知覧の澄み渡った空気と豊かな火山性土壌が育む煎茶は、" +
        "鮮やかな翠緑と清澄な甘みが特徴。一杯に産地の記憶が宿ります。"
    ),
    relatedProducts: ["chiran-sencha-organic"],
    language: "ja",
    seo: {
      _type: "seo",
      metaTitle: "青山 修一 | 知覧・有機煎茶農家",
      metaDescription:
        "鹿児島・知覧で三代続く有機茶農家。土の声に耳を澄ませ、手摘み煎茶を育てる青山修一さんのストーリー。",
    },
  },

  // ── Farmer 2: Taiwanese oolong — Alishan ──────────────────────────
  {
    _id: "farmer-chen-yufen",
    _type: "farmer",
    name: "陳 玉芬 (Chen Yu-Fen)",
    slug: { _type: "slug", current: "chen-yufen" },
    region: "阿里山 (Alishan)",
    country: "台湾",
    bio: blocks(
      "標高1,400メートルを超える阿里山の茶園で、陳玉芬さんは朝霧の中に生きています。" +
        "彼女の家族が営む小さな農園は、急勾配の山肌に広がる段々畑。" +
        "雲が流れ込む時間帯に収穫することで、葉に凝縮した花のような香りが生まれます。",
      "「高山のお茶は急ぐことができない。自然のリズムに合わせることが、すべての始まりです。」" +
        "玉芬さんは年に二回だけ収穫し、その後の萎凋・揺青・焙煎を全て手作業で行います。" +
        "一つひとつの工程に込められた時間が、複雑で奥深い香味を生み出します。",
      "阿里山のテロワールが宿る高山烏龍茶は、" +
        "乳白色の水色と白桃を思わせる甘い香りが特徴。" +
        "elxea が世界を旅して出会った、まさに「一期一会」の一杯です。"
    ),
    relatedProducts: ["alishan-oolong-high-mountain"],
    language: "ja",
    seo: {
      _type: "seo",
      metaTitle: "陳 玉芬 | 阿里山・高山烏龍茶農家",
      metaDescription:
        "標高1,400m超の阿里山で二毛作の高山烏龍を手作りする陳玉芬さん。自然のリズムに寄り添うクラフト農家のストーリー。",
    },
  },

  // ── Farmer 3: Indian first flush — Darjeeling ─────────────────────
  {
    _id: "farmer-rajan-mehta",
    _type: "farmer",
    name: "ラジャン・メータ (Rajan Mehta)",
    slug: { _type: "slug", current: "rajan-mehta" },
    region: "ダージリン・クルセオン",
    country: "インド",
    bio: blocks(
      "ヒマラヤの山裾に位置するクルセオン地区の小さな農園で、" +
        "ラジャンさんは「ファーストフラッシュ」と呼ばれる春の新芽だけを摘み続けています。" +
        "3月下旬から4月にかけての短い収穫期に、山肌を駆け回る彼の姿は茶摘み職人そのものです。",
      "「ダージリンの春は一瞬です。その一瞬に賭けることが、私たちの仕事です。」" +
        "標高1,800メートルの茶園では、朝晩の冷え込みと昼間の強い日差しが葉に複雑な個性を与えます。" +
        "農薬や化学肥料を使わず、牛糞と堆肥だけで土を育てるラジャンさんのポリシーは、" +
        "先代から変わらない哲学です。",
      "マスカテルフレーバーと呼ばれるぶどうのような芳香と、" +
        "やわらかな渋みのバランスが絶妙なファーストフラッシュ。" +
        "ヒマラヤの風と土が刻んだ、唯一無二のシングルオリジン。"
    ),
    relatedProducts: ["darjeeling-first-flush-organic"],
    language: "ja",
    seo: {
      _type: "seo",
      metaTitle: "ラジャン・メータ | ダージリン・ファーストフラッシュ農家",
      metaDescription:
        "ヒマラヤ山麓クルセオンで春の新芽だけを手摘みするラジャン・メータさん。無農薬ダージリン・ファーストフラッシュの作り手。",
    },
  },
];

// ─── Upsert ───────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${farmers.length} farmer profiles to Sanity (${client.config().dataset})...`);

  for (const farmer of farmers) {
    const existing = await client.fetch(`*[_id == $id][0]._id`, { id: farmer._id });
    if (existing) {
      console.log(`  SKIP (already exists): ${farmer.name}`);
      continue;
    }
    await client.create(farmer);
    console.log(`  CREATED: ${farmer.name} (${farmer.region})`);
  }

  console.log("\nDone. Farmer profiles are live in Sanity Studio.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

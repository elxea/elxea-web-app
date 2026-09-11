/**
 * Tag articles with persona/personalization fields in Sanity
 * Run with: pnpm tsx scripts/tag-articles.ts --dataset <name>
 * Dry run:   pnpm tsx scripts/tag-articles.ts --dataset <name> --dry-run
 *
 * There is no default dataset. `--dry-run` is opt-in, so a bare invocation used
 * to patch the live dataset; the target must now be named explicitly and
 * production additionally requires --i-know-this-is-production
 * (see lib/sanity/write-target.ts).
 *
 * Sets contentPersona, targetLayer, depthLevel for existing articles.
 * Assignment rationale: based on article tone, topic, and audience affinity.
 *
 * Coverage targets:
 *   - serenity:  relax, mindfulness, slow life, seasonal aesthetic
 *   - explorer:  origin, farmer stories, terroir, production methods
 *   - sensory:   recipes, pairing, tasting, brewing techniques
 *   - tea_lover / wellbeing / gourmet layers distributed across all personas
 */

import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

import { resolveWriteDatasetOrExit } from "../lib/sanity/write-target";

// ─── Config ──────────────────────────────────────────────────

const SANITY_PROJECT_ID = "5s8ahx87";

// Fail-closed: resolved before any client is built and before any credential is
// read. Exits non-zero (writing nothing) when the target is unnamed, or when it
// is production without the explicit confirmation flag.
const SANITY_DATASET = resolveWriteDatasetOrExit({
  scriptName: "scripts/tag-articles.ts",
});

const sanityConfigPath = join(
  process.env.HOME || "",
  ".config/sanity/config.json"
);
let sanityAuthToken = "";
try {
  const sanityConfig = JSON.parse(readFileSync(sanityConfigPath, "utf-8"));
  sanityAuthToken = sanityConfig.authToken;
} catch {
  console.error(
    "Could not read Sanity CLI config. Run `npx sanity login` first."
  );
  process.exit(1);
}

const sanity = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  apiVersion: "2024-01-01",
  useCdn: false,
  token: sanityAuthToken,
});

const isDryRun = process.argv.includes("--dry-run");

// ─── Persona tag definitions ──────────────────────────────────
//
// depthLevel values (schema):
//   "entry"   = 入口 — お茶を知り始めた人向け
//   "explore" = 探索 — 飲み比べ・品種に興味がある人向け
//   "deep"    = 没入 — 製法・産地を深く掘る人向け
//
// contentPersona values: serenity | explorer | sensory
// targetLayer values:    tea_lover | wellbeing | gourmet

type PersonaTags = {
  contentPersona: string[];
  targetLayer: string[];
  depthLevel: string;
};

const ARTICLE_TAGS: Record<string, PersonaTags> = {
  // ── serenity × wellbeing ──────────────────────────────────
  "article-mindfulness": {
    contentPersona: ["serenity"],
    targetLayer: ["wellbeing"],
    depthLevel: "entry",
  },
  "notion-tea-time-as-luxury-slow-life-practice": {
    contentPersona: ["serenity"],
    targetLayer: ["wellbeing"],
    depthLevel: "entry",
  },
  "notion-winter-solstice-warming-tea-guide": {
    contentPersona: ["serenity"],
    targetLayer: ["wellbeing"],
    depthLevel: "entry",
  },
  // ── serenity × tea_lover ─────────────────────────────────
  "notion-winter-wazuka-tea-fields": {
    contentPersona: ["serenity"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-tea-and-ambient-music-harmony": {
    contentPersona: ["serenity"],
    targetLayer: ["tea_lover"],
    depthLevel: "entry",
  },
  "notion-seasonal-japanese-tea-nijushi-sekki": {
    contentPersona: ["serenity"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-autumn-outdoor-tea-ceremony-matcha": {
    contentPersona: ["serenity"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  // ── sensory × tea_lover ───────────────────────────────────
  "article-cold-brew": {
    contentPersona: ["sensory"],
    targetLayer: ["tea_lover"],
    depthLevel: "entry",
  },
  "article-brewing-guide": {
    contentPersona: ["sensory"],
    targetLayer: ["tea_lover"],
    depthLevel: "entry",
  },
  "notion-mizudashi-green-tea-summer-afternoon": {
    contentPersona: ["sensory", "serenity"],
    targetLayer: ["tea_lover"],
    depthLevel: "entry",
  },
  // ── sensory × wellbeing ───────────────────────────────────
  "notion-homemade-hojicha-latte-recipe-guide": {
    contentPersona: ["sensory"],
    targetLayer: ["wellbeing"],
    depthLevel: "entry",
  },
  // ── sensory × gourmet ─────────────────────────────────────
  "notion-japanese-sweets-tea-pairing-seasonal": {
    contentPersona: ["sensory"],
    targetLayer: ["gourmet"],
    depthLevel: "explore",
  },
  "notion-oolong-tea-braised-pork-belly-recipe": {
    contentPersona: ["sensory"],
    targetLayer: ["gourmet"],
    depthLevel: "explore",
  },
  "notion-matcha-tiramisu-east-meets-west-dessert": {
    contentPersona: ["sensory"],
    targetLayer: ["gourmet"],
    depthLevel: "entry",
  },
  "notion-tea-gift-guide-for-special-people": {
    contentPersona: ["sensory"],
    targetLayer: ["gourmet"],
    depthLevel: "entry",
  },
  "article-matcha-latte": {
    contentPersona: ["sensory"],
    targetLayer: ["gourmet"],
    depthLevel: "entry",
  },
  // ── explorer × tea_lover ──────────────────────────────────
  "notion-tea-culture-around-the-world": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-tea-journey-single-origin-terroir": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "article-farmer-story": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-tsushima-oishi-farm-interview": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-three-generation-tea-farmer-organic-conversion-challenge": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "deep",
  },
  "notion-makinohara-tea-region-shizuoka": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "deep",
  },
  "notion-wazuka-tea-fields-walk-kyoto": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-chiran-fukamushi-tea-kagoshima": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "deep",
  },
  "notion-women-tea-farmers-perspective-gender": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-tea-fields-four-seasons-365days": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "explore",
  },
  "notion-uji-tea-master-good-tea-quality": {
    contentPersona: ["explorer"],
    targetLayer: ["tea_lover"],
    depthLevel: "deep",
  },
};

// ─── Coverage summary ─────────────────────────────────────────

function printCoverageSummary() {
  const personaCounts: Record<string, number> = {};
  const layerCounts: Record<string, number> = {};
  const depthCounts: Record<string, number> = {};

  for (const tags of Object.values(ARTICLE_TAGS)) {
    for (const p of tags.contentPersona) {
      personaCounts[p] = (personaCounts[p] || 0) + 1;
    }
    for (const l of tags.targetLayer) {
      layerCounts[l] = (layerCounts[l] || 0) + 1;
    }
    depthCounts[tags.depthLevel] =
      (depthCounts[tags.depthLevel] || 0) + 1;
  }

  console.log("\n── Coverage Summary ──────────────────────────────────");
  console.log("contentPersona:", personaCounts);
  console.log("targetLayer:   ", layerCounts);
  console.log("depthLevel:    ", depthCounts);
  console.log("Total articles:", Object.keys(ARTICLE_TAGS).length);
  console.log("──────────────────────────────────────────────────────\n");
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(
    isDryRun ? "[DRY RUN] No writes will be made.\n" : "[EXECUTE] Writing to Sanity...\n"
  );

  printCoverageSummary();

  let successCount = 0;
  let errorCount = 0;

  for (const [articleId, tags] of Object.entries(ARTICLE_TAGS)) {
    const patch = {
      contentPersona: tags.contentPersona,
      targetLayer: tags.targetLayer,
      depthLevel: tags.depthLevel,
    };

    console.log(`[${articleId}]`);
    console.log(`  contentPersona: ${tags.contentPersona.join(", ")}`);
    console.log(`  targetLayer:    ${tags.targetLayer.join(", ")}`);
    console.log(`  depthLevel:     ${tags.depthLevel}`);

    if (!isDryRun) {
      try {
        await sanity.patch(articleId).set(patch).commit();
        console.log(`  -> updated`);
        successCount++;
      } catch (err) {
        console.error(`  -> ERROR:`, err);
        errorCount++;
      }
    } else {
      console.log(`  -> (dry run, skipped)`);
      successCount++;
    }
  }

  console.log(
    `\nDone. ${successCount} articles ${isDryRun ? "checked" : "updated"}, ${errorCount} errors.`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

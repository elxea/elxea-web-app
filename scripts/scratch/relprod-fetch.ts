/**
 * scratch: fetch all ja articles with plain-text body for relatedProducts mapping
 * pnpm tsx scripts/scratch/relprod-fetch.ts
 */
import { createClient } from "next-sanity";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const cfg = JSON.parse(
  readFileSync(join(process.env.HOME || "", ".config/sanity/config.json"), "utf-8")
);

const sanity = createClient({
  projectId: "5s8ahx87",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: false,
  token: cfg.authToken,
});

type Blk = { _type?: string; children?: { text?: string }[] };

function toText(body: Blk[] | undefined): string {
  if (!Array.isArray(body)) return "";
  return body
    .map((b) => (b.children || []).map((c) => c.text || "").join(""))
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const docs = await sanity.fetch(
    `*[_type == "article"]|order(orderNumber asc){
      _id, title, "slug": slug.current, orderNumber, excerpt, language,
      relatedProducts, "category": category->title,
      "tags": tags[]->title, body
    }`
  );
  const out = docs.map((d: Record<string, unknown>) => ({
    ...d,
    body: toText(d.body as Blk[]),
  }));
  writeFileSync(
    process.argv[2] || "/tmp/relprod-articles.json",
    JSON.stringify(out, null, 2)
  );
  console.log(`fetched ${out.length} articles`);
  for (const d of out) {
    console.log(
      `${String(d.orderNumber ?? "-").padStart(3)} | ${d.language} | ${d.slug} | rp=${JSON.stringify(d.relatedProducts ?? null)} | ${String(d.body).length}ch`
    );
  }
}
main();

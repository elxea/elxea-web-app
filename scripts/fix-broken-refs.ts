import { createClient } from "next-sanity";
import { readFileSync } from "fs";
import { join } from "path";

const home = process.env.HOME || "";
const sanityConfig = JSON.parse(
  readFileSync(join(home, ".config/sanity/config.json"), "utf-8")
);

const client = createClient({
  projectId: "5s8ahx87",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: false,
  token: sanityConfig.authToken,
});

async function main() {
  // Find articles referencing the broken IDs
  const brokenRefs = await client.fetch<{
    catRefs: { _id: string; title: string }[];
    tagRefs: { _id: string; title: string }[];
  }>(`{
    "catRefs": *[_type == "article" && category._ref == "notion-category-"]{_id, title},
    "tagRefs": *[_type == "article" && "notion-tag-" in tags[]._ref]{_id, title}
  }`);

  console.log(
    "Articles with broken category:",
    brokenRefs.catRefs.map((a) => a.title)
  );
  console.log(
    "Articles with broken tag:",
    brokenRefs.tagRefs.map((a) => a.title)
  );

  for (const art of brokenRefs.catRefs) {
    await client.patch(art._id).unset(["category"]).commit();
    console.log("Cleared category ref:", art.title);
  }

  for (const art of brokenRefs.tagRefs) {
    const doc = await client.fetch<{ tags: { _ref: string; _key: string }[] }>(
      `*[_id == $id][0]{tags}`,
      { id: art._id }
    );
    const cleanTags = (doc.tags || []).filter(
      (t) => t._ref !== "notion-tag-"
    );
    await client.patch(art._id).set({ tags: cleanTags }).commit();
    console.log("Cleaned tag refs:", art.title);
  }

  await client.delete("notion-category-");
  console.log("Deleted notion-category-");
  await client.delete("notion-tag-");
  console.log("Deleted notion-tag-");
}

main().catch(console.error);

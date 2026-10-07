/**
 * 同期 (scripts/sync-notion-to-sanity.ts) が Notion の画像を Sanity に置く。
 * 呼び元は 3 か所 (本文の画像・見出し・サムネイル) で、すべてこの関数を通る。
 *
 * ## 同じ中身を上げ直さない (写真の仕組み 段5・ID-9785・2026-10-08)
 *
 * 前は毎回 `client.assets.upload` を呼んでいた。同じバイトを上げると Sanity は同じ _id を
 * 返すが、資産の文書を書き直す。そのたびに次が起きていた (1 回の同期で 143 資産すべて):
 *   - originalFilename が同期の名前 (`<slug>-header` など) に替わる
 *   - Asset hub の配信が付けた札 (資産の source {name:'asset-hub', id, url}) が消える
 *
 * いまは、取ったバイトの sha1 で既存の資産を照会し、あればその _id を返して上げない。
 * Sanity の画像の資産の `sha1hash` は元のファイルの sha1 で、_id の `image-<sha1>-…` と同じ値。
 * 照会が失敗したときは同期を止めず、今までどおり上げる (その事実をログに 1 行出す)。
 */
import { createHash } from "crypto";
import type { SanityClient } from "next-sanity";

export type SanityImageRef = { _type: "reference"; _ref: string };

export const EXISTING_IMAGE_ASSET_BY_SHA1 =
  '*[_type=="sanity.imageAsset" && sha1hash==$sha][0]._id';

export async function uploadImageToSanity(
  client: SanityClient,
  imageUrl: string,
  filename?: string
): Promise<SanityImageRef | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());

    const sha = createHash("sha1").update(buffer).digest("hex");
    try {
      const existingId: unknown = await client.fetch(
        EXISTING_IMAGE_ASSET_BY_SHA1,
        { sha }
      );
      if (typeof existingId === "string" && existingId) {
        return { _type: "reference", _ref: existingId };
      }
    } catch (err) {
      // 署名つきの Notion の画像の URL は出さない (Actions のログは公開)。sha1 で特定できる。
      console.warn(
        `  Image asset lookup failed (sha1=${sha}); uploading anyway: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const asset = await client.assets.upload("image", buffer, {
      filename: filename || "notion-image",
    });
    return { _type: "reference", _ref: asset._id };
  } catch (err) {
    console.error(`  Failed to upload image: ${imageUrl}`, err);
    return null;
  }
}

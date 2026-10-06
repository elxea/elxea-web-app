/**
 * 記事の本文の画像の _key を Notion のブロックの id から作る (段3設計 9節 U7c・2026-10-06)。
 *
 * Asset hub の写真の配信は、記事の本文の画像の枠を `article:<slug>:body-<ブロックの id 32 桁>` で持ち、
 * Notion の画像のブロックを書き換える (Asset hub lib/slot-keys notionBlockKeyOf と同じ形: ハイフンを除いた小文字の 16 進 32 桁)。
 * 同期が本文の画像の _key に同じ id を残すと、Sanity の本文の画像と Notion のブロックと配信の枠が 1 つの鍵でつながる。
 * 前は時刻から _key を作っていたので、同期のたびに変わり、つながらなかった。
 */
const NOTION_BLOCK_KEY_RE = /^[0-9a-f]{32}$/;

/** Notion のブロックの id -> 本文の画像の _key。32 桁の 16 進でなければ null (呼び手は今までの作り方に戻す)。 */
export function bodyImageKeyOf(blockId: string | null | undefined): string | null {
  const k = String(blockId ?? '').replace(/-/g, '').toLowerCase();
  return NOTION_BLOCK_KEY_RE.test(k) ? k : null;
}

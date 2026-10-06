/**
 * image-slots-v2.ts — 2 つの枠の宣言に共通の「欄の決まり」だけを持つ。
 *
 * 枠の宣言は 2 つある。どちらも「集合は機械で作り、手で書くのは属性だけ。食い違えば
 * build で止まる」形で、ここはその 2 つが同じ言葉で `area` と `alt` を書くための述語。
 *
 *   public/site-slots.manifest.json   … ページの枠 (集合 = コードの SiteImage の slotId)
 *   public/image-slots.inventory.json … Sanity の画像の欄 (集合 = sanity/schemas の AST)
 *
 * 足した欄 (段3設計 2節の枠の宣言の型 image-slots/v2。今の枠の鍵の形は変えない):
 *   area … 入れた状態の場所 (asset-hub の INTAKE_AREAS はここから作る)。
 *   alt  … 説明文の作り方の名前 (作る関数は asset-hub 側。段3設計 6節)。
 * 届け先の種類の欄 (exit) は持たない。届け先は枠の鍵の頭から asset-hub が決める。
 *
 * 値はひとつも持たない (どの枠がどの場所かは宣言のファイルだけにある)。持つのは
 * 「書いてよい形」の述語だけ。
 */

/** 2 つの宣言の書き方の版。ファイルの `format` に入る。 */
export const IMAGE_SLOTS_FORMAT = 'image-slots/v2';

/**
 * 説明文 (alt) の作り方の名前。
 *
 *   code  … コードが持つ (SiteImage の alt / 共有カードは lib/og-image)。ページの枠。
 *   title … 「<文書の題>」。記事・ジャーナル・イベント・ページ。
 *   name  … 「<文書の名前>」。お茶メニュー・プレイリスト・人物・生産者。
 *
 * 商品とコレクションの作り方は asset-hub 側の規則の宣言が持つ (このサイトの宣言には出ない)。
 */
export const IMAGE_SLOT_ALT_RECIPES = ['code', 'title', 'name'] as const;
export type ImageSlotAltRecipe = (typeof IMAGE_SLOT_ALT_RECIPES)[number];

/** 場所の名前の形。asset-hub の入れた状態の置き場 cdn/intake/<org>/<area>.json の <area>。 */
export const IMAGE_SLOT_AREA_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isImageSlotAltRecipe(v: unknown): v is ImageSlotAltRecipe {
  return typeof v === 'string' && (IMAGE_SLOT_ALT_RECIPES as readonly string[]).includes(v);
}

export function isImageSlotArea(v: unknown): v is string {
  return typeof v === 'string' && IMAGE_SLOT_AREA_PATTERN.test(v);
}

/** 鍵の順を揃えた JSON 文字列。宣言を「作り直した物」と中身で比べるために使う。 */
export function canonicalJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

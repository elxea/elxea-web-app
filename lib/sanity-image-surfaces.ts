/**
 * Sanity の画像枠の「主な表示の比」の正本。
 *
 *   描画のコード … ここの幅と高さで切り抜く (urlFor(...).width(X.width).height(X.height))
 *   宣言         … scripts/gen-image-slots.ts がここから public/image-slots.inventory.json の
 *                  `surfaces` を書く (手で書かない)。pnpm check:image-slots がずれを止める
 *   読む側       … elxea-asset-hub の lib/sanity-exit.ts displayRatios が宣言の
 *                  `surfaces[0].ratio` を読み、Asset hub で決めた位置 (focal) を、その比の窓で
 *                  Sanity の hotspot に写す
 *
 * 形は public/site-slots.manifest.json の site:* の枠の `surfaces` と同じ
 * ({ id, label, ratio: { width, height }, fit })。比は約分しない (読む側が約分する)。
 *
 * 枠に表示が複数あるときは、一覧の表示 (主な表示) を `surfaces[0]` に置く。
 * Sanity の hotspot は 1 つだけなので、読む側は `surfaces[0]` しか使わない。
 */

export interface RenderSize {
  readonly width: number;
  readonly height: number;
}

export interface SlotSurface {
  readonly id: string;
  readonly label: string;
  readonly ratio: RenderSize;
  readonly fit: "cover";
}

/** お茶メニュー一覧のカード (CatalogCard) の写真。app/[locale]/(reading)/tea-menu/page.tsx で切り抜く。 */
export const TEA_MENU_CARD_IMAGE: RenderSize = { width: 600, height: 400 };

/**
 * ArticleCard の写真。components/journal/article-card.tsx で切り抜く。
 * プレイリスト一覧では、特集の 1 件を除く全件がこのカードで出る (albumImage を thumbnail に渡す)。
 */
export const ARTICLE_CARD_IMAGE: RenderSize = { width: 600, height: 400 };

/** Sanity の画像枠 (inventory の id) -> 表示の比。ここに無い枠は宣言に `surfaces` を持たない。 */
export const SANITY_SLOT_SURFACES: Readonly<Record<string, readonly SlotSurface[]>> = {
  "sanity:playlist:albumImage": [
    {
      id: "list",
      label: "プレイリスト一覧のカード (ArticleCard。特集の 1 件を除く全件)",
      ratio: ARTICLE_CARD_IMAGE,
      fit: "cover",
    },
  ],
  "sanity:teaMenu:photo": [
    {
      id: "list",
      label: "お茶メニュー一覧のカード (CatalogCard)",
      ratio: TEA_MENU_CARD_IMAGE,
      fit: "cover",
    },
  ],
};

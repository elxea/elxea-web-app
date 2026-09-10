import type { Metadata } from "next";

/**
 * 共有カード画像 (og:image / twitter:image) の**単一正本**。
 *
 * ## なぜこのファイルが要るか (2026-09-11 の実測)
 *
 * Next.js の metadata は `openGraph` を**オブジェクト単位で置換**する。子セグメントが
 * `openGraph: { title, description }` を返すと、親 (`app/[locale]/layout.tsx`) が持っていた
 * `openGraph.images` は**マージされずに丸ごと消える**。
 *
 * その結果、本番 elxea.com は次の状態だった (認証つき HTML を実測):
 *
 * | URL | og:image |
 * |---|---|
 * | `/ja` (トップ) | **無し** |
 * | `/ja/about` `/ja/events` `/ja/elxea-journal` | **無し** |
 * | `/ja/products` (openGraph を自前宣言していない) | あり |
 *
 * LINE / Facebook / Slack / iMessage が読むのは `og:image` なので、**サイトのトップ URL を
 * 共有しても画像が出ない**。`twitter:image` だけが残っていたのは、`twitter` を上書きした
 * ページが 1 つも無かったから (症状が中途半端で気づきにくかった理由でもある)。
 *
 * さらに `openGraph.images` を書いているページも `images: image ? [{ url: image }] : []` の形で、
 * **ドキュメントに画像が無いと空配列**になり同じく og:image が消えていた。
 *
 * ## 使い方 (新しいページを足すときも同じ)
 *
 * `openGraph` を返すすべての `generateMetadata` で `images` を**必ず**埋める。
 *
 * ```ts
 * openGraph: { title, description, images: ogImages() }            // 固有画像なし
 * openGraph: { title, description, images: ogImages(heroUrl) }     // 固有画像あり (無ければ既定へ)
 * ```
 *
 * `ogImages()` は引数が falsy なら既定の 1 枚を返すので、`? :` の三項も空配列も書かなくてよい。
 * この規約は `__tests__/og-image.test.ts` が **`app/` 配下の全 `openGraph` 宣言**を走査して
 * 機械強制する (images を書き忘れた宣言があるとテストが落ちる)。
 */

/**
 * 既定の共有カード画像。
 *
 * 実体は `public/og-image.jpg` (1200x630 / JPEG)。elxea の実写真 — 玻璃の茶器に注いだ
 * 和紅茶の水色と、elxea のティーバッグ (No.00101 べにふうき / 福岡県 八女市) を俯瞰で
 * 収めた 1 枚で、Drive `20_elxea/02_work/photos/photo-inbox/drinking-tea` が出どころ。
 *
 * 直前まで置かれていた `public/og-image.png` は「elxea / **Specialty Coffee & Tea**」という
 * 文字だけの仮画像だった。elxea の取扱カテゴリは緑茶・烏龍茶・紅茶で **コーヒーは扱っていない**
 * ため、og:image が生きているページ (`/ja/products` 等) では誤ったカテゴリを名乗る共有カードが
 * 出ていた。差し替えと同時に旧 png は削除している (参照元は本ファイルのみ)。
 *
 * サイズは DS トークン `og-image-w` / `og-image-h` (1200x630 / `tokens/base.json`) に一致させる。
 */
export const OG_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "elxea — Single-Origin Japanese Tea",
} as const;

/** `openGraph.images` に渡せる型 (Next.js の `Metadata["openGraph"]["images"]`)。 */
type OgImages = NonNullable<NonNullable<Metadata["openGraph"]>["images"]>;

/**
 * `openGraph.images` の値を作る。
 *
 * @param url ページ固有の画像 URL。`undefined` / `null` / 空文字なら既定の 1 枚に落ちる。
 *            **空配列を返すことはない** — 空配列は og:image を消すため。
 */
export function ogImages(url?: string | null): OgImages {
  return url ? [{ url }] : [{ ...OG_IMAGE }];
}

import type { ImgHTMLAttributes } from 'react';
import { type ImageProps } from 'next/image';
import { ImageWithFallback } from '@/components/media/image-with-fallback';
import { getSiteImage } from '@/lib/site-assets';
import type { ResolvedSiteImage } from '@/lib/site-assets';
import type { SiteSlotId } from '@/lib/site-slots';

/**
 * SiteImage — async Server Component that fills a site-body static image frame
 * from the Asset Hub manifest (M33 spec 39c70c9d Phase C).
 *
 * 1 枠は宣言 (`public/site-slots.manifest.json`) の surface のぶんだけ「見え方」を
 * 持ち (SP 5:4 / PC 864:560 等)、asset-hub は面ごとに切り抜きを焼く。ここはその
 * 面別 url を宣言の media 条件で出し分ける。
 *
 * 出し方は 2 通りに分かれ、分岐は「面ごとに違う url に解決したか」だけで決まる:
 *
 *  - **1 枚で足りるとき** (未割当 / 旧形式の代表 1 枚 / 全面が同じ url)
 *    → 今までどおり `<Image>` 1 本。未割当の枠が今日と寸分違わず描かれること、
 *      静的画像が next/image の最適化に乗り続けることが、この分岐の目的。
 *  - **面ごとに url が違うとき** → `<picture>` + `<source media>`。
 *    art direction (幅で別の切り抜きに差し替える) は `<Image>` 1 本では表現できない。
 *    ここでは素の `<img>` を使う。理由は 2 つ:
 *      (1) `<Image priority>` は `<img>` の srcset を preload する `<link>` を出すが、
 *          preload は `<source media>` を見ないので、PC で SP 用の切り抜きまで
 *          先読みしてしまう (二重ダウンロード)。
 *      (2) この経路の url は R2 の切り抜き済み jpg で、寸法も形式も確定している。
 *          optimizer を通す利得が無い。
 *    `ImageWithFallback` を外しても失うものは無い — あれの onError 代替は
 *    `src` が http で始まらないときだけ働く実装で、R2 の url には最初から効かない。
 *
 * どちらの経路でも `className` / `style` は同じ要素 (実際に出る `<img>`) に載るので、
 * 呼び出し側が持っている比率の切り替え等の CSS はそのまま効く。
 */
interface SiteImageProps extends Omit<ImageProps, 'onError' | 'src'> {
  /**
   * 枠 id。`public/site-slots.manifest.json` が宣言している id だけを受け付ける
   * (`SiteSlotId` は manifest から生成した union 型)。宣言に無い枠に写真を置こうと
   * すると型エラーになるので、「コードにはあるが manifest に無い枠」は
   * コンパイル時点で存在できない。逆向き (manifest にあるがコードで使っていない)
   * は型では見えないので `pnpm check:site-slots` が build の前段で検出する。
   */
  slotId: SiteSlotId;
  /** Current static asset for this frame; used when the slot is unassigned. */
  src: string;
  /** Runtime onError placeholder (unchanged ImageWithFallback behaviour). */
  fallbackSrc?: string;
}

/**
 * next/image だけが解釈する prop の一覧。素の `<img>` に流すと React が
 * 「DOM に無い属性」を警告するので、`<picture>` 経路では落とす。
 * 落とすものを列挙する側 (allowlist ではなく denylist) にしてあるのは、
 * `aria-*` / `data-*` / `id` など呼び出し側が足しうる素の属性を素通しするため。
 */
const NEXT_ONLY_IMAGE_PROPS = [
  'loader',
  'quality',
  'preload',
  'priority',
  'placeholder',
  'blurDataURL',
  'unoptimized',
  'overrideSrc',
  'onLoadingComplete',
  'fill',
  'layout',
  'objectFit',
  'objectPosition',
  'lazyBoundary',
  'lazyRoot',
] as const;

function toPlainImgProps(
  props: Omit<SiteImageProps, 'slotId' | 'src' | 'fallbackSrc'>,
): ImgHTMLAttributes<HTMLImageElement> {
  const rest: Record<string, unknown> = { ...props };
  for (const key of NEXT_ONLY_IMAGE_PROPS) delete rest[key];
  return rest as ImgHTMLAttributes<HTMLImageElement>;
}

export async function SiteImage({
  slotId,
  src,
  fallbackSrc,
  ...props
}: SiteImageProps) {
  const resolved = await getSiteImage(slotId, src);
  return <SiteImageFigure resolved={resolved} fallbackSrc={fallbackSrc} {...props} />;
}

/**
 * 解決済みの 1 枠を描くだけの部分 (同期・取得しない)。
 *
 * `SiteImage` から切り出してあるのは、**枠の描き方は 1 通りしか無い**が枠の置かれ方が
 * 2 通りあるため: ページに直接置く `SiteImage` と、既存の写真枠 (`ImageCard`) の中に
 * 収める `SiteImageCard`。両方が同じ `<picture>` 分岐を通るようにしておかないと、
 * art direction の扱いが枠の置かれ方で食い違う。
 */
export function SiteImageFigure({
  resolved,
  fallbackSrc,
  ...props
}: Omit<SiteImageProps, 'slotId' | 'src'> & { resolved: ResolvedSiteImage }) {
  if (!resolved.artDirected) {
    return (
      <ImageWithFallback src={resolved.src} fallbackSrc={fallbackSrc} {...props} />
    );
  }

  const imgProps = toPlainImgProps(props);
  // `priority` は Next 16 で `preload` に置き換わった (両方来うるので両方見る)。
  const eager = props.preload ?? props.priority ?? false;

  return (
    // `contents` で picture 自身のボックスを消し、親から見た子は今までどおり
    // <img> 1 つのまま = レイアウトに影響しない。
    <picture className="contents">
      {resolved.sources.map((surface) => (
        <source key={surface.id} media={surface.media} srcSet={surface.url} />
      ))}
      {/* art direction (幅ごとに別の切り抜き) は next/image では表現できず、この経路の
          url は R2 の切り抜き済み jpg なので optimizer を通す利得も無い。上の JSDoc 参照。 */}
      <img
        {...imgProps}
        alt={props.alt ?? ''}
        src={resolved.src}
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        fetchPriority={eager ? 'high' : undefined}
      />
    </picture>
  );
}

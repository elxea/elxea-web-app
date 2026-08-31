import type { CSSProperties } from 'react';

import { ImageCard } from '@/components/media/image-card';
import { SiteImageFigure } from '@/components/site-image';
import { getSiteImage } from '@/lib/site-assets';
import type { SiteSlotId } from '@/lib/site-slots';
import { cn } from '@/lib/utils';

/**
 * SiteImageCard — 既存の写真枠 (`ImageCard`) を、そのまま画像枠 (site slot) にする。
 *
 * `SiteImage` との違いは「未割当のときに何を描くか」だけ:
 *
 *  - `SiteImage` は **静的画像が必ずある**枠に使う (トップ Hero)。未割当なら
 *    その静的画像を出す。
 *  - `SiteImageCard` は **今日は写真が無い**枠に使う。サイトの大半の写真枠は
 *    `<ImageCard image={undefined}>` = 灰色の面 (`ImagePlaceholder`) のまま置かれて
 *    いて、差し替える静的画像そのものが存在しない。未割当のときは
 *    **今日と同じ `ImageCard` をそのまま描く** — 呼び出しを置き換えても見た目が
 *    1px も動かないことが、この分岐の目的 (退行ゼロ)。
 *
 * 判定は `ResolvedSiteImage.assigned` (マニフェスト由来の写真が 1 枚でも当たったか)
 * だけを見る。`src` を見て判定しないのは、未割当のとき `src` が後退先で埋まっていて
 * 「割り当てられた写真」と区別できないため。
 *
 * 割当があるときは `ImageCard` の器 (比率・角丸・はみ出し切り・灰色の下地) をそのまま
 * 使い、中身だけ `SiteImageFigure` に差し替える。器を作り直さないので、比率を決めて
 * いる呼び出し側の CSS (`aspectRatio` / `className`) は今までどおり効く。
 */
type SiteImageCardProps = {
  /**
   * 枠 id。`public/site-slots.manifest.json` が宣言している id だけを受け付ける。
   * `pnpm check:site-slots` が宣言とコードの双方向を突き合わせる。
   */
  slotId: SiteSlotId;
  /**
   * 今日この枠に出ている画像 (CMS 由来の url など)。未割当のときの表示に使う。
   * 今日なにも出ていない枠では省略する (= 灰色の面のまま)。
   */
  image?: string;
  alt?: string;
  /** CSS aspect-ratio 値 (`ImageCard` と同じ既定 "3/2")。 */
  aspectRatio?: string;
  className?: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  /** group-hover のズーム (`ImageCard` と同じ)。 */
  hover?: boolean;
  style?: CSSProperties;
};

export async function SiteImageCard({
  slotId,
  image,
  alt = '',
  aspectRatio,
  className,
  width,
  height,
  sizes,
  priority,
  hover,
  style,
}: SiteImageCardProps) {
  const resolved = await getSiteImage(slotId, image ?? '');

  if (!resolved.assigned) {
    // 未割当 — 今日とまったく同じ `ImageCard` を描く。
    return (
      <ImageCard
        image={image}
        alt={alt}
        aspectRatio={aspectRatio}
        className={className}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        hover={hover}
        style={style}
      />
    );
  }

  return (
    <ImageCard
      aspectRatio={aspectRatio}
      className={className}
      style={style}
      // children を渡すと `ImageCard` は器だけを作る。器の指定 (比率・角丸・下地) は
      // 未割当のときと同じ経路を通るので、割当の有無でレイアウトが動かない。
    >
      <SiteImageFigure
        resolved={resolved}
        alt={alt}
        width={width ?? 600}
        height={height ?? 400}
        sizes={sizes}
        priority={priority}
        className={cn(
          'w-full h-full object-cover',
          hover && 'transition-transform duration-500 group-hover:scale-105',
        )}
      />
    </ImageCard>
  );
}

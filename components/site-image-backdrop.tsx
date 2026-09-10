import { SiteImageFigure } from '@/components/site-image';
import { getSiteImage } from '@/lib/site-assets';
import type { SiteSlotId } from '@/lib/site-slots';
import { cn } from '@/lib/utils';

/**
 * SiteImageBackdrop — 帯 (章切り) の**背面**を画像枠 (site slot) にする。
 *
 * `SiteImage` / `SiteImageCard` が「写真そのものを置く枠」なのに対し、これは
 * 「文字が上に載る背景」を扱う。違いは 3 点だけ:
 *
 *  1. **未割当なら何も描かない** (`null`)。章切りの帯は今日 `bg-primary` のベタ塗りで、
 *     写真が無い状態が正しい見た目として成立している。灰色のプレースホルダを出すと
 *     ベタ塗りより悪くなるので、割当があるときだけ背面に差し込む。
 *  2. 絶対配置で親いっぱいに広がる (`absolute inset-0` / `object-cover`)。呼び出し側の
 *     帯は `relative isolate overflow-hidden` を持つ前提。
 *  3. 文字の可読性を守る**覆い**を必ず 1 枚重ねる。既定は帯の地色 (`bg-primary`) を
 *     そのまま不透明度付きで敷くので、写真が入っても帯の色みは変わらない
 *     (生の HEX を持ち込まない = トークン束縛)。
 *
 * `aria-hidden` + 空 alt。中身は装飾で、読み上げるべき情報を持たない。
 */
export async function SiteImageBackdrop({
  slotId,
  /** 覆いの濃さ。既定は本文が白抜きで読める濃度 (bg-primary/75)。 */
  overlayClassName = 'bg-primary/75',
  sizes = '100vw',
  className,
}: {
  slotId: SiteSlotId;
  overlayClassName?: string;
  sizes?: string;
  className?: string;
}) {
  const resolved = await getSiteImage(slotId, '');

  // 未割当 — 帯は今日と同じベタ塗りのまま (退行ゼロ)。
  if (!resolved.assigned) return null;

  return (
    <div
      data-slot="site-image-backdrop"
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10', className)}
    >
      <SiteImageFigure
        resolved={resolved}
        alt=""
        width={1440}
        height={480}
        sizes={sizes}
        className="h-full w-full object-cover"
      />
      <div className={cn('absolute inset-0', overlayClassName)} />
    </div>
  );
}

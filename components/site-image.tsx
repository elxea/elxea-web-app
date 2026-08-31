import { type ImageProps } from 'next/image';
import { ImageWithFallback } from '@/components/media/image-with-fallback';
import { getSiteAsset } from '@/lib/site-assets';
import type { SiteSlotId } from '@/lib/site-slots';

/**
 * SiteImage — async Server Component that fills a site-body static image frame
 * from the Asset Hub manifest (M33 spec 39c70c9d Phase C).
 *
 * Resolution: `getSiteAsset(slotId, src)` returns the slot's assigned R2 image
 * when the manifest has an entry, otherwise `src` (the frame's current static
 * asset). The resolved url is handed to {@link ImageWithFallback}, so `fallbackSrc`
 * still guards the runtime <img> onError as before. Net effect: an unassigned
 * slot (empty/failed manifest) renders exactly today's image — the look never
 * breaks — while an assigned slot swaps in the cropped R2 image within the ISR
 * window, no rebuild required.
 *
 * This is an async server component; render it as a child of any server
 * component (page.tsx frames stay synchronous). It streams in with Suspense
 * fallback = the frame's own layout.
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

export async function SiteImage({
  slotId,
  src,
  fallbackSrc,
  ...props
}: SiteImageProps) {
  const resolvedSrc = await getSiteAsset(slotId, src);
  return (
    <ImageWithFallback src={resolvedSrc} fallbackSrc={fallbackSrc} {...props} />
  );
}

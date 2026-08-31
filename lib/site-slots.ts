/**
 * site-slots.ts — 画像枠宣言 (`public/site-slots.manifest.json`) の読み口。
 *
 * 【向き】このサイトが枠を宣言し、asset-hub が読む。
 * 枠が増減する原因はサイトのページ追加・レイアウト変更であって asset-hub の都合では
 * ないので、変わる側 (サイト) が宣言し、変わらない側 (asset-hub) が読む。これなら
 * 「サイトを直したのに asset-hub の枠定義を直し忘れる」が構造的に起きない。
 *
 * 【SoT はあくまで JSON】値はこのファイルに一切ベタ書きしない。ここが持つのは
 * JSON を読んで使うためのヘルパだけ。枠を足すときに触るのは JSON 1 ファイル。
 * 形と検査述語は `lib/site-slots-schema.ts`、id の union 型は生成物
 * `lib/site-slots.generated.ts` (`pnpm generate:site-slots`)。
 *
 * 【公開経路】`public/` 直下に置いてあるので、ビルド出力にそのまま含まれ
 * `https://<site>/site-slots.manifest.json` で配信される。asset-hub はこの URL を
 * 読む。SoT と配信物が同一ファイルなので、コピーの同期ズレが起きない。
 */

import manifestJson from '@/public/site-slots.manifest.json';

import { SITE_SLOT_IDS, type SiteSlotId } from '@/lib/site-slots.generated';
import type { SiteSlot, SiteSlotsManifest } from '@/lib/site-slots-schema';

export { SITE_SLOT_IDS, type SiteSlotId };
export type {
  SiteSlot,
  SiteSlotFit,
  SiteSlotRatio,
  SiteSlotSurface,
  SiteSlotsManifest,
} from '@/lib/site-slots-schema';
export {
  SITE_SLOT_ID_PATTERN,
  isSiteSlotActive,
  validateSiteSlotsManifest,
} from '@/lib/site-slots-schema';

/** `public/site-slots.manifest.json` の中身。 */
export const SITE_SLOTS_MANIFEST = manifestJson as unknown as SiteSlotsManifest;

/** 宣言されている全枠 (JSON の記載順ではなく `order` 昇順)。 */
export const SITE_SLOTS: readonly SiteSlot[] = [...SITE_SLOTS_MANIFEST.slots].sort(
  (a, b) => a.order - b.order,
);

/** id から枠を引く。manifest に無い id は型で弾かれるので、実行時は必ず見つかる。 */
export function getSiteSlot(id: SiteSlotId): SiteSlot {
  const slot = SITE_SLOTS.find((s) => s.id === id);
  if (!slot) {
    // 生成物と JSON がズレている場合にのみ到達する (check:site-slots が build で防ぐ)。
    throw new Error(
      `site slot "${id}" is declared in lib/site-slots.generated.ts but missing from ` +
        'public/site-slots.manifest.json — run `pnpm generate:site-slots`',
    );
  }
  return slot;
}

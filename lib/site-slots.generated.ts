/**
 * 自動生成ファイル — 直接編集しないこと。
 *
 * 生成元: public/site-slots.manifest.json (SoT)
 * 生成コマンド: pnpm generate:site-slots
 * 一致検査: pnpm check:site-slots (build の前段で走る)
 *
 * 枠を足す・消すときに編集するのは public/site-slots.manifest.json だけ。
 * このファイルはそこから作り直す。
 */

/** manifest が宣言している枠 id の union。これ以外の id は型で弾かれる。 */
export type SiteSlotId =
  | "site:top:hero-01"
  | "site:top:leaf-liquor-01"
  | "site:top:leaf-liquor-02"
  | "site:top:leaf-liquor-03"
  | "site:top:philosophy-01"
  | "site:top:overview-01"
  | "site:top:overview-02"
  | "site:top:overview-03"
  | "site:top:overview-04"
  | "site:top:subscription-item-01"
  | "site:top:subscription-item-02"
  | "site:top:subscription-item-03"
  | "site:top:subscription-item-04"
  | "site:about:us-01"
  | "site:about:origin-01"
  | "site:about:origin-02"
  | "site:about:origin-03"
  | "site:about:origin-04"
  | "site:about:philosophy-01"
  | "site:subscription:first-delivery-01"
  | "site:subscription:first-delivery-02"
  | "site:subscription:first-delivery-03"
  | "site:subscription:story-01"
  | "site:subscription:next-month-01";

/** 同じ集合を実行時にも使えるようにしたもの (order 昇順)。 */
export const SITE_SLOT_IDS: readonly SiteSlotId[] = [
  "site:top:hero-01",
  "site:top:leaf-liquor-01",
  "site:top:leaf-liquor-02",
  "site:top:leaf-liquor-03",
  "site:top:philosophy-01",
  "site:top:overview-01",
  "site:top:overview-02",
  "site:top:overview-03",
  "site:top:overview-04",
  "site:top:subscription-item-01",
  "site:top:subscription-item-02",
  "site:top:subscription-item-03",
  "site:top:subscription-item-04",
  "site:about:us-01",
  "site:about:origin-01",
  "site:about:origin-02",
  "site:about:origin-03",
  "site:about:origin-04",
  "site:about:philosophy-01",
  "site:subscription:first-delivery-01",
  "site:subscription:first-delivery-02",
  "site:subscription:first-delivery-03",
  "site:subscription:story-01",
  "site:subscription:next-month-01",
] as const;

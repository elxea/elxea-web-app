/**
 * gen-image-slots.ts
 *
 * Sanity スキーマから `public/image-slots.inventory.json` を作り直す。
 *
 *   pnpm generate:image-slots   ... 生成 (スキーマに画像枠を足したら必ず走らせる)
 *   pnpm check:image-slots      ... 一致検査 (build の前段でも走る / 不一致なら exit 1)
 *
 * 手で書く場所は各枠の `rendered`・`area`・`alt`・`note` の 4 つだけ。枠の集合そのものは
 * スキーマが唯一の正本で、ここは**写し取るだけ**。再生成しても既存の手書きの欄は
 * id で引き当てて引き継ぐ (人の判断を消さない)。
 *
 * `area` (入れた状態の場所) と `alt` (説明文の作り方の名前) は書き方 image-slots/v2 で
 * 足した欄 (段3設計 2節・9節 U1。決まりは lib/image-slots-v2.ts)。描画される枠
 * (`rendered: true`) は両方が要り、空なら check:image-slots が build を落とす。
 *
 * 新しく現れた枠は `rendered: null` (未判定) で入る。null のままだと巡回が
 * 「未判定の枠がある」と報告し続けるので、判断を先送りしても消えない。
 *
 * `rendered` の意味:
 *   true  … 本番の JSX に到達する = 空のままだと訪問者に灰色の面が見える
 *   false … スキーマにはあるが描画経路がゼロ (死にフィールド)
 *   null  … 未判定 (新規追加直後)
 *
 * なぜ public/ に置くか: 巡回 (elxea-asset-hub) は別リポジトリなので、
 * site-slots.manifest.json と同じく本番 URL から読めるところに置く。
 *
 * Exit codes: 0 = 生成成功 / 1 = 失敗
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { IMAGE_SLOTS_FORMAT, type ImageSlotAltRecipe, isImageSlotAltRecipe } from '../lib/image-slots-v2';

import { extractImageSlots } from './lib/image-slots-extract';
import type { ImageSlot } from './lib/image-slots-extract';

const ROOT = path.resolve(__dirname, '..');
export const SCHEMA_DIR = path.join(ROOT, 'sanity', 'schemas');
export const INVENTORY_PATH = path.join(ROOT, 'public', 'image-slots.inventory.json');

export interface InventorySlot extends ImageSlot {
  /** 本番 JSX に到達するか。true=描画される / false=死にフィールド / null=未判定 */
  rendered: boolean | null;
  /** 入れた状態の場所 (asset-hub の cdn/intake/<org>/<area>.json)。描画されない枠は null。 */
  area: string | null;
  /** 説明文の作り方の名前。描画されない枠は null。 */
  alt: ImageSlotAltRecipe | null;
  /** 判断の根拠 (file:line 等)。人が書く。 */
  note: string;
}

/** 手で書く欄 (id で引き継ぐ)。 */
export interface InventoryAnnotation {
  rendered: boolean | null;
  area: string | null;
  alt: ImageSlotAltRecipe | null;
  note: string;
}

export interface Inventory {
  $schema: string;
  format: string;
  description: string;
  generatedBy: string;
  slots: InventorySlot[];
}

const DESCRIPTION =
  'Sanity スキーマ上の画像枠の全数。集合の正本は sanity/schemas/*.ts で、' +
  'このファイルはそこから機械生成する (pnpm generate:image-slots)。' +
  'rendered / area / alt / note だけが手書き (area = 入れた状態の場所・alt = 説明文の作り方の名前)。巡回 (photo-gap-scan) はこれを読み、' +
  '経路1-5 のどれもカバーしていない枠を uncovered-slot として報告する。';

/** inventory の中身から id -> 手書きの欄を引く。形の崩れた値は null / 空に倒す。 */
export function annotationsOf(raw: unknown): Map<string, InventoryAnnotation> {
  const out = new Map<string, InventoryAnnotation>();
  const slots = (raw as { slots?: unknown } | null)?.slots;
  if (!Array.isArray(slots)) return out;
  for (const s of slots as Record<string, unknown>[]) {
    if (typeof s?.id !== 'string') continue;
    out.set(s.id, {
      rendered: typeof s.rendered === 'boolean' ? s.rendered : null,
      area: typeof s.area === 'string' ? s.area : null,
      alt: isImageSlotAltRecipe(s.alt) ? s.alt : null,
      note: typeof s.note === 'string' ? s.note : '',
    });
  }
  return out;
}

/** 既存 inventory のファイルから id -> 手書きの欄を引く (無ければ空)。 */
export function readAnnotations(inventoryPath: string): Map<string, InventoryAnnotation> {
  if (!existsSync(inventoryPath)) return new Map();
  return annotationsOf(JSON.parse(readFileSync(inventoryPath, 'utf8')));
}

/** スキーマの枠 + 既存注釈 -> inventory オブジェクト (書き込みはしない)。 */
export function buildInventory(
  slots: ImageSlot[],
  annotations: Map<string, InventoryAnnotation>,
): Inventory {
  return {
    $schema: 'https://elxea.com/image-slots.inventory.json',
    format: IMAGE_SLOTS_FORMAT,
    description: DESCRIPTION,
    generatedBy: 'pnpm generate:image-slots',
    slots: slots.map((s) => {
      const a = annotations.get(s.id);
      return {
        ...s,
        rendered: a?.rendered ?? null,
        area: a?.area ?? null,
        alt: a?.alt ?? null,
        note: a?.note ?? '',
      };
    }),
  };
}

export function renderInventory(inventory: Inventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function main(): void {
  const slots = extractImageSlots(SCHEMA_DIR, ROOT);
  const inventory = buildInventory(slots, readAnnotations(INVENTORY_PATH));
  writeFileSync(INVENTORY_PATH, renderInventory(inventory), 'utf8');
  const unjudged = inventory.slots.filter((s) => s.rendered === null).length;
  console.log(
    `image-slots: generated ${path.relative(ROOT, INVENTORY_PATH)} ` +
      `(${slots.length} slots, ${unjudged} unjudged)`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

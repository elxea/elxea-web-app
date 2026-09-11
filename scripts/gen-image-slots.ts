/**
 * gen-image-slots.ts
 *
 * Sanity スキーマから `public/image-slots.inventory.json` を作り直す。
 *
 *   pnpm generate:image-slots   ... 生成 (スキーマに画像枠を足したら必ず走らせる)
 *   pnpm check:image-slots      ... 一致検査 (build の前段でも走る / 不一致なら exit 1)
 *
 * 手で書く場所は各枠の `rendered` と `note` の 2 つだけ。枠の集合そのものは
 * スキーマが唯一の正本で、ここは**写し取るだけ**。再生成しても既存の
 * `rendered` / `note` は id で引き当てて引き継ぐ (人の判断を消さない)。
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

import { extractImageSlots } from './lib/image-slots-extract';
import type { ImageSlot } from './lib/image-slots-extract';

const ROOT = path.resolve(__dirname, '..');
export const SCHEMA_DIR = path.join(ROOT, 'sanity', 'schemas');
export const INVENTORY_PATH = path.join(ROOT, 'public', 'image-slots.inventory.json');

export interface InventorySlot extends ImageSlot {
  /** 本番 JSX に到達するか。true=描画される / false=死にフィールド / null=未判定 */
  rendered: boolean | null;
  /** 判断の根拠 (file:line 等)。人が書く。 */
  note: string;
}

export interface Inventory {
  $schema: string;
  description: string;
  generatedBy: string;
  slots: InventorySlot[];
}

const DESCRIPTION =
  'Sanity スキーマ上の画像枠の全数。集合の正本は sanity/schemas/*.ts で、' +
  'このファイルはそこから機械生成する (pnpm generate:image-slots)。' +
  'rendered / note だけが手書き。巡回 (photo-gap-scan) はこれを読み、' +
  '経路1-5 のどれもカバーしていない枠を uncovered-slot として報告する。';

/** 既存 inventory から id -> {rendered, note} を引く (無ければ空)。 */
export function readAnnotations(
  inventoryPath: string,
): Map<string, { rendered: boolean | null; note: string }> {
  const out = new Map<string, { rendered: boolean | null; note: string }>();
  if (!existsSync(inventoryPath)) return out;
  const raw: unknown = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const slots = (raw as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return out;
  for (const s of slots as Record<string, unknown>[]) {
    if (typeof s?.id !== 'string') continue;
    out.set(s.id, {
      rendered: typeof s.rendered === 'boolean' ? s.rendered : null,
      note: typeof s.note === 'string' ? s.note : '',
    });
  }
  return out;
}

/** スキーマの枠 + 既存注釈 -> inventory オブジェクト (書き込みはしない)。 */
export function buildInventory(
  slots: ImageSlot[],
  annotations: Map<string, { rendered: boolean | null; note: string }>,
): Inventory {
  return {
    $schema: 'https://elxea.com/image-slots.inventory.json',
    description: DESCRIPTION,
    generatedBy: 'pnpm generate:image-slots',
    slots: slots.map((s) => {
      const a = annotations.get(s.id);
      return { ...s, rendered: a?.rendered ?? null, note: a?.note ?? '' };
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

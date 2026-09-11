/**
 * check-image-slots.ts
 *
 * Sanity スキーマの画像枠 (実体) と `public/image-slots.inventory.json` (宣言) が
 * 食い違ったまま本番に出るのを止めるビルドゲート。
 *
 * 止めたい事故は 2 方向ある。どちらも **黙って** 起きるのが本質:
 *
 *   (a) スキーマに枠を足したのに inventory を更新していない
 *       → 巡回 (photo-gap-scan) の母集団に入らないので、その枠は永久に見られない。
 *          /ja/people/* の人物写真が何ヶ月も灰色だったのがこれ (2026-09-11)。
 *          「候補が無い」のではなく「見ていなかった」。
 *
 *   (b) inventory にあるのにスキーマから消えた
 *       → 巡回は存在しない枠を探し続け、報告が実体とずれる。
 *
 * あわせて inventory 自体の妥当性 (id の組み立て方・rendered の型・id 昇順) も見る。
 * どれか 1 つでも崩れていれば exit 1。
 *
 * 直し方は常に同じ: `pnpm generate:image-slots` を走らせ、新しく `rendered: null`
 * で入った枠に「本番で描画されるか」を書く。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる
 * (check-site-slots.ts の直後)。**新しい CI ジョブは足していない** ので
 * GitHub Actions の実行時間は増えない。単体では `pnpm check:image-slots`。
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { extractImageSlots } from './lib/image-slots-extract';
import type { ImageSlot } from './lib/image-slots-extract';
import { INVENTORY_PATH, SCHEMA_DIR } from './gen-image-slots';

const ROOT = path.resolve(__dirname, '..');

interface RawSlot {
  id?: unknown;
  documentType?: unknown;
  path?: unknown;
  file?: unknown;
  rendered?: unknown;
  note?: unknown;
}

/** inventory の形だけを見る (スキーマとの突き合わせは別)。 */
export function validateInventoryShape(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['inventory はオブジェクトではない'];
  const slots = (raw as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return ['inventory に slots[] が無い'];

  const seen = new Set<string>();
  let previousId = '';
  slots.forEach((s: RawSlot, i) => {
    const at = `slots[${i}]`;
    if (typeof s?.id !== 'string' || !s.id) {
      errors.push(`${at}: id が文字列でない`);
      return;
    }
    if (seen.has(s.id)) errors.push(`${at}: id が重複している (${s.id})`);
    seen.add(s.id);
    if (s.id < previousId) errors.push(`${at}: id が昇順でない (${previousId} の後に ${s.id})`);
    previousId = s.id;

    if (typeof s.documentType !== 'string' || !s.documentType) {
      errors.push(`${at}: documentType が文字列でない (${s.id})`);
    }
    if (typeof s.path !== 'string' || !s.path) errors.push(`${at}: path が文字列でない (${s.id})`);
    if (typeof s.file !== 'string' || !s.file) errors.push(`${at}: file が文字列でない (${s.id})`);
    if (typeof s.documentType === 'string' && typeof s.path === 'string') {
      const expected = `sanity:${s.documentType}:${s.path}`;
      if (s.id !== expected) errors.push(`${at}: id が ${expected} でない (${s.id})`);
    }
    if (!(typeof s.rendered === 'boolean' || s.rendered === null)) {
      errors.push(`${at}: rendered は true / false / null のいずれか (${s.id})`);
    }
    if (typeof s.note !== 'string') errors.push(`${at}: note が文字列でない (${s.id})`);
  });
  return errors;
}

/** 実体 (スキーマ) と宣言 (inventory) を双方向に突き合わせる。 */
export function diffSlots(fromSchema: ImageSlot[], fromInventory: RawSlot[]): string[] {
  const errors: string[] = [];
  const schemaById = new Map(fromSchema.map((s) => [s.id, s]));
  const inventoryById = new Map(
    fromInventory
      .filter((s): s is RawSlot & { id: string } => typeof s.id === 'string')
      .map((s) => [s.id, s]),
  );

  for (const [id, s] of schemaById) {
    if (!inventoryById.has(id)) {
      errors.push(
        `スキーマに画像枠 ${id} (${s.file}) があるが inventory に無い ` +
          `— 巡回の母集団に入らないので、この枠は誰にも見られない`,
      );
    }
  }
  for (const [id] of inventoryById) {
    if (!schemaById.has(id)) {
      errors.push(`inventory に ${id} があるがスキーマに無い — 存在しない枠を巡回が探し続ける`);
    }
  }
  for (const [id, s] of schemaById) {
    const inv = inventoryById.get(id);
    if (!inv) continue;
    if (inv.file !== s.file) {
      errors.push(`${id}: file が食い違う (inventory=${String(inv.file)} / schema=${s.file})`);
    }
  }
  return errors;
}

function fail(errors: string[]): never {
  console.error('image-slots: 不整合\n' + errors.map((e) => `  - ${e}`).join('\n'));
  console.error('\n直し方: pnpm generate:image-slots を走らせ、新しく入った枠の rendered を埋める');
  process.exit(1);
}

function main(): void {
  if (!existsSync(INVENTORY_PATH)) {
    fail([
      `${path.relative(ROOT, INVENTORY_PATH)} が無い — pnpm generate:image-slots を走らせること`,
    ]);
  }
  const raw: unknown = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
  const shapeErrors = validateInventoryShape(raw);
  if (shapeErrors.length > 0) fail(shapeErrors);

  const fromInventory = (raw as { slots: RawSlot[] }).slots;
  const fromSchema = extractImageSlots(SCHEMA_DIR, ROOT);
  const errors = diffSlots(fromSchema, fromInventory);
  if (errors.length > 0) fail(errors);

  const unjudged = fromInventory.filter((s) => s.rendered === null).map((s) => String(s.id));
  console.log(
    `image-slots: OK (${fromSchema.length} slots, ` +
      `${fromInventory.filter((s) => s.rendered === true).length} rendered)`,
  );
  if (unjudged.length > 0) {
    console.log(
      `image-slots: 描画有無が未判定の枠が ${unjudged.length} 件ある — ` +
        `巡回が uncovered-slot (warn) として報告し続ける:\n` +
        unjudged.map((id) => `  - ${id}`).join('\n'),
    );
  }
}

if (require.main === module) {
  main();
}

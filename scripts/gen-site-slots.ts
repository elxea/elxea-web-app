/**
 * gen-site-slots.ts
 *
 * `public/site-slots.manifest.json` (SoT) から `lib/site-slots.generated.ts` を作る。
 *
 * なぜ生成が要るか: TypeScript の `resolveJsonModule` は JSON の文字列を `string` に
 * widen するため、JSON import から id のリテラル union 型を引けない。型で枠 id を
 * 縛る (manifest に無い id をコンパイルエラーにする) には union をコードとして持つ
 * しかない。そこで **JSON を唯一の手書き箇所**に保ち、union は生成物にして
 * `check:site-slots` が両者の一致を機械検査する。
 *
 *   pnpm generate:site-slots   ... 生成 (JSON を編集したら必ず走らせる)
 *   pnpm check:site-slots      ... 一致検査 (build の前段でも走る)
 *
 * Exit codes: 0 = 生成成功 / 1 = manifest が不正
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { validateSiteSlotsManifest } from '../lib/site-slots-schema';

const ROOT = path.resolve(__dirname, '..');
export const MANIFEST_PATH = path.join(ROOT, 'public', 'site-slots.manifest.json');
export const GENERATED_PATH = path.join(ROOT, 'lib', 'site-slots.generated.ts');

/** manifest を読んで検査し、`slots[].id` を宣言順のまま返す。不正なら throw。 */
export function readSlotIds(manifestPath: string = MANIFEST_PATH): string[] {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = validateSiteSlotsManifest(raw);
  if (errors.length > 0) {
    throw new Error(
      `site-slots manifest is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  const slots = (raw as { slots: { id: string; order: number }[] }).slots;
  return [...slots].sort((a, b) => a.order - b.order).map((s) => s.id);
}

/** 生成物のソースを組み立てる (書き込みはしない — テストから比較できるように分離)。 */
export function renderGenerated(ids: string[]): string {
  const union =
    ids.length === 0
      ? '  never'
      : ids.map((id) => `  | ${JSON.stringify(id)}`).join('\n');
  const list = ids.map((id) => `  ${JSON.stringify(id)},`).join('\n');

  return `/**
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
${union};

/** 同じ集合を実行時にも使えるようにしたもの (order 昇順)。 */
export const SITE_SLOT_IDS: readonly SiteSlotId[] = [
${list}
] as const;
`;
}

function main(): void {
  const ids = readSlotIds();
  const source = renderGenerated(ids);
  writeFileSync(GENERATED_PATH, source, 'utf8');
  console.log(
    `site-slots: generated ${path.relative(ROOT, GENERATED_PATH)} ` +
      `(${ids.length} slot${ids.length === 1 ? '' : 's'})`,
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

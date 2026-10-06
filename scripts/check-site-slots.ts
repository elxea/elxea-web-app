/**
 * check-site-slots.ts
 *
 * 画像枠の宣言 (`public/site-slots.manifest.json`) と、実際のコードの使用箇所が
 * 食い違ったまま本番に出るのを止めるビルドゲート。
 *
 * 止めたい事故は 2 方向ある:
 *
 *   (a) manifest にあるのにコードで使われていない枠
 *       → asset-hub に「空き枠」として出て、人が写真を当てるが、サイトのどこにも
 *          出ない。作業が丸ごと無駄になり、しかも誰も気づかない。
 *          (asset-hub 側の 16 枠のうち 15 枠が実際にこの状態だった)
 *
 *   (b) コードで使っているのに manifest に無い枠
 *       → asset-hub からは存在しない枠なので、永久に写真が当たらず
 *          `fallbackSrc` のままになる。これも黙って起きる。
 *          型 (`SiteSlotId`) でも弾かれるが、動的な文字列は型をすり抜けるので
 *          ここでも見る。
 *
 * あわせて、SoT (JSON) と生成物 (`lib/site-slots.generated.ts`) の一致、JSON 自体の
 * 妥当性 (area・alt を含む属性)、コードから作り直した宣言 (`scripts/gen-site-slots.ts`) と
 * 中身が同じことも見る。どれか 1 つでも崩れていれば exit 1。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる。
 * 単体でも `pnpm check:site-slots` で実行できる。
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../lib/image-slots-v2';
import { isSiteSlotActive, validateSiteSlotsManifest } from '../lib/site-slots-schema';
import type { SiteSlot } from '../lib/site-slots-schema';

import {
  GENERATED_PATH,
  MANIFEST_PATH,
  SITE_SLOTS_ROOT,
  buildManifest,
  readSlotIds,
  renderGenerated,
} from './gen-site-slots';
import { scanUsages, usedSlotIds, type Usage } from './lib/site-slots-scan';

export { mayUseSlots, scanSource, scanUsages } from './lib/site-slots-scan';

const ROOT = SITE_SLOTS_ROOT;

function rel(p: string): string {
  return path.relative(ROOT, p);
}

function main(): void {
  const problems: string[] = [];

  // 1) manifest が public/ 直下にあること (= ビルド出力に入り URL で配信されること)
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`FAIL: ${rel(MANIFEST_PATH)} がありません`);
    process.exit(1);
  }

  // 2) manifest 自体の妥当性
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const schemaErrors = validateSiteSlotsManifest(raw);
  for (const e of schemaErrors) problems.push(`manifest: ${e}`);
  if (schemaErrors.length > 0) {
    for (const p of problems) console.error(`  [FAIL] ${p}`);
    console.error(`\nSummary: ${rel(MANIFEST_PATH)} の内容が不正です`);
    process.exit(1);
  }

  const declaredIds = readSlotIds(MANIFEST_PATH);
  const declared = new Set(declaredIds);
  const version = (raw as { version: number }).version;
  const slotsById = new Map(
    (raw as { slots: SiteSlot[] }).slots.map((s) => [s.id, s] as const),
  );

  // 3) SoT (JSON) と生成物の一致
  if (!existsSync(GENERATED_PATH)) {
    problems.push(
      `${rel(GENERATED_PATH)} がありません — \`pnpm generate:site-slots\` を実行してください`,
    );
  } else if (readFileSync(GENERATED_PATH, 'utf8') !== renderGenerated(declaredIds)) {
    problems.push(
      `${rel(GENERATED_PATH)} が ${rel(MANIFEST_PATH)} と一致しません — ` +
        '`pnpm generate:site-slots` を実行してください',
    );
  }

  // 4) コード側の使用箇所を集める
  const { usages, dynamic } = scanUsages(ROOT);
  const used = new Map<string, Usage[]>();
  for (const u of usages) {
    const list = used.get(u.id) ?? [];
    list.push(u);
    used.set(u.id, list);
  }

  // (a) manifest にあるのにコードで使われていない
  //
  // ただし validTo が入っている枠は免除する。validTo は「この枠は畳む」という
  // 宣言なので、コードから SiteImage を外すのが正しい手順であり、そこで build が
  // 落ちてはいけない。免除しないと、廃止したい人は slots から削るしかなくなり、
  // それは manifest 自身が「割当が孤児になる」と禁じている道だった (QA NC5)。
  const retiring: string[] = [];
  for (const id of declaredIds) {
    if (used.has(id)) continue;
    const slot = slotsById.get(id);
    if (slot?.validTo) {
      retiring.push(
        `${id} (validTo=${slot.validTo}${isSiteSlotActive(slot) ? '・期限前' : '・期限切れ'})`,
      );
      continue;
    }
    problems.push(
      `枠 "${id}" は ${rel(MANIFEST_PATH)} が宣言していますが、コードのどこでも ` +
        '使われていません。SiteImage を置くか、畳むなら validTo を入れてください ' +
        '(slots から削ると asset-hub 側で割当が孤児になります)',
    );
  }

  // (b) コードで使っているのに manifest に無い
  for (const [id, list] of used) {
    if (!declared.has(id)) {
      const where = list.map((u) => `${rel(u.file)}:${u.line}`).join(', ');
      problems.push(
        `枠 "${id}" をコードが使っていますが (${where})、${rel(MANIFEST_PATH)} に ` +
          'ありません。manifest に足して `pnpm generate:site-slots` を実行してください',
      );
    }
  }

  // (c) 静的に読めない slotId — 上の突き合わせをすり抜けるので許可しない
  for (const d of dynamic) {
    problems.push(
      `${rel(d.file)}:${d.line}: slotId が文字列リテラルではありません。` +
        'manifest との突き合わせができないので、リテラルで書いてください',
    );
  }

  // (d) コードから作り直した宣言と中身が同じか (集合はコード・属性は id で引き継ぐ)。
  //     (a)(b) が無くても、手で枠の並び・説明・書き方の版を崩したらここで止まる。
  //     (a) と同じ枠は buildManifest が残すので、ここで二重には出ない。
  if (dynamic.length === 0) {
    const rebuilt = buildManifest(usedSlotIds(usages), raw).manifest;
    if (canonicalJson(rebuilt) !== canonicalJson(raw)) {
      problems.push(
        `${rel(MANIFEST_PATH)} をコードから作り直すと中身が変わります — ` +
          '`pnpm generate:site-slots` を実行してください (属性は id で引き継がれます)',
      );
    }
  }

  console.log(
    `site-slots: manifest version=${version} / 宣言 ${declaredIds.length} 枠 / ` +
      `コード使用 ${used.size} 枠`,
  );
  for (const r of retiring) {
    console.log(`site-slots: [SKIP] 畳む予定の枠なので未使用を許容 — ${r}`);
  }

  if (problems.length > 0) {
    console.error('');
    for (const p of problems) console.error(`  [FAIL] ${p}`);
    console.error('');
    console.error(
      `Summary: 枠の宣言とコードが ${problems.length} 件食い違っています — ビルドを中止しました`,
    );
    process.exit(1);
  }

  console.log('site-slots: [OK] 宣言とコードは一致しています');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

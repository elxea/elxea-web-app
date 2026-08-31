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
 * あわせて、SoT (JSON) と生成物 (`lib/site-slots.generated.ts`) の一致、および
 * JSON 自体の妥当性も見る。どれか 1 つでも崩れていれば exit 1。
 *
 * package.json の `build` が `next build` の前に本スクリプトを走らせる。
 * 単体でも `pnpm check:site-slots` で実行できる。
 *
 * Exit codes: 0 = 整合 / 1 = 不整合
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { validateSiteSlotsManifest } from '../lib/site-slots-schema';

import { GENERATED_PATH, MANIFEST_PATH, readSlotIds, renderGenerated } from './gen-site-slots';

const ROOT = path.resolve(__dirname, '..');

/** コードを走査する対象。ここに無いディレクトリで枠を使っても検出できない。 */
const SCAN_DIRS = ['app', 'components', 'lib', 'sanity'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
/** 枠 id を「宣言として」持つファイル。使用箇所としては数えない。 */
const NOT_A_USAGE = new Set(
  ['lib/site-slots.ts', 'lib/site-slots-schema.ts', 'lib/site-slots.generated.ts'].map((p) =>
    path.join(ROOT, p),
  ),
);

/** ソース中に現れる枠 id 文字列リテラル。 */
const SLOT_ID_LITERAL = /["'`](site:[a-z0-9-]+:[a-z0-9-]+)["'`]/g;
/** 静的に読めない `slotId={...}`。第 1 引数が文字列リテラルでないものだけ拾う。 */
const DYNAMIC_SLOT_ID = /slotId=\{(?!\s*["'`])/g;

interface Usage {
  id: string;
  file: string;
  line: number;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (SCAN_EXTENSIONS.has(path.extname(full)) && !full.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** ソースを走査して、枠 id の使用箇所と、静的に読めない slotId を集める。 */
export function scanUsages(root: string = ROOT): {
  usages: Usage[];
  dynamic: { file: string; line: number }[];
} {
  const usages: Usage[] = [];
  const dynamic: { file: string; line: number }[] = [];

  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(path.join(root, dir))) {
      if (NOT_A_USAGE.has(file)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, i) => {
        for (const m of text.matchAll(SLOT_ID_LITERAL)) {
          usages.push({ id: m[1], file, line: i + 1 });
        }
        for (const _ of text.matchAll(DYNAMIC_SLOT_ID)) {
          dynamic.push({ file, line: i + 1 });
        }
      });
    }
  }
  return { usages, dynamic };
}

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
  const { usages, dynamic } = scanUsages();
  const used = new Map<string, Usage[]>();
  for (const u of usages) {
    const list = used.get(u.id) ?? [];
    list.push(u);
    used.set(u.id, list);
  }

  // (a) manifest にあるのにコードで使われていない
  for (const id of declaredIds) {
    if (!used.has(id)) {
      problems.push(
        `枠 "${id}" は ${rel(MANIFEST_PATH)} が宣言していますが、コードのどこでも ` +
          '使われていません。SiteImage を置くか、manifest から外してください ' +
          '(一時的に外すだけなら validTo を入れる)',
      );
    }
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

  console.log(
    `site-slots: manifest version=${version} / 宣言 ${declaredIds.length} 枠 / ` +
      `コード使用 ${used.size} 枠`,
  );

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

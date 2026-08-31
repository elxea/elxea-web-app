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

import ts from 'typescript';

import { isSiteSlotActive, validateSiteSlotsManifest } from '../lib/site-slots-schema';
import type { SiteSlot } from '../lib/site-slots-schema';

import { GENERATED_PATH, MANIFEST_PATH, readSlotIds, renderGenerated } from './gen-site-slots';

const ROOT = path.resolve(__dirname, '..');

/** コードを走査する対象。ここに無いディレクトリで枠を使っても検出できない。 */
const SCAN_DIRS = ['app', 'components', 'lib', 'sanity'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * 「使用」と数える唯一の形は **JSX 属性 `slotId` の文字列リテラル**。
 *
 * 以前は任意の引用文字列を正規表現で拾っていたが、それだと
 * `// legacy: "site:top:hero-01"` のようなコメントが実使用の代わりになり、
 * SiteImage を消してコメントだけ残したときにゲートが黙って通っていた
 * (QA NC9 の偽陰性)。逆にコメントを足しただけで落ちる偽陽性も起きた (NC8)。
 * どちらも「文字列が出現したか」を見ていたのが原因なので、AST で
 * 「その文字列が JSX 属性 slotId の値か」を見るようにした。
 */
const SLOT_ID_ATTRIBUTE = 'slotId';

interface Usage {
  id: string;
  file: string;
  line: number;
}

/**
 * 1 ファイル分のソースから、JSX 属性 `slotId` の使用箇所を集める。
 *
 * 文字列リテラルで書かれていれば使用として数え、そうでなければ (変数・関数呼び出し・
 * 埋め込みのあるテンプレート文字列等) `dynamic` に入れる。dynamic は manifest との
 * 突き合わせができないので、呼び出し側がエラーにする。
 */
export function scanSource(
  file: string,
  source: string,
): { usages: Usage[]; dynamic: { file: string; line: number }[] } {
  const usages: Usage[] = [];
  const dynamic: { file: string; line: number }[] = [];

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === SLOT_ID_ATTRIBUTE
    ) {
      const init = node.initializer;
      let literal: string | undefined;

      if (init && ts.isStringLiteral(init)) {
        // slotId="site:top:hero-01"
        literal = init.text;
      } else if (init && ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression;
        // slotId={"site:top:hero-01"} / slotId={`site:top:hero-01`}
        if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
          literal = expr.text;
        }
      }

      if (literal !== undefined) {
        usages.push({ id: literal, file, line: lineOf(node) });
      } else {
        dynamic.push({ file, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { usages, dynamic };
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
      const source = readFileSync(file, 'utf8');
      // AST を組む前の足切り。slotId という語が 1 度も出ないファイルは対象外。
      if (!source.includes(SLOT_ID_ATTRIBUTE)) continue;
      const found = scanSource(file, source);
      usages.push(...found.usages);
      dynamic.push(...found.dynamic);
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
  const { usages, dynamic } = scanUsages();
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

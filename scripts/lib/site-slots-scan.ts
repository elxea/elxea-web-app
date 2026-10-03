/**
 * site-slots-scan.ts — コードから「ページの枠の使用箇所」を集める (読むだけ)。
 *
 * ページの枠の集合の正本はコードの使用箇所 (JSX 属性 `slotId` の文字列リテラルと、
 * サーバ側で枠を読む呼び出し getSiteImage / getSiteAsset の文字列リテラル)。
 * 宣言を作る側 (`scripts/gen-site-slots.ts`) と照らす側 (`scripts/check-site-slots.ts`) が
 * 同じ数え方を使うように、ここに 1 つだけ置く (見つける側と書く側で別の定義を持たない)。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..', '..');

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

/**
 * サーバ側で枠を読む関数 (lib/site-assets)。JSX の SiteImage を持たない枠 (例: 既定の共有カード
 * app/api/og-image/route.ts) は、これを枠 id の文字列リテラルで呼ぶことが「使用」になる。
 */
const SLOT_READ_CALLS: readonly string[] = ['getSiteImage', 'getSiteAsset'];

/**
 * AST を組む前の足切り。slotId 属性も、枠を読む関数の呼び出しも出てこないファイルは対象外。
 * (以前は slotId だけを見ていたので、呼び出しだけで枠を使うファイルは読まれもしなかった)
 */
export function mayUseSlots(source: string): boolean {
  return source.includes(SLOT_ID_ATTRIBUTE) || SLOT_READ_CALLS.some((n) => source.includes(`${n}(`));
}

export interface Usage {
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
    // サーバ側で枠を読む呼び出し getSiteImage("site:...") / getSiteAsset("site:...") も使用に数える
    // (JSX の SiteImage を持たない枠。例: 既定の共有カード app/api/og-image/route.ts)。
    // 文字列リテラルの id だけを数え、変数の呼び出しは数えない (dynamic にもしない)。
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SLOT_READ_CALLS.includes(node.expression.text) &&
      node.arguments.length > 0 &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      usages.push({ id: (node.arguments[0] as ts.StringLiteral).text, file, line: lineOf(node) });
    }
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
      if (!mayUseSlots(source)) continue;
      const found = scanSource(file, source);
      usages.push(...found.usages);
      dynamic.push(...found.dynamic);
    }
  }
  return { usages, dynamic };
}

/** 使用箇所から、枠 id を初めて出てきた順に重なり無しで返す。 */
export function usedSlotIds(usages: readonly Usage[]): string[] {
  return [...new Set(usages.map((u) => u.id))];
}

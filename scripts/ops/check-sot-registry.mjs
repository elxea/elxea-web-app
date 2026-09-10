#!/usr/bin/env node
// =============================================================================
// check-sot-registry.mjs — 憲章 R5「『単一正本』を自称させない」の機械強制
//
// 問題:
//   「ここが正本 (single source of truth)」という宣言は、これまで散文でしか
//   書かれていなかった。散文は 2 つ書ける。実際に書かれていた:
//
//     - lib/site-url.ts の siteUrl()      … 「基準 URL を 1 箇所で正規化して返す」
//     - lib/env.ts の getSiteUrl()        … 「The single accessor for NEXT_PUBLIC_SITE_URL」
//
//   同じ概念について両方が自分を正本と名乗り、しかも**正規化の規則が違って**
//   いた (前者は空白を全部落とし、後者は端だけ)。lib/email/dunning.ts と
//   lib/email/subscription-reminder.ts は両方を import していた。
//   どちらが正しいかは、誰も気づいていなかったので誰も決めていない。
//
// 処方:
//   正本の宣言を機械可読なタグ `@sot <concept>` にし、同じ concept が 2 箇所に
//   現れたら CI を落とす。これで「正本が 2 つある」は書いた瞬間に落ちる。
//   憲章のルール上、原則には必ず強制機構が要る (文書だけの規律は載せない)。
//
// タグの書き方:
//   宣言 … コメント行に `@sot <concept>` **だけ**を書く (行末まで他に何も無い)
//             /**
//              * @sot site-origin
//              */
//   参照 … 本文中で `` `@sot site-origin` `` のように書く。参照は重複判定の
//             対象外だが、**存在しない concept を指していたら落ちる**
//             (正本が動いたのに参照が古いまま、を検知する)。
//
//   concept は kebab-case。
//
// 使い方:
//   node scripts/ops/check-sot-registry.mjs           … docs/sot-registry.md を生成
//   node scripts/ops/check-sot-registry.mjs --check   … 検査のみ (CI)。書き込まない
//
// 判定 (--check):
//   1) 同一 concept が 2 箇所以上で宣言されている      → exit 1
//   2) 宣言の無い concept を参照している                → exit 1
//   3) docs/sot-registry.md が生成結果と食い違っている → exit 1
//      (正本の一覧そのものが drift しては意味が無いため)
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'docs', 'sot-registry.md');

/**
 * 走査対象。生成物・依存・スナップショットは入れない。
 *
 * `__tests__` と `e2e` は**意図的に外している**。正本は実装が持つものであって
 * テストが持つものではない、というのが第一の理由。第二に、この検査自体の
 * テスト (`__tests__/sot-registry.test.ts`) は「重複した宣言」「宣言の無い参照」
 * を fixture として**わざと書く**ので、テストを走査に含めると検査が自分の
 * fixture で落ちる。走査対象を実装に絞ることで両方解決する。
 */
const SCAN_DIRS = ['app', 'lib', 'components', 'scripts', 'sanity'];
const SCAN_FILES = ['middleware.ts', 'instrumentation.ts'];
const SCAN_EXT = /\.(ts|tsx|mjs|js|jsx)$/;
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'coverage', 'storybook-static', 'scratch']);

/**
 * 宣言: コメント行に `@sot <concept>` だけがある行。
 * 行末を固定しているのが要点で、これにより本文中の `` `@sot site-origin` ``
 * (参照) を拾わない。参照まで重複扱いすると、正本を説明する文章が書けなくなる。
 */
const DECLARATION = /^\s*(?:\*|\/\/|#)?\s*@sot\s+([a-z0-9][a-z0-9-]*)\s*$/;

/**
 * 宣言の 1 行形: `/** @sot <concept> *\/` を 1 行で書いたもの。
 *
 * Wave 1 QA 指摘 (2026-08-27)。上の `DECLARATION` は行末を固定しているため、
 * 1 行で閉じた JSDoc は**宣言として数えられず参照に落ちる**。結果、その概念は
 * 「参照はあるが宣言が無い」として落ちる — 書いた本人からは、正しく書いたのに
 * 検査が理解しない状態に見える。同じ意味の 2 つ目の書き方を黙って無視するのは
 * 検査の側の欠陥なので、宣言として受け付ける。
 *
 * 散文中の参照 (`` `@sot site-origin` ``) を拾わない性質は保たれる。この形は
 * 行全体がコメントの開閉で閉じていることを要求するので、文章の途中には現れない。
 */
const DECLARATION_ONE_LINE = /^\s*\/\*\*?\s*@sot\s+([a-z0-9][a-z0-9-]*)\s*\*\/\s*$/;

/**
 * 宣言のつもりで書かれたが、上の 2 形のどちらにも一致しない行。
 *
 * 行に散文が無く `@sot <何か>` だけがあるのに宣言と見なされない、というのは
 * ほぼ確実に書式の逸脱 (大文字・末尾の句読点・concept の綴りに使えない文字)。
 * 落とすほどではないが黙って参照に落とすと原因が分からないので、警告に出す。
 */
const DECLARATION_LIKE =
  /^\s*(?:\*|\/\/|\/\*\*?|#)?\s*@sot\s+([A-Za-z0-9][\w-]*)\s*[.。,、;:]?\s*(?:\*\/)?\s*$/;

/** 参照: 行のどこかに現れる `@sot <concept>`。宣言も一旦ここに含まれる。 */
const REFERENCE = /@sot\s+([a-z0-9][a-z0-9-]*)/g;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(name)) out.push(full);
  }
  return out;
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  for (const f of SCAN_FILES) {
    const full = join(ROOT, f);
    if (existsSync(full)) files.push(full);
  }
  return files.sort();
}

/** `relative()` は OS 依存の区切りを返すので、出力は必ず posix に寄せる。 */
const rel = (f) => relative(ROOT, f).split(sep).join('/');

function scan() {
  /** concept -> [{ file, line }] */
  const declarations = new Map();
  /** concept -> [{ file, line }] */
  const references = new Map();
  /** 書式逸脱の疑いがある行 (警告のみ・失敗させない) */
  const malformed = [];

  for (const file of collectFiles()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('@sot')) continue;

    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = { file: rel(file), line: i + 1 };

      const decl = line.match(DECLARATION) ?? line.match(DECLARATION_ONE_LINE);
      if (decl) {
        const concept = decl[1];
        if (!declarations.has(concept)) declarations.set(concept, []);
        declarations.get(concept).push(at);
        return; // 宣言行は参照として二重に数えない
      }

      // 宣言のつもりに見えるのに一致しなかった行を控えておく (警告用)。
      if (DECLARATION_LIKE.test(line)) malformed.push({ ...at, line_text: line.trim() });

      for (const m of line.matchAll(REFERENCE)) {
        const concept = m[1];
        if (!references.has(concept)) references.set(concept, []);
        references.get(concept).push(at);
      }
    });
  }

  return { declarations, references, malformed };
}

function renderRegistry(declarations) {
  const concepts = [...declarations.keys()].sort();
  const rows = concepts.map((c) => {
    const [at] = declarations.get(c);
    return `| \`${c}\` | \`${at.file}:${at.line}\` |`;
  });

  return [
    '# SoT Registry',
    '',
    '<!-- GENERATED FILE — do not edit by hand.',
    '     Regenerate with: node scripts/ops/check-sot-registry.mjs',
    '     Verified in CI by the same script with --check. -->',
    '',
    'このリポジトリで「ここが正本」と宣言されている概念の一覧。',
    'ソース中の `@sot <concept>` タグから生成される。',
    '',
    '同じ concept を 2 箇所で宣言すると CI (static-checks) が落ちる。',
    '正本を移すときは、宣言を新しい場所へ**移動**する (両方に置かない)。',
    '',
    `| 概念 | 正本の場所 |`,
    `| --- | --- |`,
    ...rows,
    '',
    `合計 ${concepts.length} 概念。`,
    '',
  ].join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const { declarations, references, malformed } = scan();

  const problems = [];

  // 1) 同一 concept の重複宣言
  for (const [concept, sites] of [...declarations].sort()) {
    if (sites.length > 1) {
      problems.push(
        `concept "${concept}" が ${sites.length} 箇所で正本を名乗っています:\n` +
          sites.map((s) => `      - ${s.file}:${s.line}`).join('\n') +
          `\n    → 1 箇所に決めて、他は参照 (\`@sot ${concept}\`) に書き換えてください。`
      );
    }
  }

  // 2) 宣言の無い concept への参照 (正本が動いたのに参照が古い)
  for (const [concept, sites] of [...references].sort()) {
    if (!declarations.has(concept)) {
      problems.push(
        `concept "${concept}" は参照されていますが、どこにも宣言がありません:\n` +
          sites.map((s) => `      - ${s.file}:${s.line}`).join('\n') +
          `\n    → 正本に \`@sot ${concept}\` を宣言するか、参照を直してください。`
      );
    }
  }

  const rendered = renderRegistry(declarations);

  if (!checkOnly) {
    writeFileSync(REGISTRY_PATH, rendered);
    console.log(`[check-sot-registry] wrote docs/sot-registry.md (${declarations.size} concepts)`);
  } else {
    // 3) 生成物の drift
    const current = existsSync(REGISTRY_PATH) ? readFileSync(REGISTRY_PATH, 'utf8') : null;
    if (current !== rendered) {
      problems.push(
        'docs/sot-registry.md が最新ではありません。\n' +
          '    → node scripts/ops/check-sot-registry.mjs を実行して結果をコミットしてください。'
      );
    }
  }

  // 書式逸脱の警告。宣言として数えられていない `@sot` 行を可視化する
  // (落とさない — 失敗は「重複」「未宣言参照」「drift」の 3 つに限る)。
  for (const m of malformed) {
    console.warn(
      `[check-sot-registry] WARN 宣言の書式から外れています: ${m.file}:${m.line}\n` +
        `    ${m.line_text}\n` +
        `    → 宣言は \`@sot <concept>\` だけを 1 行に書く (concept は英小文字・数字・ハイフン)。` +
        ` この行はいま参照として数えられています。`
    );
  }

  if (problems.length > 0) {
    console.error('\n[check-sot-registry] FAIL — 正本の宣言に問題があります (憲章 R5)\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }

  console.log(
    `[check-sot-registry] OK — ${declarations.size} concepts, 重複なし・未宣言参照なし`
  );
}

main();

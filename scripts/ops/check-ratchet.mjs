#!/usr/bin/env node
// =============================================================================
// check-ratchet.mjs — 例外表を「増える方向にだけ動かせない」ようにする (憲章 R8)
//
// 問題:
//   このリポジトリには逃げ道 (例外表) がいくつもある。eslint-suppressions.json、
//   各 lint ルールの ALLOWLIST / GRANDFATHERED、z-layer の免除表、
//   `expected-failure:` コメント。どれも「差分に必ず現れる」ことを担保に
//   導入されていて、それ自体は正しい。
//
//   しかし**差分に現れることと、誰かが気づくことは別**である。表に 1 行足す
//   変更は、その変更の中では最も小さく最も自然に見える。実際 Wave 1-3 の各
//   ルールは「縮小方向にのみ更新する」と**コメントで**書いてあるだけで、
//   増やしても CI は緑のままだった。憲章のルール上、原則には必ず強制機構が要る。
//
// 処方:
//   各表の件数を ratchets.json に固定し、実測と食い違ったら落とす。
//
//   **両方向に落とす**のが要点:
//     - 実測 > 上限 … 例外を増やした。これが止めたい方向。
//     - 実測 < 上限 … 例外を減らしたのに上限が下がっていない。放置すると
//                     「減らした分だけ黙って増やせる枠」が残り、ratchet が
//                     ゆるむ。減らした人が上限も下げる (コマンド 1 回)。
//
//   この「減っても落とす」形は新案ではない。`no-silent-catch-at-boundary` の
//   GRANDFATHERED が既に同じ規律で動いており (実測より多い枠を持っていると
//   ルール自身が落とす)、それを表全体に一般化したのが本スクリプトである。
//
// 使い方:
//   node scripts/ops/check-ratchet.mjs --check    … 検査のみ (CI)。書き込まない
//   node scripts/ops/check-ratchet.mjs --update   … 実測値を ratchets.json へ書く
//
// 新しい表を足すとき:
//   COUNTERS に id と数え方を書き、ratchets.json に実測値で 1 行足す。
//   数え方はこのファイルの中に閉じる (表の側に検査を埋め込まない)。
//
// CI:
//   static-checks ジョブに相乗りさせる (新規ジョブは作らない)。
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const RATCHETS_PATH = join(ROOT, 'ratchets.json');

// --- 数え方 ------------------------------------------------------------------

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

/**
 * `new Set([...])` / `new Map([...])` のリテラル要素を数える。
 *
 * 中身は行コメントだらけなので、**コメントを落としてから**数える。落とさないと
 * `// "components/foo.tsx" は移行済み` のような行を 1 件と数えてしまい、
 * 「コメントを書いただけで上限に当たる」という理不尽な失敗になる。
 */
function countCollectionEntries(source, declaration, kind) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      `[check-ratchet] "${declaration}" が見つかりません。表の名前か場所が変わっています。` +
        'ratchets.json の counter 定義を直してください (見つからないまま 0 件と数えると、' +
        '上限だけが残って検査が空回りします)。',
    );
  }
  const body = source.slice(start);

  /* 終端は形で変わる: `new Set([...])` / `new Map([...])` は `]);` で閉じ、
     素の配列リテラル (`const X = [...]`) は `];` で閉じる。
     ここを取り違えると閉じ位置が見つからず**ファイル末尾までを表として数える**。
     実際に最初の実装が z-layer の配列でそれをやり、4 件の表を 8 件と数えた。
     見つからないときは黙って全部飲まずに落とす。 */
  const terminator = kind === 'array' ? '\n];' : ']);';
  const end = body.indexOf(terminator);
  if (end === -1) {
    throw new Error(
      `[check-ratchet] "${declaration}" の終端 (${terminator.trim()}) が見つかりません。` +
        '表の書き方が変わっています。ファイル末尾までを表と誤認しないよう落とします。',
    );
  }
  const table = body.slice(0, end);

  const withoutComments = table
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  if (kind === 'map') {
    // Map の要素は `["key", value]`。
    return (withoutComments.match(/\[\s*"/g) || []).length;
  }
  // Set / 配列の要素は `"value",`。
  return (withoutComments.match(/"[^"]+"\s*,/g) || []).length;
}

/** 走査してファイルを集める (SKIP_DIR は生成物・依存)。 */
const SKIP_DIR = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'storybook-static',
  'scratch',
]);

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
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function collect(dirs, files = []) {
  const out = [];
  for (const d of dirs) walk(join(ROOT, d), out);
  for (const f of files) {
    const full = join(ROOT, f);
    if (existsSync(full)) out.push(full);
  }
  return out.sort();
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');

/** 全走査ファイルにわたって正規表現の一致数を合計する。 */
function countMatches(dirs, files, pattern) {
  let total = 0;
  for (const file of collect(dirs, files)) {
    const text = readFileSync(file, 'utf8');
    total += (text.match(pattern) || []).length;
  }
  return total;
}

/**
 * 例外表の実測値。id は ratchets.json の key と一対一。
 *
 * 数え方をここに集めているのは、**表の側に検査を書かない**ため。表の隣に
 * 数え方があると、表を増やす変更で数え方も一緒に緩められる。
 */
const COUNTERS = {
  /* suppression ファイル (eslint-suppressions.json)。件数と、それが散っている
     ファイル数の両方を見る。
     ここを `/* eslint ...` で書き始めてはいけない — ESLint はその形の
     ブロックコメントを**設定ディレクティブ**として読み、中身を JSON として
     パースしようとして落ちる (実際 1 度踏んだ)。
     件数だけだと 1 ファイルに寄せて誤魔化せるわけではないが、ファイル数は
     「どれだけ広い範囲が例外か」を別の角度で示すので両方固定する。 */
  'eslint-suppressions-total': () => {
    const table = JSON.parse(read('eslint-suppressions.json'));
    let total = 0;
    for (const rules of Object.values(table)) {
      for (const entry of Object.values(rules)) total += entry.count ?? 0;
    }
    return total;
  },
  'eslint-suppressions-files': () =>
    Object.keys(JSON.parse(read('eslint-suppressions.json'))).length,

  /* ソースに直接書く `eslint-disable`。suppressions ファイルを経由しない逃げ道で、
     こちらは `pnpm lint:prune-suppressions` の縮小対象にならないので放っておくと
     溜まる。 */
  'eslint-inline-disable': () =>
    countMatches(
      ['app', 'components', 'lib', 'sanity'],
      ['middleware.ts', 'instrumentation.ts'],
      /eslint-disable/g,
    ),

  /* 「押した瞬間に効く」の未移行画面 (憲章 Wave B)。 */
  'interaction-allowlist': () =>
    countCollectionEntries(
      read('eslint-rules/mutation-through-shared-primitive.mjs'),
      'const ALLOWLIST = new Set([',
      'set',
    ),

  /* 握り潰しの例外表 (憲章 R1 / Wave 3)。着手時 0 件で入っている。 */
  'silent-catch-grandfathered': () =>
    countCollectionEntries(
      read('eslint-rules/no-silent-catch-at-boundary.mjs'),
      'const GRANDFATHERED = new Map([',
      'map',
    ),

  /* 「失敗が答えである」と明示した catch。正当な逃げ道だが、**理由を書けば
     何でも通る**形でもあるので数を固定する。 */
  'expected-failure-escapes': () =>
    countMatches(['app', 'lib'], [], /expected-failure:/g),

  /* z 段の免除表 2 種 (design-system)。 */
  'z-layer-fixed-allowlist': () =>
    countCollectionEntries(
      read('__tests__/design-system/z-layer-scan.ts'),
      'export const FIXED_Z_ALLOWLIST = [',
      'array',
    ),
  'z-layer-pinned-exemptions': () => {
    const source = read('__tests__/design-system/z-layer-scan.ts');
    const start = source.indexOf('export const PINNED_EXEMPTIONS');
    if (start === -1) {
      throw new Error('[check-ratchet] PINNED_EXEMPTIONS が見つかりません。');
    }
    const body = source.slice(start, source.indexOf('\n];', start));
    return (body.match(/^\s{2}\{$/gm) || []).length;
  },
};

// --- 本体 --------------------------------------------------------------------

function measure() {
  const actual = {};
  for (const [id, count] of Object.entries(COUNTERS)) actual[id] = count();
  return actual;
}

function loadRatchets() {
  if (!existsSync(RATCHETS_PATH)) {
    throw new Error(
      '[check-ratchet] ratchets.json がありません。' +
        'node scripts/ops/check-ratchet.mjs --update で作ってください。',
    );
  }
  return JSON.parse(readFileSync(RATCHETS_PATH, 'utf8'));
}

/** 既存ファイルが無いときに置く $comment。あるときは既存をそのまま持ち越す。 */
const DEFAULT_COMMENT = [
  'GENERATED-ASSISTED FILE — max は scripts/ops/check-ratchet.mjs --update が書く。',
  'source / why は人が書く (何の表で、なぜ例外が要るのか)。',
  'max を手で増やすだけの変更は、例外を増やしたことの申告である。',
  '検査は両方向: 増えたら落ちる (例外を足した) / 減ったのに max が残っていても落ちる',
  '(緩んだ枠を残すと、その分だけ黙って増やせる)。',
];

/**
 * `--update` の書き戻し。**人が書いたものを 1 文字も落とさない**。
 *
 * 初版は `{ max, source, why }` の 3 つだけを組み立て直して書いていた。つまり
 * `--update` を 1 回走らせるだけで、
 *
 *   - 各エントリの `note` (なぜその件数になったのかの経緯。`eslint-inline-disable`
 *     には Edge バンドルの事情が 5 行ぶん書いてある)
 *   - `$comment` の 4〜5 行目 (両方向検査の説明)
 *
 * が**黙って消えていた**。しかも消えるのは「表を減らしたので --update してね」と
 * スクリプト自身が指示した直後で、消えたことはエラーにならない。例外の件数は
 * 守っておきながら、**なぜ例外なのかの記録のほうを機械が捨てる**という、この
 * 仕組みが最も嫌う形の失敗になっていた (憲章 R8)。
 *
 * よって書き戻しは「既存エントリをそのまま持ち、`max` だけ実測に差し替える」形に
 * する。新しい表が増えたときだけ `source` / `why` の空欄を用意する (人が埋める)。
 */
function render(entries, actual, existingComment) {
  const ordered = {};
  for (const id of Object.keys(COUNTERS).sort()) {
    const previous = entries[id];
    ordered[id] = previous
      ? { ...previous, max: actual[id] }
      : { max: actual[id], source: '', why: '' };
  }
  return `${JSON.stringify(
    {
      $comment:
        Array.isArray(existingComment) && existingComment.length > 0
          ? existingComment
          : DEFAULT_COMMENT,
      ratchets: ordered,
    },
    null,
    2,
  )}\n`;
}

function main() {
  const update = process.argv.includes('--update');
  const actual = measure();

  if (update) {
    const previous = existsSync(RATCHETS_PATH) ? loadRatchets() : {};
    const existing = previous.ratchets ?? {};
    writeFileSync(RATCHETS_PATH, render(existing, actual, previous.$comment));
    console.log(`[check-ratchet] wrote ratchets.json (${Object.keys(actual).length} entries)`);
    for (const [id, n] of Object.entries(actual)) console.log(`  ${id} = ${n}`);
    return;
  }

  const { ratchets } = loadRatchets();
  const problems = [];

  for (const [id, n] of Object.entries(actual)) {
    const entry = ratchets[id];
    if (!entry) {
      problems.push(
        `"${id}" が ratchets.json にありません (実測 ${n} 件)。\n` +
          '    → node scripts/ops/check-ratchet.mjs --update で追加してください。',
      );
      continue;
    }
    if (n > entry.max) {
      problems.push(
        `"${id}" の例外が増えています: 実測 ${n} 件 / 上限 ${entry.max} 件 (+${n - entry.max})。\n` +
          `      表: ${entry.source}\n` +
          '    → 例外を足すのではなく直してください。どうしても要るなら\n' +
          '      node scripts/ops/check-ratchet.mjs --update で上限を上げ、\n' +
          '      なぜ必要かを PR 本文に書いてください (上限を上げた差分は必ずレビューに乗ります)。',
      );
    } else if (n < entry.max) {
      problems.push(
        `"${id}" の上限が実測より緩んでいます: 実測 ${n} 件 / 上限 ${entry.max} 件 (-${entry.max - n})。\n` +
          `      表: ${entry.source}\n` +
          '    → 減らしたぶん上限も下げます。node scripts/ops/check-ratchet.mjs --update を実行して\n' +
          '      結果をコミットしてください。緩んだ枠を残すと、その分だけ黙って増やせてしまいます。',
      );
    }
  }

  /* ratchets.json にあるが COUNTERS から消えた id。数え方だけ消せば上限が
     形骸化するので、これも落とす。 */
  for (const id of Object.keys(ratchets)) {
    if (!(id in actual)) {
      problems.push(
        `"${id}" は ratchets.json にありますが、数え方 (COUNTERS) がありません。\n` +
          '    → 表ごと無くなったなら ratchets.json からも消す。まだあるなら\n' +
          '      scripts/ops/check-ratchet.mjs の COUNTERS に数え方を戻してください。',
      );
    }
  }

  const table = Object.keys(actual)
    .sort()
    .map((id) => `  ${id.padEnd(30)} ${String(actual[id]).padStart(4)} / ${ratchets[id]?.max ?? '-'}`)
    .join('\n');

  if (problems.length > 0) {
    console.error('\n[check-ratchet] FAIL — 例外表の件数が固定値と合いません (憲章 R8)\n');
    console.error(`${table}\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }

  console.log('[check-ratchet] OK — 例外表は全て固定値どおり\n');
  console.log(table);
}

main();

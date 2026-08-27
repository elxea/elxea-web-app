#!/usr/bin/env node
// =============================================================================
// generate-interaction-inventory.mjs — 憲章 R9「押せるものは、全部台帳に載る」
//
// ■ id
//   R9
//
// ■ 一言
//   ユーザーが押せる操作は、**応答の出し方を宣言した台帳に必ず載る**。
//   載っていない操作は作れない。
//
// ■ 実障害 (これが無くて起きたこと)
//   1. **商品画像カルーセル** (G1) — サムネイルを押すと `setSelected` は即時に
//      走るが、`<Image>` は同じ DOM のまま `src` が差し替わるだけなので、**未取得の
//      URL を取り終わるまで見た目は旧画像のまま**だった。先読みは皆無
//      (`preload` / `prefetch` / `new Image` の一致数が 0)。これは書き込みではない
//      ので `mutation-through-shared-primitive` の母集団に入らず、
//      `interactive-instant-controls.test.ts` の手書き 3 ファイルにも無い。
//      **一度も数えられたことがない操作**だった。
//   2. **カート数量の合計金額** (G2) — `cartReducer` は `totalQuantity` と
//      `lines[].quantity` だけを書き換え、`cost.*` を触らない。しかし画面は
//      `item.cost.totalAmount` / `cart.cost.subtotalAmount` / `cart.cost.totalAmount`
//      を描いている。結果、数量は本番実測 16〜75ms で動くのに金額は
//      **2,139〜2,417ms** 古いまま ——「2 個になっているのに 1 個ぶんの金額」。
//      `cart-context.tsx` は共通機構を正しく通っているので lint は緑、
//      `disabled={isPending}` の字面しか見ないテストも緑だった。
//      **「通っているか」は検査されるが「楽観更新が画面の描く項目を覆っているか」は
//      誰も検査していなかった。**
//
// ■ 強制機構 (このファイル)
//   `app/ components/ lib/ hooks/` を **TypeScript の parser で** 走査し、
//   「ユーザーが押せるもの」5 種を抽出して `interaction-inventory.json` を作る。
//   **拡張子と配置で絞らない** (`.ts` へ切り出して監査から消える逃げ道を作らない)。
//   各行は `response` の宣言を必須とし、`optimistic` / `sync-dom` は `observe`
//   (その操作で必ず更新される要素) も必須。欠けた行があれば `--check` が落ちる。
//   生成物はコミットし、実体とずれても落ちる (`check-sot-registry.mjs` と同じ作法)。
//
// ■ 例外表
//   `interaction-inventory.json` の各行の `exempt` のみ。**新しい表は作らない** —
//   件数は既存の `ratchets.json` に `interaction-unclassified` (max 0) と
//   `interaction-exempt` として乗せ、両方向検査 (増えたら落ちる / 減ったのに
//   max が残っていても落ちる) をそのまま継承する。
//
// ■ 配線 assert
//   `__tests__/interaction-inventory.test.ts` が (1) 生成物が実体と同期している
//   (2) 未分類 0 件 (3) e2e が台帳を実際に読んでいる (4) CI の static-checks に
//   `check:interactions` が入っている を検査する。`ratchet.test.ts` と同じく
//   **壊した入力で確実に落ちること**を使い捨てツリーで確かめる。
//
// =============================================================================
//
// ## 台帳に載せる 5 種と、なぜ 5 種なのか
//
// 初版の抽出仕様は (a) JSX の `on*` と (b) 書き込み呼び出しの 2 種だった。
// **それでは網羅表自身が挙げた G6 が台帳に載らない** — 「さらに N 件を表示」
// (`components/catalog/catalog-list.tsx`) は `<Link href={href}>` という
// **ハンドラを 1 つも持たない素の Link** だからである。同じ理由で
// `<form action={serverAction}>` と `addEventListener` も漏れる。
// 自分で見つけた穴を自分の仕様が塞げていないので、5 種に広げてある。
//
//   (a) handler  … JSX の `on*` 属性
//   (b) write    … 書き込み呼び出し (fetch の書き込みメソッド / Server Action)
//   (c) link     … 内部 href を持つ `<Link>` / `<a>` (外部・mailto: ・tel: は除外)
//   (d) form     … `<form action={...}>` の Server Action 参照
//   (e) listener … client 側の `addEventListener` (JSX を経由しない操作)
//
// (d) は現状 0 件だが、`useActionState` へ寄せた瞬間に書き込みが丸ごと台帳から
// 消えるので、**ゼロのうちに塞ぐ**。
//
// ## 行に `line` を持たせない理由
//
// 行番号を台帳に持つと、**無関係な編集のたびに生成物が変わって `--check` が落ちる**。
// そうなるとレビューは「また行番号だけの差分か」で流し読みになり、本当に操作が
// 増えた差分が同じ見た目に埋もれる。台帳が守りたいのは「押せるものが増えたか」で
// あって「何行目にあるか」ではないので、`id` は行番号を含まない形にし、行番号は
// CLI の出力にだけ出す (人が探すときに使う)。
//
// ## 内部リンクの既定 (Boss 確定 2026-08-27)
//
// 内部リンクは 150 本超あり、全部を手で分類させると第 1 段の導入自体が頓挫する。
// よって **`response: "router-nav"` + `exempt` を自動付与**し、
// **ページ内の見た目が変わる遷移だけを分類必須**にする:
//
//   - クエリ付き (`?`) … 同じページの絞り込み・並び替え・追加表示。G6 はここ。
//   - 同一ルート内 (`#` だけ / 現在のパスと同じ) … ページ内移動。
//
// `href` が静的に読めない (変数・テンプレート) ときは **安全側 = 分類必須**。
// 「読めないから除外」にすると、動的な href に逃がすだけで台帳から消せてしまう。
// =============================================================================

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/* TypeScript 自身の parser を使う。`.ts` / `.tsx` を追加依存なしで読めるのは
   これだけで、しかも tsc と同じ構文解釈になる (別の parser を足すと「tsc は
   通るのに台帳生成だけ落ちる」がいずれ起きる)。 */
const ts = require('typescript');

const ROOT = process.cwd();
const INVENTORY_PATH = join(ROOT, 'interaction-inventory.json');

/** 走査の起点。「画面から押せるもの」が置かれうる場所すべて。 */
const ROOTS = ['app', 'components', 'lib', 'hooks'];

const SKIP_DIR = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'coverage',
  'storybook-static',
  'backup-before-cleanup',
  'playwright-report',
  'test-results',
]);

/** 画面ではないもの。 */
const NOT_SOURCE = /\.(d\.ts|test\.tsx?|stories\.tsx?)$/;

/** 応答の出し方。`mutation-classes.ts` の 3 分類 + 表示切替の 4 種。 */
export const RESPONSE_KINDS = [
  /* 書き込みの 3 分類 (正本: lib/interaction/mutation-classes.ts) */
  'optimistic',
  'pessimistic-commit',
  'pessimistic-form',
  /* 表示切替 (書き込みではない操作) */
  'sync-dom', // React state → 即再描画。ネットワークに依存しない
  'router-nav', // router.push/replace / Link。RSC 往復してから視覚変化
  'asset-load', // 画像・音声など未取得 URL の取得完了待ち
  'async-fetch', // ハンドラ内で fetch を await してから視覚変化
  'fire-and-forget', // 計測など。画面は何も待たない
];

/** `observe` (更新される要素) の宣言が必須になる応答。 */
const NEEDS_OBSERVE = new Set(['optimistic', 'sync-dom']);

const toPosix = (p) => p.replace(/\\/g, '/');

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !NOT_SOURCE.test(name)) out.push(full);
  }
  return out;
}

function sourceFiles() {
  const out = [];
  for (const dir of ROOTS) walk(join(ROOT, dir), out);
  return out.sort();
}

const rel = (f) => toPosix(relative(ROOT, f).split(sep).join('/'));

/* -------------------------------------------------------------------------- */
/* 抽出                                                                        */
/* -------------------------------------------------------------------------- */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACTION_MODULE = /^@\/lib\/.*(-actions|\/actions)$/;

/** 外部・メール・電話。ページ内の状態を変える遷移ではない。 */
const EXTERNAL_HREF = /^(https?:|mailto:|tel:|\/\/)/;

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) return literalText(node.expression);
  return null;
}

function attributeNamed(element, name) {
  const attrs = ts.isJsxSelfClosingElement(element)
    ? element.attributes
    : element.openingElement.attributes;
  for (const attr of attrs.properties) {
    if (ts.isJsxAttribute(attr) && attr.name.getText() === name) return attr;
  }
  return null;
}

function tagNameOf(element) {
  const opening = ts.isJsxSelfClosingElement(element) ? element : element.openingElement;
  return opening.tagName.getText();
}

/**
 * 1 ファイルから「押せるもの」を抜き出す。
 *
 * 呼び出し位置は見ない。`onClick={() => act()}` と `async function handle()` は
 * 同じことなので、**書き方の違いで台帳から漏れないように**構文の形で拾う。
 */
function extract(file, text, isBrowserSide) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const relPath = rel(file);
  const rows = [];
  /** 同じ (kind, name) がファイル内で何度目か。行番号の代わりの安定した目印。 */
  const seen = new Map();

  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  function push(kind, name, node, extra = {}) {
    const key = `${kind}:${name}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    rows.push({
      id: `${relPath}#${kind}:${name}#${n}`,
      file: relPath,
      kind,
      name,
      line: lineOf(node),
      ...extra,
    });
  }

  /** import された Server Action の名前。 */
  const actionNames = new Set();
  source.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const from = literalText(node.moduleSpecifier);
    if (!from || !ACTION_MODULE.test(from)) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const spec of bindings.elements) actionNames.add(spec.name.getText());
    }
  });

  function visit(node) {
    /* (a) JSX の on* ハンドラ属性 --------------------------------------- */
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = attr.name.getText();
        if (!/^on[A-Z]/.test(name)) continue;
        push('handler', name, attr, { element: node.tagName.getText() });
      }
    }

    /* (c) 内部 href を持つ Link / a -------------------------------------- */
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      const tag = tagNameOf(node);
      if (tag === 'Link' || tag === 'a') {
        const href = attributeNamed(node, 'href');
        if (href) {
          const value = literalText(href.initializer);
          const isStatic = value !== null;
          if (!isStatic || !EXTERNAL_HREF.test(value)) {
            push('link', tag, href, {
              href: isStatic ? value : null,
              /* 静的に読めない href は「読めない」と台帳に残す。除外にすると
                 変数へ逃がすだけで消せてしまうので、安全側 = 分類必須。 */
              dynamic: !isStatic,
            });
          }
        }
      }

      /* (d) <form action={...}> ------------------------------------------ */
      if (tag === 'form') {
        const action = attributeNamed(node, 'action');
        if (action && action.initializer && ts.isJsxExpression(action.initializer)) {
          push('form', 'action', action, {
            action: action.initializer.expression?.getText() ?? null,
          });
        }
      }
    }

    /* (b) 書き込み呼び出し ---------------------------------------------- */
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'fetch') {
        const init = node.arguments[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const prop of init.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            if (prop.name.getText().replace(/["']/g, '') !== 'method') continue;
            const method = literalText(prop.initializer);
            if (method && WRITE_METHODS.has(method.toUpperCase())) {
              push('write', `fetch:${method.toUpperCase()}`, node, {
                url: literalText(node.arguments[0]),
              });
            }
          }
        }
      }
      if (ts.isIdentifier(callee) && actionNames.has(callee.text)) {
        push('write', `action:${callee.text}`, node);
      }

      /* (e) client 側の addEventListener ---------------------------------- */
      if (
        isBrowserSide &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.getText() === 'addEventListener'
      ) {
        const eventName = literalText(node.arguments[0]) ?? 'unknown';
        push('listener', eventName, node, { target: callee.expression.getText() });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* 内部リンクの既定分類                                                          */
/* -------------------------------------------------------------------------- */

/**
 * その内部リンクは「ページを移る」だけか、「ページ内の見た目が変わる」か。
 *
 * 前者は自動 exempt にする (150 本超を全部手で分類させると導入が頓挫する)。
 * 後者は **分類必須** — 絞り込み・並び替え・追加表示は、押した瞬間に何かが
 * 変わって見えるべき操作で、G6 (「さらに N 件を表示」) がまさにこれ。
 */
function classifyLink(row) {
  if (row.dynamic) {
    /* href が静的に読めない。安全側に倒して分類必須にする。 */
    return null;
  }
  const href = row.href ?? '';
  if (href.startsWith('#') || href.includes('?')) {
    /* ページ内移動 / クエリ遷移 = 同じ画面の中身が変わる。 */
    return null;
  }
  return {
    response: 'router-nav',
    exempt: '別ページへの遷移のみ (ページ内の見た目は変わらない)',
  };
}

/* -------------------------------------------------------------------------- */
/* ブラウザ到達可能性 (eslint 側と同じ判定を使う)                                 */
/* -------------------------------------------------------------------------- */

const { isBrowserReachable } = await import(
  new URL('../../eslint-rules/lib/browser-reachable.mjs', import.meta.url).href
);

/* -------------------------------------------------------------------------- */
/* 台帳の組み立て                                                                */
/* -------------------------------------------------------------------------- */

/** 実体から作った素の行 (宣言は入っていない)。 */
function measure() {
  const rows = [];
  for (const file of sourceFiles()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const relPath = rel(file);
    const browserSide =
      /^\s*["']use client["']/m.test(text) || isBrowserReachable(ROOT, relPath);
    rows.push(...extract(file, text, browserSide));
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 既存の宣言 (`response` / `observe` / `exempt` / `why`) を id で引く。 */
function loadDeclarations() {
  if (!existsSync(INVENTORY_PATH)) return new Map();
  const parsed = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
  return new Map((parsed.interactions ?? []).map((row) => [row.id, row]));
}

const DECLARED_FIELDS = ['response', 'observe', 'exempt', 'why'];

/**
 * 導入時の据え置き。**憲章 R9 を入れた時点で既にあった操作**という意味しか持たない。
 *
 * 段階導入の理由 (網羅表 §7): 機構と実際の遅さを一度に入れると、機構の不具合と
 * プロダクトの遅さの区別がつかないまま大量の赤に埋もれる。先に「増えない」を
 * 確定させ、次に「減らす」に入る。減った分は ratchet が上限の引き下げを強制する。
 */
const BASELINE_REASON =
  '第1段の据え置き — 憲章 R9 導入時点で既にあった操作。増加をゼロで止めることを先に確定させ、分類は段階的に外す';

const SEED_BASELINE = process.argv.includes('--seed-baseline');

/**
 * 実体 + 既存の宣言を突き合わせて台帳を作る。
 *
 * **人が書いた宣言は 1 文字も落とさない** (`check-ratchet.mjs --update` が
 * `note` を黙って捨てていたのと同じ失敗を繰り返さない)。
 */
function build() {
  const declarations = loadDeclarations();
  return measure().map((row) => {
    const previous = declarations.get(row.id);
    const out = {
      id: row.id,
      file: row.file,
      kind: row.kind,
      name: row.name,
    };

    if (previous) {
      for (const field of DECLARED_FIELDS) {
        if (previous[field] !== undefined) out[field] = previous[field];
      }
    } else if (row.kind === 'link') {
      /* 新しく現れた内部リンクだけは既定を自動で付ける (前述)。 */
      const auto = classifyLink(row);
      if (auto) Object.assign(out, auto);
    }

    /* 第 1 段の据え置き。**導入時に 1 回だけ**使う (`--seed-baseline`)。
       ここを常時 on にすると新しい操作まで自動で exempt になり、台帳が
       「増えない」ではなく「何も言わない」になる。誤って再実行しても
       `interaction-exempt` の ratchet が増加を検知して落ちる。 */
    if (SEED_BASELINE && !out.response && !out.exempt) {
      out.exempt = BASELINE_REASON;
    }
    return out;
  });
}

/** 宣言が足りない行。`--check` はここが空でないと落ちる。 */
function unclassified(interactions) {
  return interactions.filter((row) => {
    if (row.exempt) return false;
    if (!row.response) return true;
    if (!RESPONSE_KINDS.includes(row.response)) return true;
    if (NEEDS_OBSERVE.has(row.response)) {
      return !Array.isArray(row.observe) || row.observe.length === 0;
    }
    return false;
  });
}

/**
 * `exempt` の行が形として成立しているか (QA 指摘の明確化 / rev.2)。
 *
 * ## exempt 行の必須項目 (仕様の明確化)
 *
 * `exempt` は「**この操作は応答を検査しない**」の申告である。よって:
 *
 *   - **理由の文字列が必須**。`true` や空文字は不可 — それを許すと
 *     `"exempt": true` と書くだけで台帳から消せてしまい、逃げ道が
 *     「差分に必ず現れる」だけの、中身の無いものになる。
 *   - **`response` / `observe` は不要**。応答を検査しないと宣言した行に
 *     応答の宣言を求めるのは矛盾で、実際それを required にすると第 1 段の
 *     据え置き (既存 400 件超) が原理的に書けなくなる。
 *   - ただし `response` を**書いてもよい** (内部リンクの自動分類は
 *     `router-nav` + exempt を両方持つ)。書いた場合は正しい値であること。
 */
function malformedExempt(interactions) {
  return interactions.filter((row) => {
    /* `'exempt' in row` で見る。`row.exempt` の真偽で見ると `"exempt": ""` が
       「exempt を持たない」と読まれ、**形が不正なことを指摘できない**まま
       「宣言が無い」という遠い理由で落ちる。原因の近くで落とす。 */
    if (!('exempt' in row) || row.exempt === undefined) return false;
    if (typeof row.exempt !== 'string' || row.exempt.trim().length === 0) return true;
    if (row.response !== undefined && !RESPONSE_KINDS.includes(row.response)) return true;
    return false;
  });
}

function render(interactions) {
  return `${JSON.stringify(
    {
      $comment: [
        'GENERATED-ASSISTED FILE — 行の集合は scripts/ops/generate-interaction-inventory.mjs が書く。',
        'response / observe / exempt / why は人が書く (応答の出し方と、何が更新されるか)。',
        'observe は「その操作で必ず更新される要素」。optimistic / sync-dom では必須。',
        'exempt は「この操作は応答を検査しない」の申告。理由の文字列が必須で、response も残す。',
        '行番号は持たない (無関係な編集で差分が出ると、本当に操作が増えた差分が埋もれるため)。',
        '件数の固定は ratchets.json (interaction-unclassified / interaction-exempt)。',
      ],
      interactions,
    },
    null,
    2,
  )}\n`;
}

/* -------------------------------------------------------------------------- */
/* 本体                                                                         */
/* -------------------------------------------------------------------------- */

function summarize(interactions) {
  const byKind = {};
  for (const row of interactions) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  return Object.keys(byKind)
    .sort()
    .map((k) => `  ${k.padEnd(10)} ${String(byKind[k]).padStart(4)}`)
    .join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const interactions = build();

  if (!check) {
    writeFileSync(INVENTORY_PATH, render(interactions));
    console.log(`[interaction-inventory] wrote ${interactions.length} 件`);
    console.log(summarize(interactions));
    const rest = unclassified(interactions);
    if (rest.length > 0) {
      console.log(`\n  未分類 ${rest.length} 件 — response / observe を宣言してください:`);
      for (const row of rest.slice(0, 20)) console.log(`    ${row.id}`);
      if (rest.length > 20) console.log(`    ... 他 ${rest.length - 20} 件`);
    }
    return;
  }

  const problems = [];

  if (!existsSync(INVENTORY_PATH)) {
    console.error(
      '[interaction-inventory] FAIL — interaction-inventory.json がありません。\n' +
        '  → node scripts/ops/generate-interaction-inventory.mjs で作ってください。',
    );
    process.exit(1);
  }

  /* (1) 生成物が実体と同期しているか。**行の集合**で見る。 */
  const committed = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')).interactions ?? [];
  const committedIds = new Set(committed.map((r) => r.id));
  const actualIds = new Set(interactions.map((r) => r.id));

  const added = [...actualIds].filter((id) => !committedIds.has(id)).sort();
  const removed = [...committedIds].filter((id) => !actualIds.has(id)).sort();

  if (added.length > 0) {
    problems.push(
      `台帳に無い操作が ${added.length} 件あります (押せるものが増えました):\n` +
        added.map((id) => `      + ${id}`).join('\n') +
        '\n    → node scripts/ops/generate-interaction-inventory.mjs を実行し、\n' +
        '      増えた行に response (と observe) を宣言してコミットしてください。',
    );
  }
  if (removed.length > 0) {
    problems.push(
      `台帳にあるのに実体が無い操作が ${removed.length} 件あります:\n` +
        removed.map((id) => `      - ${id}`).join('\n') +
        '\n    → node scripts/ops/generate-interaction-inventory.mjs を実行して\n' +
        '      結果をコミットしてください (消えた操作の宣言を残すと台帳が嘘になります)。',
    );
  }

  /* (2) 未分類 0 件。 */
  const rest = unclassified(committed);
  if (rest.length > 0) {
    problems.push(
      `応答の宣言が無い操作が ${rest.length} 件あります:\n` +
        rest.map((r) => `      ? ${r.id}`).join('\n') +
        `\n    → response を ${RESPONSE_KINDS.join(' / ')} から選び、\n` +
        '      optimistic / sync-dom なら observe (更新される要素) も書いてください。',
    );
  }

  /* (3) exempt の形。理由の無い exempt は台帳を素通りする穴になる。 */
  const bad = malformedExempt(committed);
  if (bad.length > 0) {
    problems.push(
      `exempt の形が不正な行が ${bad.length} 件あります:\n` +
        bad.map((r) => `      ! ${r.id}`).join('\n') +
        '\n    → exempt は理由の文字列 (空文字・true は不可)。response も併記します。',
    );
  }

  if (problems.length > 0) {
    console.error('\n[interaction-inventory] FAIL — 台帳と実体が合いません (憲章 R9)\n');
    console.error(`${summarize(interactions)}\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }

  console.log(`[interaction-inventory] OK — ${committed.length} 件、未分類 0 件\n`);
  console.log(summarize(interactions));
}

main();

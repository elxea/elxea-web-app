/**
 * 「その `router.push` は共通の通り道を通っているか」を **AST で** 判定する。
 *
 * ## なぜ正規表現をやめたのか (敵対 QA 指摘 M4 / 2026-08-27)
 *
 * 初版の判定はこうだった:
 *
 *     /on[A-Z]\w*=\{(?:(?!\.navigate\()[^}])*?\brouter\.(push|replace)\s*\(/
 *
 * 「`on*={` から `router.push(` までのあいだに `.navigate(` が無ければ違反」。
 * ところが `[^}]` は **`}` を跨げない**ので、ハンドラを名前付き関数に切り出すと
 * 判定の視界から外れる:
 *
 *     export function Sneak() {
 *       const nav = useOptimisticNavigation();   // import は残っている
 *       function go() {
 *         router.push("/x");                     // ← 直の遷移。regex は届かない
 *       }
 *       return <button onClick={go}>x</button>;  // ← ここには push が無い
 *     }
 *
 * これで **10/10 pass**。`import` の有無しか見ていない条件も同時に満たすので、
 * 「通り道を通している」と申告しながら通っていない状態が緑になる。
 * QA が実証した。regex を足し引きしても、次は 2 段の入れ子で抜けられる —
 * **括弧の対応を数えられない道具で括弧の対応を判定している**のが根本原因なので、
 * 構文木で見る側へ移す。
 *
 * ## 何を見るか
 *
 * `router.push(...)` / `router.replace(...)` の呼び出しごとに、**その呼び出しを
 * 囲んでいる祖先に `.navigate(...)` の呼び出しがあるか**を見る。
 *
 *   - `onClick={() => nav.navigate(v, () => router.push(...))}` … 祖先に居る → OK
 *   - `function go() { router.push(...) }` … 祖先に居ない → 違反
 *   - 何段入れ子にしても、名前付き関数へ出しても、判定は変わらない
 *
 * 行の切り出し方・書き方の違いで結果が変わらないことが要点で、
 * これは `mutation-through-shared-primitive` が「呼び出し位置は見ない」と
 * している理由と同じ (書き方の違いで逃げられないようにする)。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** 遷移とみなす呼び出し。 */
const NAV_METHODS = new Set(['push', 'replace']);

/** 共通の通り道の入口。 */
const GATEWAY_METHOD = 'navigate';

/**
 * `x.y(...)` の形の呼び出しで、`y` が `name` か。
 * レシーバの名前は見ない (`nav` / `navigation` / `this.nav` などを許す)。
 */
function isMethodCall(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.getText() === name
  );
}

/** `router.push(...)` / `router.replace(...)` か。 */
function isRouterNavigation(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!NAV_METHODS.has(callee.name.getText())) return false;
  /* レシーバ名は `router` に限る。`array.push` を遷移と数えないため。 */
  return /(^|\.)router$/.test(callee.expression.getText());
}

/**
 * 通り道を通っていない `router.push` / `router.replace` を返す。
 *
 * @returns {{ line: number, text: string }[]} 1-origin の行番号と呼び出しの字面
 */
export function findDirectNavigations(filename, sourceText) {
  const source = ts.createSourceFile(
    filename,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const offenders = [];

  function enclosedByGateway(node) {
    for (let cur = node.parent; cur; cur = cur.parent) {
      if (isMethodCall(cur, GATEWAY_METHOD)) return true;
    }
    return false;
  }

  (function visit(node) {
    if (isRouterNavigation(node) && !enclosedByGateway(node)) {
      offenders.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.getText().split('\n')[0].slice(0, 100),
      });
    }
    ts.forEachChild(node, visit);
  })(source);

  return offenders;
}

/** そのファイルは遷移を起こすか (通り道の内外を問わない)。 */
export function navigatesOnGestureAst(filename, sourceText) {
  const source = ts.createSourceFile(
    filename,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;
  (function visit(node) {
    if (found) return;
    if (isRouterNavigation(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  })(source);
  return found;
}

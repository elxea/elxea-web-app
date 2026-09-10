/**
 * cookie-name-through-registry — 生の cookie 名文字列を止める (憲章 R5 / R8)。
 *
 * ## 何を止めるのか
 *
 * `cookies.get("shop_at")` のように **cookie の名前を文字列で直接書くこと**。
 * 名前は `lib/auth/cookie-names.ts` (`@sot cookie-name-registry`) の
 * `COOKIE_NAME` から引く。
 *
 * ## なぜ規律ではなく lint なのか
 *
 * レジストリ自体は 2026-08-18 の logout 事故 (Domain 付き cookie を host-only で
 * 消していて消えていなかった) の処方として既に存在していた。ところが着手時点で
 * 実際にレジストリを通っていたのは 26 本中 13 本で、残り 13 本
 * (`shop_cv` `shop_state` `shop_nonce` `shop_locale` `shop_return_to`
 * `shop_oauth` `line_oauth_nonce` `line_link_intent` `chat_session_id`
 * `site_auth` `shopify_cart_id` `sidebar_state` `cookie_consent`) は
 * 呼び出し側に生文字列のまま散っていた。
 *
 * 既存の `__tests__/auth-cookie-registry.test.ts` は「**知らない名前**を set して
 * いないか」を見る検査で、「知っている名前を生で書くこと」は通す。だから
 * 「レジストリを作った」だけでは再流入が止まらない — 憲章 R8 の指す失敗型そのもの。
 * 移行 (全 13 本) と再流入止め (このルール) を 1 セットで入れる。
 *
 * ## 名前の一覧をどこから取るか
 *
 * **このファイルには cookie 名を 1 つも書かない。** 書くと正本が 2 つになり、
 * このルールが止めたい状態をルール自身が作ることになる (憲章 R5)。
 * `lib/auth/cookie-names.ts` を読んで抽出する。
 *
 * eslint のルールは `.mjs` なので TypeScript を import できない。よってソースを
 * 読んで正規表現で拾う。**抽出が 0 件なら throw する** — 0 件のまま黙って動くと
 * 「何も報告しないルール」= 常に緑になり、緑が「違反が無い」ではなく
 * 「見ていない」を意味する状態になるため。`__tests__/cookie-name-registry.test.ts`
 * が、抽出結果が実際の `COOKIE_REGISTRY` と一致することを固定している。
 *
 * ## 逃げ道
 *
 * `lib/auth/cookie-names.ts` と `lib/auth/cookies.ts` だけが名前を書ける
 * (eslint.config.mjs の `ignores`)。それ以外に例外表は用意しない — 着手時点で
 * 残件 0 なので、必要になった試しがまだ無い。
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 名前の正本。ここを動かすときは `@sot cookie-name-registry` ごと動かす。 */
export const REGISTRY_SOURCE = resolve(join(HERE, "..", "lib", "auth", "cookie-names.ts"));

/**
 * `COOKIE_REGISTRY` の `{ name: "..." }` と `COOKIE_NAME` の値の両方を拾う。
 *
 * 2 つの形を両方見るのは冗長に見えるが、片方だけだと「レジストリには居るが
 * `COOKIE_NAME` に名前が無い cookie」を取りこぼす。実際 Wave 4 以前はその状態
 * だった。取りこぼした名前は生で書き放題になるので、和集合で持つ。
 */
function extractCookieNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/\bname:\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  const table = source.match(/export const COOKIE_NAME = \{([\s\S]*?)\n\} as const;/);
  if (table) {
    for (const m of table[1].matchAll(/:\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return names;
}

const COOKIE_NAMES = extractCookieNames(readFileSync(REGISTRY_SOURCE, "utf8"));

if (COOKIE_NAMES.size === 0) {
  throw new Error(
    `[cookie-name-through-registry] ${REGISTRY_SOURCE} から cookie 名を 1 つも抽出できませんでした。` +
      "レジストリの書き方が変わったか、ファイルが移動しています。" +
      "0 件のまま動かすと、このルールは何も報告しない = CI の緑が「違反なし」ではなく" +
      "「見ていない」を意味してしまうため、起動時に落とします。",
  );
}

/** 名前が生で書かれている node を報告する。 */
function checkLiteral(context, node, value) {
  if (typeof value !== "string" || !COOKIE_NAMES.has(value)) return;
  context.report({
    node,
    messageId: "rawCookieName",
    data: { name: value },
  });
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "cookie の名前は lib/auth/cookie-names.ts の COOKIE_NAME から引く (生文字列を書かない)",
      recommended: true,
    },
    schema: [],
    messages: {
      rawCookieName:
        "cookie 名 '{{name}}' を文字列で直接書かないこと。" +
        "`import { COOKIE_NAME } from \"@/lib/auth/cookie-names\"` して " +
        "`COOKIE_NAME.<名前>` を使う。" +
        "名前が 2 か所に書かれていると、片方だけ直したときに " +
        "「発行はするが消えない」cookie ができる (2026-08-18 の logout 事故)。" +
        "新しい cookie なら先に lib/auth/cookie-names.ts へ登録すること。",
    },
  },
  create(context) {
    return {
      Literal(node) {
        checkLiteral(context, node, node.value);
      },
      TemplateLiteral(node) {
        /* `` `shop_at` `` のような置換なしテンプレートも同じ扱い。置換ありは
         * 名前が実行時に決まるので、この形では判定できない (別の検査
         * `__tests__/auth-cookie-registry.test.ts` が「解決できない名前」として
         * 報告する)。 */
        if (node.expressions.length > 0) return;
        if (node.quasis.length !== 1) return;
        checkLiteral(context, node, node.quasis[0].value.cooked);
      },
    };
  },
};

export default rule;

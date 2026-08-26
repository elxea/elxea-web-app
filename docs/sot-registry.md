# SoT Registry

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node scripts/ops/check-sot-registry.mjs
     Verified in CI by the same script with --check. -->

このリポジトリで「ここが正本」と宣言されている概念の一覧。
ソース中の `@sot <concept>` タグから生成される。

同じ concept を 2 箇所で宣言すると CI (static-checks) が落ちる。
正本を移すときは、宣言を新しい場所へ**移動**する (両方に置かない)。

| 概念 | 正本の場所 |
| --- | --- |
| `env-access` | `lib/config/index.ts:2` |
| `env-var-registry` | `lib/config/spec.ts:2` |
| `site-origin` | `lib/site-url.ts:2` |

合計 3 概念。

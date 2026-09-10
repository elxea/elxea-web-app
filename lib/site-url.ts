/**
 * @sot site-origin
 *
 * 公開サイトの基準 URL を返す唯一の関数。
 *
 * ## なぜ 1 本にまとめる必要があったか
 *
 * この概念には長らく実装が 2 つあった。ここの `siteUrl()` と、`lib/env.ts` の
 * `getSiteUrl()` である。しかも **正規化の規則が違った**:
 *
 *   - `getSiteUrl()` … 端の空白だけを落とす (`.trim()`)
 *   - `siteUrl()`    … 内部を含む空白を全部落とす (`.replace(/\s+/g, "")`)
 *
 * 実際に `lib/email/dunning.ts` と `lib/email/subscription-reminder.ts` は
 * **両方を import していた**。同じメールの中で、どちらの関数を通ったかによって
 * URL の壊れ方が変わり得る状態だった。「正本を自称するものが 2 つある」という
 * のが憲章 R5 の指す問題そのもので、`scripts/ops/check-sot-registry.mjs` が
 * この `@sot` タグの重複を機械的に落とすようになったのはこのためである。
 *
 * ## 採った規則: 厳しい方 (空白を全部落とす)
 *
 * 2026-08 の本番 sitemap は 172 件すべての `<loc>` が
 * `https://elxea.com\n/ja/...` になっていた。`vercel env add NAME production <
 * file` のように標準入力で値を流し込むと末尾の改行ごと保存されるためで、
 * ダッシュボード上は正しく見える。改行を含む URL は sitemaps.org のスキーマ上
 * 不正なので、クローラから見ると 1 件も使える URL が無い sitemap だった。
 *
 * URL に空白が正当に入ることはないので、端だけでなく内部も落とす方を残した。
 * 末尾スラッシュも落とすので、呼び出し側は常に `${siteUrl()}/path` と書ける。
 *
 * 正規化と検証の実体は `lib/config/spec.ts` の `NEXT_PUBLIC_SITE_URL` 宣言に
 * あり、値が http(s) URL として成立しない場合はデプロイが起動しない
 * (`assertEnvValid()` / 憲章 R4)。この関数はその宣言を読むだけで、規則を
 * 自前で持たない。
 */
import { env } from "@/lib/config";

export { SITE_URL_FALLBACK } from "@/lib/config/spec";

export function siteUrl(): string {
  return env("NEXT_PUBLIC_SITE_URL");
}

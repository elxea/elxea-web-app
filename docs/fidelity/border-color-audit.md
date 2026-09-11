# 罫線色の総点検 — 全画面棚卸しと実測 (TASK ID-7561)

対象: roji (elxea-web-app) 全画面 / 2026-08-09 / ブランチ `feat/c1-ds-foundation`

## 何が問題だったのか

Tailwind v4の `border` は **太さだけ** を指定する。CSSの `border-color` は初期値が
`currentColor` なので、色クラスが無い罫線は **その要素の文字色** で描かれる。rojiの
本文色は `foreground` (graphite `#464748`) なので、`border` トークン (`#888675`) で
引くべき罫線が一段濃く出ていた。

**コードとしては正しく見える**のがこのバグの厄介さで、C6-3R / C7-1 / C5-1の3レーンが
連続で見逃していた。C5-1 (カート) の対比表は罫線の **幅の行しか持たず色の行が無かった**
ため、表を埋めても検出できなかった。

## どう洗い出したか (grepと実測の2系統)

| 系統 | 手段 | 母集団 | 結果 |
|---|---|---|---|
| 静的 | ESLintルール `elxea-tokens/no-colorless-border` | `app/**` `components/**` `stories/**` の321ファイル | **52箇所 / 31ファイル** (すべて `components/ui/**`) |
| 実測 | Chromium + canvas `getImageData` | 20画面 + 詳細6種 × PC 1440 / SP 375 | 罫線エッジ **669本** を全数走査 |

静的側は `className` 属性 / `cn()` / `cva(base, config)` を **ブラウザと同じ「同時に効く
クラスの束」単位**でグルーピングし、バリアント接頭辞も見る (`dark:border-input` は素の
`border` を満たさない)。`app/**` の違反は **0件** — 画面側はもともと `border border-border`
と明示する作法が徹底されていて、抜けていたのはDSプリミティブ側だけだった。

### 色の測り方 (文字列パース禁止)

`getComputedStyle(el).borderTopColor` はChromiumでは `lab(30.0515 -0.244707 -0.706011)`
のような文字列を返す。**この文字列を自分でパースしてはいけない** (3レーン連続の見逃しの
直接原因)。代わりに文字列をそのままcanvasの `fillStyle` に渡し、1px塗って
`getImageData` でsRGBバイトを読む。色空間変換をブラウザにやらせるのが要点。

計測ハーネスの落とし穴として、**`fillRect` の前に `clearRect` を入れる**こと。既定の
`source-over` 合成では完全透明な塗りが直前のピクセルを残すため、`border-transparent` が
「直前に測った色」として読めてしまう (本タスクでも一度この偽陽性を出し、8件の
「graphite罫線」が実際には透明だったと判明した)。

## 何をどう直したか

52箇所すべてを **役割ごとのトークンに明示束縛**した。グローバルな暗黙の既定
(shadcn純正の `* { border-color: … }`) は **入れない**判断をしている — 理由は
`app/globals.css` の `@layer base` 冒頭コメントに書いた。

| 役割 | 束縛先 | 対象 |
|---|---|---|
| 面の輪郭・構造の区切り罫 | `border-border` | Card / Alert / AlertDialog / Dialog / Popover / HoverCard / DropdownMenu / ContextMenu / Menubar / NavigationMenu / Select / Command / Accordion / Table / ButtonGroup / Item / Resizable / Sheet / Drawer + stories 7種 |
| フォーム部品の輪郭 | `border-input` | Button `outline` / Fieldの選択カード / ToggleGroup連結時の左罫 |
| サイドバー | `border-sidebar-border` | Sidebarの外枠 |

意図的に本文色で引いている罫線は **`border-foreground` と明示**されており (商品詳細の
選択中サムネイル枠 / カート追加CTA)、ルールも実測もこれを是とする。本文色を狙う新規
箇所は `border-current` と書けばルールを通る = 意図がレビューできる。

## 実測結果 (修正前 → 修正後)

| 画面 | 要素 | 修正前 | 修正後 |
|---|---|---|---|
| `/ja/cart` (PC/SP) | 空カートの `Button variant=outline` 4辺 | **#464748** | **#888675** |
| `/ja/events/[slug]` | 詳細リンク `Button variant=outline` | #464748 (C7-1でページ側回避) | **#888675** (DSが持つ / 回避を撤去) |
| 全20画面 × PC/SP | 罫線エッジ669本 | #464748が10本 | **0本** |
| 詳細6種 × PC/SP | 罫線エッジ514本 | — | 不透明 #464748は **`border-foreground` 明示の2種のみ** |

`/ja/search` の下線が #464748で出るのは **フォーカス時だけ** (`focus-visible:border-foreground`
が意図どおり効いている)。blur後は #888675に戻ることを実測で確認した。欠陥ではない。

参照トークンの実測値 (同じcanvas経路): `border` `#888675` / `input` `#888675` /
`foreground` `#464748` / `background` `#ebe9e0` / `card` `#f4f3ed`。

## 再発を止める仕組み

1. **`elxea-tokens/no-colorless-border`** — `pnpm lint` (pre-commit / pre-push) が
   errorで落とす。抑制ファイルは使わない (全域クリーンなので債務ゼロで始められた)。
2. **`__tests__/design-system/border-color-binding.test.ts`** — 判定ロジックの真理値表、
   DSのcvaバリアント全組み合わせ、`globals.css` に暗黙既定が復活していないこと、
   ルールがerrorで配線され続けていることを固定する。

対比表を書くときは、**罫線は幅と色を別の行にする**こと。幅だけの行は同じ見逃しを
再生産する (C5-1注17)。

# C5-1忠実度対比表 — カート (/ja/cart)

> **[DS トークン整合 2026-08-09 反映] 本表の色の行を読むときの注意**
>
> 本表は各レーンが計測した時点の記録である。その後 DS トークン整合タスク
> (`3b670c9d-064c-8166`) で semantic 色トークンを **Figma R2 確定版の実在値**へ
> 揃えたため、**下表の「旧実装値」で書かれた行は現在は Figma と一致している**
> (行内には `→ 現 #xxxxxx [解決 2026-08-09]` を追記した)。
> `[DS案件]` / `[要確認]` の判定が付いている色の行のうち、下表のトークンに
> 該当するものは**解決済み**として読むこと。
>
> | トークン | 本表に出てくる旧実装値 | 現在の実装値 (= Figma) |
> |---|---|---|
> | `foreground` / `card-foreground` / `popover-foreground` | #5d5e61 (charcoal) | **#464748** (graphite) |
> | `border` / `input` / `ring` | #858581 (ash) | **#888675** |
> | `primary-foreground` | #ffffff (純白) | **#f9f8f4** |
> | `muted` | #ebe9e0 (= `background` と同値) | **#dedccf** |
> | `secondary` | #ffc202 / #ffc10d (金) | **#d5d3c0** (sand) |
> | `destructive` | #b9525c | **#ae4751** (C6-1R で是正済み) |
>
> 実測での裏取り: Chromium (1440x900) + canvas `getImageData` で 10 ページを再計測し、
> 上記の現在値がそのまま解決すること、罫線 `#888675` の外側対比 3.022:1、
> `foreground` の対比 7.655:1 (background) / 8.376:1 (card)、ボタン角丸 8px、
> 金額の円記号が半角 `¥` であることを確認 (console error 0 件)。
> 既知の未達は `border` を `muted` 面の**内側**に引いた場合のみ (2.668:1)。
> 実使用箇所は外側が `background` で 3.022:1 のため後退はない。


- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - section【R2: 確定版】`カート 変A（部品ベース）— PC/SP @/ja/cart` `6679:14041`
  - PC 1440 `6684:8698` / Content `6684:174` / CartHeader `6684:120` /
    CartBody `6684:162` / CartItems `6684:123` / CartLine `6684:124`,`6684:144` /
    Divider `6684:143` / OrderSummary `6684:163`
  - SP 390 `6686:14177` / Content `6686:14181` / CartHeader `6686:14182` /
    CartItems `6686:14185` / CartItemSP `6686:14186`,`6686:14208` /
    Divider `6686:14207` / OrderSummary `6686:14228`
  - 部品: Stepper `6906:335` / ImageCard `5269:2` /
    CartContent State=filled `6844:124` / State=empty `6845:17103`
- 実装計測: local production build (`pnpm build` → `next start`) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport PC 1440x1000 / SP 390x1000)
  - 計測URL: `/ja/cart`
  - 商品あり: `SITE_PASSWORD= PREVIEW_SEED=1 next start -p 3151`
    → `scripts/scratch/measure-c51.mjs`
  - 空カート: `SITE_PASSWORD= next start -p 3152` (seedなし = cart cookieなし)
    → `scripts/scratch/measure-c51-empty.mjs`
  - 計測スクリプトは `scripts/scratch/` (gitignore対象・使い捨て)
- 計測日時: 2026-08-08 22:0x–22:1x JST (`origin/feat/c1-ds-foundation` @ `e3511cf` 起点)
- 判定: `[OK]` 一致 (Δ≤2px) / `[仕様]` 意図的な差分 (出典あり) / `[要確認]` DS側で判断が要る差分

## 計測データについて (重要)

`/ja/cart` はShopifyの `shopify_cart_id` cookieが無いと常に空カートになるため、
確定版の「2行 (通常購入 + 定期便) + サマリー」を実寸計測できない。そこで
**プレビュー専用の見本カート (`PREVIEW_SEED=1` / `lib/preview-seed.ts` の `seedCart()`)**
でFigma PCフレームの見本値 (煎茶 茜100g x2 ¥1,800 / 定期便 毎月1回お届け、
玉露 翠50g x1 ¥2,400、小計・合計 ¥6,000) を流した状態を計測した。

- フラグ未設定時 (= production / Vercel Previewの既定) は `seedCart()` が `null` を返し、
  描画は見本導入前とbyte-identical (空カート状態)
- Shopifyへは読み書きしない (純粋なオブジェクトリテラル)。見本の `checkoutUrl` は
  `#preview-seed-no-checkout` のダミーで、見本から決済に進めないのは意図どおり
- したがって **Vercel Previewで見えるのは空カート状態**。商品ありの状態は上記フラグ付き
  ローカルproductionビルドで計測している

---

## 0. 横幅・外余白の扱い (全節に効く前提)

| 対象 | 項目 | Figma実測 | 実装 (実測) | 判定 |
|---|---|---|---|---|
| Content | PC外余白 | 80 | 64 (`--layout-grid-margin-desktop`) | [仕様] 注1 |
| Content | PC内容カラム幅 | 1280 | 1312 (`--layout-container-xl`) | [仕様] 注1 |
| Content | SP外余白 | 20 | 16 (`--layout-grid-margin-mobile`) | [仕様] 注1 |
| Content | SP内容カラム幅 | 350 | 358 | [仕様] 注1 |

注1: `design-kit.generated.json` の `conflicts[c-04]`「デザイン実測グリッドとコードの
layout.gridが食い違う (PC margin 80 vs 64 / SP margin 20 vs 16)」と同一の既知差分。
外余白はHeader / Footer / 全ページの左端が同じ `layout.grid.margin.*` トークンを
解決する設計 (`conflicts[c-11]` の解消結果) なので、カート1ページのために80 / 20を
焼き込むと**全画面の左端が揃わなくなる**。よってトークン側に従った。
影響は「内容カラムがPC +32 / SP +8広い」だけで、内部の余白・列比率は下表のとおり一致する。

---

## 1. CartHeader — PC 1440 (Figma 6684:120)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle / Rect) | 判定 |
|---|---|---|---|---|
| Content | 上余白 | 96 (`space-24`) | 96 (padding-top) | [OK] |
| Content | 下余白 | 96 (`space-24`) | 96 (padding-bottom) | [OK] |
| Content | 見出し→本体gap | 64 (`space-16`) | 64 (row-gap) | [OK] |
| CartHeader | 内gap | 8 (`space-2`) | 8 (row-gap) | [OK] |
| CartHeader | ブロック高 | 82 | 81.8 | [OK] Δ0.2 |
| 「カート」 | font-size | 44 (`jp/display`) | 44 (`.page-title` = displayトークン) | [OK] |
| 「カート」 | line-height | 52.8 (1.2) | 52.8 | [OK] |
| 「カート」 | font-weight | 300 (Light) | 300 | [OK] |
| 「カート」 | letter-spacing | -0.44 (-1%) | +0.88 (h1 tracking .02em) | [要確認] 注2 |
| 「カート」 | 色 | `foreground` #464748 (lab 30.10) | lab 39.88 = #5d5e61 → 現 #464748 [解決 2026-08-09] (`text-foreground`) | [要確認] 注16 |
| リード | font-size / lh | 14 / 21 (1.5) | 14 / 21 | [OK] |
| リード | letter-spacing | 0.7 (5%) | 0.64 | [OK] Δ0.06 |
| リード | 色 | `muted-foreground` #585854 (lab 37.29) | lab 37.41 | [OK] Δ0.12 |

注2: `.page-title` はmd+ でdisplayトークンを当てるが、letter-spacingは
`globals.css` の `h1 { letter-spacing: var(--typography-style-h1-tracking) }` から来るため
`:lang(ja)` のcjk値 (+0.02em = +0.88px) になる。Figmaはdisplay変数の -1% (-0.44px)。
`.page-title` はproducts / tea-menu / collections / elxea-journal / 農家詳細 /
Journal記事詳細でも使う共有クラスなので、**1ページ都合で共有トークンを動かさない**
(C4-4a注2と同じ扱い)。解消は「displayトークンのtrackingをFigmaに合わせる」
DS側案件。→「まとめ確認事項」Q1

## 2. CartHeader — SP 390 (Figma 6686:14182)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| Content | 上余白 / 下余白 | 40 / 64 (`space-10` / `space-16`) | 40 / 64 | [OK] |
| Content | ブロック間gap | 40 (`space-10`) | 40 (row-gap) | [OK] |
| CartHeader | 内gap / ブロック高 | 8 / 67 | 8 / 67.39 | [OK] Δ0.4 |
| 「カート」 | font-size / lh / weight | 32 / 38.4 (1.2) / 300 | 32 / 38.4 / 300 | [OK] |
| 「カート」 | letter-spacing | 0.64 (2%) | 0.64 | [OK] 完全一致 |
| リード | font-size / lh | 14 / 21 | 14 / 21 | [OK] |
| リード | letter-spacing | 0.7 (5%) | 0.64 | [OK] Δ0.06 |

注: リードはFigma `elxea/body-sm` (Inter 14 / lh 21 = 1.5 / tracking 5%) 束縛。
`typography.style.body-sm` のbase値と一致するが、ページが `:lang(ja)` のため
`dist/tokens-cjk.css` の再束縛 (lh 1.8 = 25.2px) がカスタムプロパティ継承で効いてしまう
(要素に `lang="en"` を付けても変数はhtmlから継承されるので戻らない)。英字リードにCJKの
行間を当てるのは誤りなので、font shorthandではなく `text-sm/normal` (14 / 1.5 = 21px) で
Figma値に合わせた。**共有トークンは動かしていない** (同種のcjkスコープ問題は
`components/editorial/rule-list.tsx` のoverlineに既知として記録済み)。

## 3. CartBody / CartItems — PC 1440 (Figma 6684:162 / 6684:123)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| CartBody | 並び / 揃え | 横並び / items-start | `flex-direction: row` / `align-items: flex-start` | [OK] |
| CartBody | 明細↔サマリーgap | 48 (`space-12`) | 48 (column-gap) | [OK] |
| CartItems | 幅 | 872 | 904 | [仕様] 注1 (内容カラム +32) |
| CartLine | 上下padding | 24 / 24 (`space-6`) | 24 / 24 | [OK] |
| CartLine | 列構成 | 140 + 20 + 640 + 20 + 52 | `140px 656.06px 67.94px` / column-gap 20 | [OK] 注3 |
| CartLine | 行gap (info→ctrl) | 8 (`space-2`) | 8 (row-gap) | [OK] |
| CartLine | 1行目の高さ | 171 | 174.16 (罫線1px含む) | [OK] Δ2.2注4 |
| CartLine | 2行目の高さ | 142 | 141.33 | [OK] Δ0.7 |
| Divider | 太さ | 1 | 1 (`divide-y`) | [OK] |
| Divider | 色 | `border` #888675 (lab 55.65 / b* 9.43) | lab 55.39 / b* 2.19 (`divide-border`) | [要確認] 注5 |
| 行間 (実効) | 1行目下端→2行目上端 | 24 + 1 + 24 = 49 | 24 + 1 + 24 = 49 | [OK] |
| 写真 | 幅 / 高さ | 140 / 94 | 140 / 93.33 | [OK] Δ0.7 |
| 写真 | アスペクト / 角丸 | 3:2 / 6 (`radius-md`) | `3 / 2` / 6px | [OK] |
| 写真 | 枠背景 | `muted` #dedccf (lab 87.59) | lab 92.31 (`bg-muted`) → 現 #dedccf / lab 87.59 [解決 2026-08-09] | [要確認] 注6 |
| info | 左端x | 160 (行内相対) | 160 (64→224) | [OK] |
| info | 内gap | 8 | 8 | [OK] |
| info | ブロック高 | 90 | 91.97 | [OK] Δ2.0 |
| 商品名 | font-size / weight | 16 / 500 (`jp/h4`) | 16 / 500 | [OK] |
| 商品名 | line-height | 24 (1.5) | 25.6 (cjk 1.6) | [OK] Δ1.6注7 |
| 商品名 | letter-spacing | 0.32 (2%) | 0.48 (cjk 3%) | [OK] Δ0.16注7 |
| 商品名 | 色 | `foreground` #464748 (lab 30.10) | lab 39.88 = #5d5e61 → 現 #464748 [解決 2026-08-09] | [要確認] 注16 |
| 内容量 | font-size / lh / weight | 14 / 25.2 (1.8) / 400 (`jp/body-sm`) | 14 / 25.2 / 400 | [OK] 完全一致 |
| 内容量 | letter-spacing / 色 | 0.7 (5%) / `muted-foreground` | 0.56 / lab 37.41 | [OK] Δ0.14 |
| 定期便 | font-size / lh | 14 / 25.2 | 14 / 25.2 | [OK] |
| ctrl | 内gap / 揃え | 16 (`space-4`) / items-center | 16 / center | [OK] |
| ctrl | 行高 | 25 | 25.19 | [OK] |
| 価格列 | 右端x | 872 (= CartItems右端) | 968 (= 明細右端) | [OK] 相対一致 |
| 価格列 | 内gap / 行揃え | 4 (`space-1`) / right | 4 / right | [OK] |
| 単価 | font-size / lh / weight | 14 / 25.2 / 400 | 14 / 25.2 / 400 | [OK] |
| 行合計 | font-size / weight | 16 / 500 | 16 / 500 | [OK] |
| 行合計 | line-height | 24 (1.5) | 25.6 (cjk 1.6) | [OK] Δ1.6注7 |

注3: 中央列は `1fr` なので、内容カラムが +32広い分 (注1) だけ640 → 656.06になる。
第3列 (価格) は `auto` = 内容幅で、Figma 52に対し実装67.94。原因は
`Intl.NumberFormat("ja-JP", {currency:"JPY"})` が全角の `￥` (U+FFE5) を返すため
(Figmaは半角 `¥` U+00A5)。金額整形は `lib/utils.ts` の `formatPrice` でサイト全域共通なので
本ページでは変えない。→「まとめ確認事項」Q3

注4: Figma 1行目はinfo 123 (= 24+8+25+8+25+8+25) が高さを決める。実装は同じ積み方で
125.16 (文字組みのcjk差 注7の積み上がり)。行の実効高は24 + 125.16 + 24 + 1 = 174.16。

注5: DS `border` トークンは `oklch(0.615 0.006 106.6)` = #858581。Figmaの `border`
変数 #888675と**明度はほぼ一致するが色度が違う** (lab L 55.65 vs 55.39 = Δ0.26。ただし
b* が9.43 vs 2.19で、Figmaは黄緑寄り・コードは無彩色寄り)。カート専用の色ではなく
DS全域のsemanticトークンなので本レーンでは動かさない。→「まとめ確認事項」Q2

注6: `muted` の既知差分。C4-4a注6 / C4-4b注8と同一 (Figma #dedccf = lab L 87.59 vs
`tokens/base.json` oklch(0.933 0.012 96.4) = #ebe9e0 / lab L 92.31)。写真枠は実写真が入れば
隠れる背景なので影響はplaceholder表示時のみ。DS全域なので本レーンで動かさない。

注7: 文字組みは `typography.style.*` トークン経由で、ページが `:lang(ja)` のため
`tokens/overrides/cjk.json` の値 (h4 = lh 1.6 / tracking .03em、h5 = lh 1.7 / .03em) が効く。
Figmaの `jp/h4` はlh 1.5 / 2%。**日本語の文字組みトークンはSetaka判断待ちのため
動かさない** (C4-4a注1 / catalog-listの既知差分と同じ扱い)。差は最大 Δ2.8px。

## 4. CartItemSP — SP 390 (Figma 6686:14186 / 6686:14208)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| CartBody | 並び | 縦積み (明細→サマリー) | `flex-direction: column` | [OK] |
| CartBody | 明細↔サマリーgap | 40 | 40 (row-gap) | [OK] |
| CartItems | 上端y (見出し下) | 40 | 40 (168.39→208.39) | [OK] |
| CartItemSP | 先頭行 上padding | 0 | 0 (`first:pt-0`) | [OK] |
| CartItemSP | 末尾行 下padding | 0 | 0 (`last:pb-0`) | [OK] |
| CartItemSP | 段gap (top→under) | 12 (`space-3`) | 12 (row-gap) | [OK] |
| CartItemSP | 列gap | 16 (`space-4`) | 16 (column-gap) | [OK] |
| CartItemSP | 列構成 | 96 + 16 + (info 238) | `96px 170.55px 59.45px` | [OK] 注8 |
| 写真 | 幅 / 高さ / アスペクト | 96 / 64 / 3:2 | 96 / 64 / `3 / 2` | [OK] 完全一致 |
| info | 左端x / 幅 | 112 / 238 | 112 (16→128) / 246 | [OK] Δ8注1 |
| info | 内gap | 4 (`space-1`) | 4 | [OK] |
| 商品名 | font-size / weight | 14 / 500 (`jp/h5`) | 14 / 500 | [OK] |
| 商品名 | line-height | 21 (1.5) | 23.8 (cjk 1.7) | [OK] Δ2.8注7 |
| 商品名 | letter-spacing | 0.28 (2%) | 0.42 (cjk 3%) | [OK] Δ0.14 |
| 内容量 / 定期便 | font-size / lh | 14 / 25.2 (1.8) | 14 / 25.2 | [OK] 完全一致 |
| under | 揃え | space-between / items-center | space-between / center | [OK] |
| under | 行高 | 46 | 48.98 | [OK] Δ3.0注7 |
| lc (数量+削除) | 左端x / gap | 0 (行左端) / 16 | 16 (= 行左端) / 16 | [OK] |
| pcol | 右端x / 内gap | 350 (行右端) / 0 | 374 (= 行右端) / normal(0) | [OK] |
| 単価 | font-size / lh | 14 / 25.2 | 14 / 25.2 | [OK] |
| 行合計 | font-size / weight / lh | 14 / 500 / 21 | 14 / 500 / 23.8 | [OK] Δ2.8注7 |
| CartItemSP | 1行目の高さ | 137 (+ gap24 + 罫線1 = 162) | 168.16 (padding 24 + 罫線1込み) | [OK] Δ6注9 |
| Divider | 太さ / 色 | 1 / `border` | 1 / `divide-border` | [OK] / 色は注5 |

注8: SPも `1fr` + `auto` の3列で、infoは 列2+列3を跨ぐ。列3は価格列 (`auto`) で
Figma 47に対し59.45 (注3と同じ全角 `￥` 由来)。info実幅は170.55+16+59.45 = 246
(Figma 238、差は注1の +8)。

注9: 実装は1行目に `pb-6` (24) + 罫線1を含むのでFigmaの「CartItemSP 137 +
gap 24 + Divider 1」= 162と比較する。差6.2は注7の文字組み積み上がり
(商品名 +2.8 / under +3.0)。

## 5. OrderSummary — PC 1440 (Figma 6684:163)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 枠 | 幅 | 360 | 360 (`lg:w-90`) | [OK] 完全一致 |
| 枠 | padding | 24 (`space-6`) | 24 | [OK] |
| 枠 | 内gap | 16 (`space-4`) | 16 (row-gap) | [OK] |
| 枠 | 角丸 | 8 (`radius-lg`) | 8 (`rounded-lg`) | [OK] |
| 枠 | border-width | 1 (`border-width-1`) | 1 | [OK] |
| 枠 | border-color | `border` #888675 (lab 55.65 / b* 9.43) | lab 55.39 / b* 2.19 (`border-border`) | [要確認] 注5 |
| 枠 | 背景 | `card` #f4f3ed (lab 95.77) | lab 95.76 (`bg-card`) | [OK] 完全一致 注10 |
| 枠 | 高さ | 235 | 241.39 | [OK] Δ6.4注7 |
| 見出し | font-size / weight | 14 / 500 (`jp/h5`) | 14 / 500 | [OK] |
| 見出し | line-height | 21 (1.5) | 23.8 (cjk 1.7) | [OK] Δ2.8注7 |
| 見出し | letter-spacing | 0.28 (2%) | 0.42 | [OK] Δ0.14 |
| 見出し | 要素 | — | `<h2 data-slot="summary-title">` | [OK] 注11 |
| 小計行 | 揃え / gap | space-between / 16 | space-between / 16 | [OK] |
| 小計 ラベル | font-size / weight | 16 / 400 (`jp/body`) | 16 / 400 | [OK] |
| 小計 ラベル | line-height | 28 (1.75) | 28.8 (cjk 1.8) | [OK] Δ0.8 |
| 小計 ラベル | letter-spacing / 色 | 0.8 (5%) / `muted-foreground` | 0.64 / lab 37.41 | [OK] Δ0.16 |
| 小計 値 | font-size / weight | 16 / 400 | 16 / 400 | [OK] (色は 注16) |
| 罫線 | 太さ / 色 | 1 / `border` | 1 (`Separator`) / `bg-border` | [OK] / 色は注5 |
| 罫線 | 見出し行からの位置 | 上gap 16 / 下gap 16 | 16 / 16 | [OK] |
| 合計 ラベル | font-size / weight | 16 / 400 | 16 / 400 | [OK] (色は 注16) |
| 合計 値 | font-size / weight | 16 / 500 (`jp/h4`) | 16 / 500 | [OK] |
| 合計 値 | line-height | 24 (1.5) | 25.6 (cjk 1.6) | [OK] Δ1.6注7 |
| ボタン | 幅 / 高さ | 312 (= 枠内幅) / 45 | 310 (= 枠内幅) / 45 | [OK] 高さ完全一致 |
| ボタン | padding | 24 / 12 (`space-6` / `space-3`) | 24 / 12 | [OK] |
| ボタン | 角丸 | 6 (`radius-md`) | 6 (`rounded-md`) | [OK] |
| ボタン | 背景 | `primary` #464748 (lab 30.10) | lab 30.05 (`bg-primary`) | [OK] 完全一致 |
| ボタン | 文字 | 14 / 500 / lh 21 (1.5) | 14 / 500 / 21 (`leading-normal`) | [OK] 完全一致 |
| ボタン | 文字色 | `primary-foreground` #f9f8f4 (lab 97.55) | lab 100 (= 純白) | [要確認] 注12 |
| ボタン | 遷移先 | Shopify `checkoutUrl` | `<a href={cart.checkoutUrl}>` (実測href = 渡したURL) | [OK] |

注10: **新規に値を直した唯一のトークン**。`color.semantic.card` を
`oklch(0.863 0.026 102.0)` (#d5d3c0 / Webflow由来のgray-40) から
`oklch(0.963 0.008 98.9)` (#f4f3ed) へ変更した。

- 根拠 (Figma Variables実在値): `mcp__figma__get_variable_defs(file AWLnI0XF07e8rScuxPYPc7,
  node 6684:8698)` が `"card":"#f4f3ed"` を返す (2026-08-08取得)。**Figmaに実在する
  変数値そのまま**で、こちらが作った値ではない
- 変更理由 (2点):
  1. **Figmaが正本**。旧値はFigmaより3段暗く、面が背景 (#ebe9e0) より**暗い**ので
     「背景より明るいパネル」という意図が反転していた
  2. **WCAG AA未達の是正**。旧値では `foreground` (#5d5e61) とのコントラストが
     4.29:1でAA (4.5:1) 未達。`@storybook/addon-a11y` のcolor-contrast検査が実際に
     FAILした (`Cart/Primitives > Summary`)。新値で5.83:1 = AA達成
- 波及: `bg-card` 利用は9箇所 (login / login complete / password / membership /
  `ui/card.tsx` / `ui/alert.tsx` / 本OrderSummary)。いずれも「ページ背景の上に置く面」で、
  明るくなる方向がFigmaの意図と一致する。`pnpm test` 476件全PASS
- →「まとめ確認事項」Q4 (DS全域トークンの変更なので事後確認を求める)

注11: Figmaの見出しは14/500 (`jp/h5`) だが、パネル1枚 = 1セクションなので要素は
文書構造上 `h2` のままにして体裁だけh5に揃えた。`app/globals.css` に
`h2[data-slot="summary-title"]` 規則を追加 (既存の `catalog-card-title` /
`article-card-title` / `shelf-title` / `section-title` と同じ既定パターン。値はh5
トークン経由で生pxは書いていない)。

注12: `primary-foreground` の既知差分。C4-4a注6と同一 (Figma #f9f8f4 = lab L 97.55 vs
`tokens/base.json` `oklch(1 0 0)` = 純白 lab L 100)。DS全域なので本レーンで動かさない。

注16: **`foreground` トークンがFigmaと食い違う (Δ lab L 9.8)**。Figmaの `foreground`
変数は #464748 (lab L 30.10) だが、`tokens/base.json` の `color.semantic.foreground` は
`oklch(0.482 0.005 271.3)` = #5d5e61 (lab L 39.91 / brand.charcoal)。Figmaの #464748は
コード側では `primary` / `brand.graphite` に入っている。

`app/globals.css` の `@layer base` は「Figmaの見出しはgraphite (#464748) でcharcoalな
body foregroundではない」という理由で `h1..h6 { color: var(--color-brand-graphite) }` を
持つが、R2の各ページ (catalog-list / farmer-detail / journalほか) が `text-foreground` を
当ててこれを打ち消しているため、実際にはcharcoalで描画されている。**本ページも兄弟ページと
色を揃える方を採り `text-foreground` のままにした** (カートだけ濃くすると画面間で本文色が
ばらつくため)。解消は「`foreground` をFigmaに合わせる」か「各ページの `text-foreground` を
外してbaseのgraphiteに委ねる」かのDS判断。→「まとめ確認事項」Q7

## 6. OrderSummary — SP 390 (Figma 6686:14228)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 枠 | 幅 | 350 (全幅) | 358 (全幅) | [OK] Δ8注1 |
| 枠 | padding | 20 (`space-5`) | 20 | [OK] |
| 枠 | 内gap / 角丸 / border | 16 / 8 / 1 | 16 / 8 / 1 | [OK] |
| 枠 | 高さ | 227 | 233.39 | [OK] Δ6.4注7 |
| 見出し | font-size / weight | 14 / 500 | 14 / 500 | [OK] |
| 小計 / 合計行 | 揃え / gap / 行高 | space-between / 16 / 28 | space-between / 16 / 28.8 | [OK] |
| 罫線 | 上gap / 下gap | 16 / 16 | 16 / 16 | [OK] |
| ボタン | 幅 / 高さ | 310 (= 枠内幅) / 45 | 316 (= 枠内幅) / 45 | [OK] 高さ完全一致 |
| ボタン | 文字 | 14 / 500 / 21 | 14 / 500 / 21 | [OK] |
| 明細→サマリーgap | | 40 | 40 (525.53→565.53) | [OK] |

## 7. 空カート (Figma CartContent State=empty 6845:17103)

計測: `PREVIEW_SEED` なしのproductionサーバ (cart cookieなし)。PC / SP両方で
`hasCartLines: false` = 明細0件を確認済み。

| 対象 | 項目 | Figma実測 | 実装 (PC / SP) | 判定 |
|---|---|---|---|---|
| 枠 | 上下padding | 80 / 80 (`space-20`) | 80 / 80 | [OK] |
| 枠 | 内gap | 24 (`space-6`) | 24 (row-gap) | [OK] |
| 枠 | 揃え | items-center / justify-center | center / center | [OK] |
| 文言 | font-size / weight | 14 / 400 | 14 / 400 | [OK] |
| 文言 | line-height | 20 (`Text-sm/Regular`) | 25.2 (`jp/body-sm` = cjk 1.8) | [仕様] 注13 |
| 文言 | 色 | `muted-foreground` #585854 (lab 37.29) | lab 37.41 | [OK] Δ0.12 |
| 文言 | 内容 | 「カートは空です」 | 「まだカートは空です。気になるお茶を、探しにいきましょう。」 | [仕様] 注14 |
| ボタン | 高さ | 36 | 36 (`Button` 既定size = h-9) | [OK] |
| ボタン | padding | 16 / 8 (`px-4` / `py-2`) | 16 / 8 | [OK] |
| ボタン | 背景 / border幅 | `background` #ebe9e0 (lab 92.27) / 1 | lab 92.31 / 1 | [OK] |
| ボタン | **border色** | **`border` #888675** | **#464748 → 現 #888675** [解決2026-08-09 / 実測] | [OK] 注17 |
| ボタン | 角丸 | 8 (`radius-lg`) | 6 (`rounded-md`) | [要確認] 注15 |
| ボタン | 影 | `shadow-xs` (0 1 2 / 10%) | `rgba(0,0,0,0.05) 0 1px 2px` | [OK] Δ不透明度 注15 |
| ボタン | 文字 | 14 / 500 | 14 / 500 | [OK] (色は 注16) |
| ボタン | 遷移先 | 「商品一覧」 | `/ja/products` | [OK] |

注13: Figmaのsymbolはshadcnプリミティブのスケール (`Text-sm/Regular` = Inter 14 /
lh 20) 束縛だが、実装の文言は日本語1文なのでeditorialの `jp/body-sm` (14 / 1.8) を採った。
英字リード (注2節) とは逆向きの判断で、理由は「その要素に入るのが日本語か英字か」。

注14: 文言はコンテンツ層。Figmaの「カートは空です」はmodule symbolのプレースホルダで、
`messages/ja.json` の `common.emptyCart` に既にレビュー済みのコピーがある。レイアウト
(中央寄せ / py-80 / gap-24 / outlineボタン) はFigmaどおりにして**文言は既存コピーを維持**した。
→「まとめ確認事項」Q5

注15: FigmaのDS Button symbolは `radius-lg` (8) を宣言するが、コードの
`components/ui/button.tsx` は全variant `rounded-md` (6)。DS全域の差分なので本レーンでは
動かさない (`known_gaps` の `gap-radius-binding`「Tailwindのrounded-* がトークンに
束縛されていない」と同根)。影は `elevation.shadow` の不透明度2系統問題 (`conflicts[c-07]`)。

注17 [追記2026-08-09 / 罫線色の総点検TASK ID-7561]: **本レーンはborderの「幅」だけ
測って「色」を測っていなかったため、罫線が本文色で描かれていたのを見逃していた**。
DS Buttonの `outline` variantが `dark:border-input` しか持たずlightでは色クラスが
無く、Tailwind v4の `border` は幅だけなのでCSS初期値の `currentColor` = `foreground`
(#464748) で描かれていた。総点検でDS側に `border-input` (= `border` と同値 #888675) を
明示して解決。**この行を足したのは「幅の行だけあって色の行が無い」表が同じ見逃しを
再生産するため**。実測手順: Chromium 1440x900 / 375x812で `/ja/cart` を開き、
`getComputedStyle(el).borderTopColor` の文字列 (Chromiumは `lab(30.0515 …)` を返す) を
canvasの `fillStyle` に渡して1px塗り、`getImageData` でsRGBバイトを読む。
修正前 #464748 (4辺) → 修正後 **#888675** (4辺)。文字列パースはしていない。

## 8. 状態網羅 (機能の実動確認)

| 状態 / 操作 | 確認方法 | 結果 |
|---|---|---|
| 通常商品の行 | 見本カート2行目 (玉露 翠50g) を実測 | [OK] 定期便行を出さず2行構成 |
| 定期便 (sellingPlan) の行 | 見本カート1行目に `定期便: 毎月1回お届け` が描画 | [OK] `sellingPlanAllocation.sellingPlan.name` 由来 |
| 内容量 (selectedOptions) | `内容量: 100g` / `内容量: 50g` が描画 | [OK] ラベルはコードに焼かず `名前: 値` |
| 数量変更 (+1 / -1) | Storybook相互作用テスト `Cart/Primitives > LineInteractions` | [OK] `onQuantityChange(3)` / `(1)` を実クリックで確認 |
| 数量下限 | 同 `LineMinQuantity` | [OK] 数量1で `-` がdisabled (0での暗黙削除をしない) |
| 削除 | 同 `LineInteractions` | [OK] `onRemove` が呼ばれる |
| 小計 / 合計 | 見本カート ¥6,000 / ¥6,000を実測 | [OK] `cart.cost.subtotalAmount` / `totalAmount` |
| 「購入手続きへ」= checkoutUrl | 同 `Summary` (href検証) + 実画面の `a[href]` 実測 | [OK] `cart.checkoutUrl` がそのままhref |
| 空カート | `PREVIEW_SEED` なしで実測 (7節) | [OK] |

実カートに対するServer Action (`lib/shopify/cart-actions.ts`) は本タスクで変更していない
(既存配線をそのまま使う)。行部品→contextのコールバック配線を相互作用テストで固定した。

## 9. ブラウザコンソール

単一ロード (リサイズなし) の計測結果:

| viewport | HTTP | console error | console warning | pageerror |
|---|---|---|---|---|
| 1440x1000 | 200 | 0 | 0 | 0 |
| 390x1000 | 200 | 0 | 0 | 0 |

`requestfailed` はPC 40件 / SP 17件記録されたが、**すべて `?_rsc=` 付きの
Next.js RSC prefetch** (Header / Footerが全ナビリンクをprefetchし、ブラウザcontextを
閉じるときにin-flight分が `net::ERR_ABORTED` になる) とSentry envelope 1件で、
ページ由来のエラーではない。カート固有のURL / APIは含まれない。

## 10. 機械検証 (全件 / FAIL 0)

| コマンド | 結果 |
|---|---|
| `pnpm lint` | PASS (`--max-warnings 0`) |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS 476/476 (94 files) |
| `pnpm build` | PASS |
| `pnpm validate:tokens` | PASS 0 error / 20 warning (既存のcamelCase命名warningのみ) |
| `pnpm validate:design-map` | PASS 129 entries |

`eslint-suppressions.json` から `components/cart/cart-content.tsx` の
`elxea-tokens/no-raw-colors` 抑制1件を削除した (書き直しで違反が消え、
残置するとeslintが「もう発生しない抑制がある」でexit 2になるため)。

## 11. まとめ確認事項 (Setaka判断)

| # | 事項 | 推奨 | 影響範囲 |
|---|---|---|---|
| Q1 | `.page-title` のletter-spacingがFigma display変数 (-1%) ではなくh1 cjk値 (+2%) になる | displayトークンのtrackingをFigmaに合わせるDS案件として別途起票 | `.page-title` を使う7ページ |
| Q2 | `border` トークンの色度がFigma (#888675) と違う (コードは無彩色寄り #858581 → 現 #888675 [解決 2026-08-09]) | Figma値へ寄せる (DS案件) | 罫線を使う全画面 |
| Q3 | 金額の `￥` が全角 (U+FFE5)。Figmaは半角 `¥` | `formatPrice` を `currencyDisplay: "narrowSymbol"` にすれば半角になる。サイト全域の表記変更なので判断を仰ぐ | 価格表示の全画面 |
| Q4 | `--color-card` をFigma実在値 (#f4f3ed) に直した (注10)。AA未達の是正込み | この変更を承認 (承認されない場合はAA未達が戻るため代替案が必要) | `bg-card` 9箇所 |
| Q5 | 空カートの文言をFigmaプレースホルダ「カートは空です」ではなく既存コピーのまま維持した | 既存コピー維持 (Figma側はレイアウト用の見本と解釈) | カートのみ |
| Q6 | 数量 `-` を下限1で無効にし、0による暗黙削除をやめた (削除は「削除」ボタン経由) | この挙動 (破壊的操作を明示操作に寄せる) | カートのみ |
| Q7 | 本文色 `foreground` がFigma (#464748) とコード (#5d5e61 → 現 #464748 [解決 2026-08-09]) でΔlab L 9.8食い違う。全R2ページが `text-foreground` でbaseのgraphite規則を打ち消している (注16) | 「`foreground` をFigma値へ寄せる」か「各ページの `text-foreground` を外す」かをDS案件として決める。本レーンは兄弟ページとの一貫性を優先し現状維持 | 本文テキストの全画面 |

## 12. Vercel Preview での確認 (2026-08-08 22:36 JST)

- Preview URL: https://elxea-web-5csejkdcw-setaka1103s-projects.vercel.app
- デプロイ元コミット: `d6ff31b` (`feat/c1-ds-foundation` に push 済み)

| 項目 | PC 1440 | SP 390 |
|---|---|---|
| `/ja/cart` HTTP | 200 | 200 |
| console error | 0 | 0 |
| console warning | 0 | 0 |
| pageerror | 0 | 0 |
| `requestfailed` | 25 (すべて `?_rsc=` prefetch abort) | 11 (同) |
| 明細行の有無 | なし (= 空カート・仕様どおり) | なし |
| 空カート枠 上下 padding / gap / 揃え | 80 / 80 / 24 / center | 80 / 80 / 24 / center |
| 空カート 文言 font-size / lh | 14 / 25.2 | 14 / 25.2 |
| 「商品一覧」ボタン 高さ / 遷移先 | 36 / `/ja/products` | 36 / `/ja/products` |

Preview は `PREVIEW_SEED` 未設定なので **空カート状態が正**。数値はローカル production
ビルドでの空カート計測 (7 節) と一致した。DOM に `カート` / `Items in your cart` /
`data-slot="cart-header"` / 空カート文言が含まれることも HTML 取得で確認済み。

商品ありの状態は Shopify の cart cookie を持つブラウザでのみ出るため、Preview では
実カート投入後に確認する (本タスクでは注文確定を行わないため未実施)。

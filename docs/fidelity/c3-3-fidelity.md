# C3-3忠実度対比表 — SPメニュー展開UI

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


- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7` / node `7967:1326`「開閉UI / R1: SPメニュー展開 — SP 375」
- 実装: `components/layout/header.tsx` (Sheet全幅オーバーレイ)
- 実測: Playwright (playwright-elxea) / viewport 375x812 / `http://localhost:3011/ja` (dev, `VERCEL_ENV=preview`)
- 計測方法: `getBoundingClientRect()` + `getComputedStyle()`。yはシート上端からの相対値。

## 1. 骨格・寸法

| 対象 | 項目 | Figma実測 | getComputedStyle / Rect | Δ | 判定 |
|---|---|---|---|---|---|
| シート全体 | width / x | 375 / 0 | 375 / 0 | 0 | [OK] |
| SP Header (展開時) 7967:1327 | height | 56 | 56 | 0 | [OK] |
| 同 | padding | 16全辺 | 16 / 16 / 16 / 16 | 0 | [OK] |
| Logo 7967:1328 | x / height | 16 / 16 | 16 / 16 | 0 | [OK] |
| Logo | width | 66.54 | 66.06 | 0.48 | [OK] 注1 |
| 閉じる (lucide/x) 7967:1334 | x / 右端 / y | 335 / 359 / 16 | 335 / 359 / 16 | 0 | [OK] |
| 同 | size | 24x24 | 24x24 | 0 | [OK] |
| Nav (展開メニュー) 7967:1336 | y / width | 56 / 375 | 56 / 375 | 0 | [OK] |
| 同 | padding | px16 / py24 | 16 / 24 | 0 | [OK] |
| Nav行7967:1337 | width / x | 343 / 16 | 343 / 16 | 0 | [OK] |
| 同 | padding-top / bottom | 16 / 16 | 16 / 16 | 0 | [OK] |
| 同 | height | 56 | 62 | +6 | [仕様] 注2 |
| 同 | border-bottom | 1px stone | 1px `--color-brand-stone` | 0 | [OK] |
| chevron 7967:1339 | size / 右端余白 | 16x16 / 0 | 16x16 / 0 | 0 | [OK] |
| Navブロック | height | 384 | 482 | +98 | [仕様] 注2注3 |
| 検索7967:42098 | padding | px16 / py24 | 16 / 24 | 0 | [OK] |
| Input Underline 7967:42099 | width | 343 | 343 | 0 | [OK] |
| 同 | padding-top / bottom | 8 / 16 | 8 / 16 | 0 | [OK] |
| 同 | border-bottom | 2px | 2px `--color-border` | 0 | [OK] |
| 同 | text-align | center | center | 0 | [OK] |
| 同 | height | 55 | 59.59 | +4.59 | [仕様] 注2 |
| アカウント導線7967:42101 | padding | px16 / pt24 / pb32 | 16 / 24 / 32 | 0 | [OK] |
| 同 | gap | 24 | 24 | 0 | [OK] |
| 同 | height | 73 | 81.2 | +8.2 | [仕様] 注2 |

## 2. タイポグラフィ・色 (トークン束縛)

| 対象 | 項目 | Figma | 実測 | 判定 |
|---|---|---|---|---|
| Navラベル | font-size | 20 | 20px (`--typography-style-h3`) | [OK] |
| Navラベル | line-height | normal (24) | 29px (h3 CJK 1.45) | [仕様] 注2 |
| Navラベル | color | `--foreground` #464748 | lab(30.05 …) = `--color-brand-graphite` | [OK] 注4 |
| Nav罫線 | color | `--stone` #adaca0 | lab(70.20 …) / #adaca0のL\* = 70.5 | [OK] Δ0.3 |
| 検索ラベル | font-size | 24 | 24px (`--typography-style-h2`) | [OK] |
| 検索ラベル | color | `--muted-foreground` #585854 | lab(37.41 …) / #585854のL\* = 37.3 | [OK] Δ0.1 |
| 検索下線 | color | `--border` #888675 | lab(55.39 …) / #888675のL\* = 55.6 | [OK] Δ0.2 |
| アカウント導線 | font-size | 14 | 14px (`--typography-style-body-sm`) | [OK] |
| アカウント導線 | color | `--foreground` #464748 | lab(30.05 …) = graphite | [OK] 注4 |
| 背景 | color | `--cream` #ebe9e0 | lab(92.31 …) / #ebe9e0のL\* = 92.3 | [OK] Δ0.0 |

色はsRGB hex直書きではなくトークン束縛のため、CIE L\* を突き合わせて同一性を確認した (計算式: 相対輝度Y → L\* = 116·Y^(1/3) − 16)。

## 3. 注記

- 注1 — Logo幅0.48px差は正式SVGロゴのアスペクト比 (1000:240.46) を高さ16pxに合わせた結果の丸め。高さ・xは完全一致。
- 注2 — **【仕様】CJKトークン由来のline-height差**。Figmaフレームは `leading: normal` (Inter代替フォント) だが、実装は `dist/tokens-cjk.css` の `:lang(ja)` プリセットに束縛される (h3 = 1.45 / h2 = 1.4 / body-sm = 1.8)。生pxのline-heightを書いてトークンを破ることはしないため、行高・ブロック高の増分は仕様として受容する。font-size・padding・border・色はすべて一致。
- 注3 — Navブロック高の差のうち、行高以外の要因は **Nav項目数** (Figma 6件サンプル / 実装7件)。Figmaは「お茶を選ぶ・定期便・ジャーナル・お茶メニュー・イベント・About」だが、実装はルートが実在する `navItems` (商品一覧・定期便・ジャーナル・お茶メニュー・プレイリスト・農家・イベント) をSoTとする。IA (Aboutの追加 / プレイリスト・農家の扱い) は別途の判断事項。
- 注4 — Figmaの `--foreground` (#464748) はコード側の `--color-brand-graphite` に対応する。コードの `--color-foreground` はcharcoal (#5d5e61) で別物のため、SPメニューのラベルは `text-brand-graphite` に束縛した (`app/globals.css` の見出し色ルールと同じ整理)。

## 4. Figmaとの意図的差分

| 差分 | 内容 | 理由 |
|---|---|---|
| AudioToggle | Figmaフレームに無いがアカウント導線の末尾に残す | SPからの唯一の導線。削ると機能欠落 |
| Nav項目 | Figma 6件 → 実装7件 (実在ルート) | 注3参照。IAは別判断 |
| 「タップで閉じる: …」注記 | UIに描画しない | Figma上の仕様注記でありUIコピーではない。閉じる手段 (外側タップ / ✕ / Esc) はRadix Dialogが担保 |
| 展開時ヘッダー高56 vs通常ヘッダー60 | Figmaどおり56を採用 | 展開時フレームのSoTに従った。通常SPヘッダー (7970:42126) は60のままで、開閉でロゴが2px上下する。要Setaka確認 |

## 5. SPカート常時表示 (Setaka裁定2026-08-08)

| 項目 | 実測 |
|---|---|
| 通常SPヘッダー高 | 60px |
| カートリンク可視 (375幅) | true (display/visibility/幅すべて有効) |
| カートリンクrect | x=255.08 / y=12 / w=67.92 / h=36 |
| 回帰テスト | `e2e/mobile.spec.ts` "cart link is always visible on mobile" |

## 6. PDP (台帳行フィルタ / スペック帯是正) の実データ検証

`/ja/products/tea-ats-o-01` の描画HTMLから `<dt>/<dd>` を抽出:

| ブロック | 描画された行 |
|---|---|
| スペック帯 | 品種 = 香駿, みなみさやか / 産地 = 纁(そひ) / 摘採 = 春摘み・夏摘み / **仕上げ = —** |
| フルスペック台帳 | 茶種 = 烏龍茶 / 品種 / 産地 / 摘採 / メニュー番号 = 纁Vol.01 / 保存 / 賞味期限 (計7行) |

- 「仕上げ」は茶種 (烏龍茶) の二重表示を解消し `—` になった [OK]
- 値が無い 味わい・香り の行は台帳から消えた [OK]
- 削除した行ラベル (栽培 / 標高 / 土壌 / 火入れ / 粉砕) はHTML中に1件も残っていない [OK]
- 保存 / 賞味期限 (ブランド共通定数) は常時表示のまま [OK]

### 別件で検出した既存バグ (本ラウンド未修正)

`摘採` の値が `["春摘み","夏摘み"]` とJSON配列の生文字列で描画されている。Shopifyのlist型metafield (`custom.season`) を `lib/shopify/index.ts` が文字列としてそのまま渡しているため。本タスクのスコープ外だが要修正。

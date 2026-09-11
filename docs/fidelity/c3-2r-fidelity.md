# C3-2R忠実度対比表 — Figma実測vs getComputedStyle

- 対象ブランチ: `feat/c1-ds-foundation`
- 計測ハーネス: `scripts/scratch/c32-measure.mjs`
- 計測環境: `next dev -p 3100` / `VERCEL_ENV=preview` / deviceScaleFactor 1
- 計測URL: `/ja/products/tea-ats-g-01` (PDP) / `/ja/subscription` (定期便LP)
- 計測日: 2026-08-08 JST

数値は `getBoundingClientRect` / `getComputedStyle` の実測値 (px, 小数第2位まで)。
Figma側はnodeの実測値で、Figma UIは小数を丸めて表示するため0.5px未満の差は
「丸め由来」として Δ0扱いにする (それ以外の差は要修正)。

## 1. DateRibbon (定期便LP S2 / Figma 8071:126) — 本タスクの修正対象

| 項目 | Figma実測 | 実装 (修正前) | 実装 (修正後) | Δ | 判定 |
|---|---|---|---|---|---|
| 帯の高さ (PC 1440) | 49 | 44 | 49.19 | +0.19 | [OK] 丸め由来 |
| 帯の幅 (PC 1440) | 1312 | 1312 | 1312 | 0 | [OK] |
| 上下padding | 12 / 12 | 0 / 0 (min-h-11で44固定) | 12 / 12 | 0 | [OK] |
| テキスト行ボックス | 25 | 21相当 | 25.2 | +0.2 | [OK] 丸め由来 |
| font-size | 14 | 14 | 14 | 0 | [OK] |
| line-height | 1.8 (=25.2) | 1.8 | 1.8 | 0 | [OK] |
| letter-spacing | 0.04em | 0.04em | 0.04em | 0 | [OK] |
| 角丸 | pill (full) | pill | pill | 0 | [OK] |
| 左右padding | 32 | 32 | 32 | 0 | [OK] |

修正内容: `flex min-h-11 items-center ... px-8` → `flex items-center ... px-8 py-3`。
高さを44pxで固定していた `min-h-11` を外し、Figmaと同じ「padding 12 + 行ボックス」
の積み上げに変えた。49.19の端数はbody-smのline-height 1.8 x 14px = 25.2に由来し、
Figma表示の25 / 49はその丸めなので実質 Δ0。

SP (375) では `h=74.38` になるが、これは文言が2行に折り返した結果
(25.2 x 2 + padding 24 = 74.4) であり、1行あたりの積み上げはPCと同一。

## 2. フルスペック台帳 (PDP / Figma 8056:1517内) — データ配線のみ・レイアウト不変

値の出所をハードコード定型文からShopify metafield実値へ差し替えた変更で、
レイアウトに影響するCSSは一切触っていない。以下は「変えていないこと」の実測確認。

| 項目 | Figma実測 | 実装 (修正前) | 実装 (修正後) | Δ | 判定 |
|---|---|---|---|---|---|
| PCカラム幅 | 624 / 624 | 624 / 624 | 624 / 624 | 0 | [OK] |
| PCカラム間gap | 64 | 64 | 64 | 0 | [OK] |
| PC行高 | 50.59 | 50.59 | 50.59 | 0 | [OK] |
| PC term幅 | 160 | 160 | 160 | 0 | [OK] |
| PC term→value間 | 24 | 24 | 24 | 0 | [OK] |
| SPカラム幅 | 343 | 343 | 343 | 0 | [OK] |
| SP行高 | 46.59 | 46.59 | 46.59 | 0 | [OK] |
| SP term幅 | 104 | 104 | 104 | 0 | [OK] |
| termタイポ | 16 / 500 / .03em | 同左 | 同左 | 0 | [OK] |
| 行数 | 8 | 8 | 14 | +6 | [要判断] 下記参照 |

行数のみFigma確定版の8行から14行に増えている。旧 `ProductFeatures` が持っていた
「お茶の詳細」6項目 (品種 / 産地 / 摘採 / 味わい / 香り / メニュー番号) を台帳へ統合し、
台帳を商品スペックの唯一のSoTにしたため。行の見た目 (行高・カラム・タイポ) は不変で、
2カラム台帳の縦が伸びるだけの差分。Figma側の行追加はデザイン側で反映が要る。

## 3. 参考: 変更していない周辺ブロックの非回帰確認

| 項目 | Figma実測 | 実装 | Δ | 判定 |
|---|---|---|---|---|
| スペック帯 幅 (PC) | 1312 | 1312 | 0 | [OK] |
| スペック帯4列 (PC) | 304 x 4 / gap 32 | 304 x 4 / gap 32 | 0 | [OK] |
| スペック帯2列 (SP) | 163.5 x 2 / gap 16 | 163.5 x 2 / gap 16 | 0 | [OK] |
| スペック帯 上padding | 32 | 32 | 0 | [OK] |

## 4. 台詞データのマッピング (実測レンダリング結果 / tea-ats-g-01)

| # | 台帳ラベル | 値の出所 | 実測値 |
|---|---|---|---|
| 1 | 茶種 | `custom._type-of-tea` (mf.teaCategory) | 緑茶 |
| 2 | 品種 | `custom.variety` (mf.variety) | やぶきた, 静七一三二（さくらみどり）, 香駿 |
| 3 | 産地 | `product.vendor` | 翠(すい) |
| 4 | 摘採 | `custom.season` (mf.season) | — (未設定) |
| 5 | 味わい | `custom.taste` (mf.taste) | — (未設定) |
| 6 | 香り | `custom.aroma` (mf.aroma) | — (未設定) |
| 7 | メニュー番号 | `custom.menu_number` (mf.menuNumber) | 翠Vol.01 |
| 8 | 栽培 | 対応metafield無し | — (常時) |
| 9 | 標高 | 対応metafield無し | — (常時) |
| 10 | 土壌 | 対応metafield無し | — (常時) |
| 11 | 火入れ | 対応metafield無し | — (常時) |
| 12 | 粉砕 | 対応metafield無し | — (常時) |
| 13 | 保存 | ブランド共通定数 (messages) | 密閉・冷暗所／開封後1か月 |
| 14 | 賞味期限 | ブランド共通定数 (messages) | 製造から12か月 |

## 参照元

- 実測JSON: `scripts/scratch/c32-measure.mjs` の出力 (環境変数 `C32_OUT` で指定)
- 実測スクリーンショット: `pdp-pc.png` / `pdp-sp.png` / `lp-pc.png` / `lp-sp.png`

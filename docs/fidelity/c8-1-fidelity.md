# C8-1忠実度対比表 — トップページ (/ja)

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - section `8109:46557`【R2: 確定版】トップ (必須5本 + 追加4 / 導線ブロック最下部)
  - **PC 1440 `8109:46558`** / **SP 375 `8109:46620`**
  - 採用バナー `8114:23` (verbatim): 「【採用: R2確定版】 決定2026/08/08 見た目一括承認 (Setaka)・凍結。本R2確定版を正とし、以降の変更は本案の改訂として扱う。」
  - 旧R1は `7609:9`【移管: Common】トップ、廃止バナー `8115:23`「参照禁止」
  - **注意**: Notion Structure DB「トップ」行のFigmaプロパティは `6606-6260`
    (`トップ 変A（部品ベース・DS準拠）` = 旧elxea版・SPフレーム無し) を指したままでstale。
    R2確定版は上記 `8109:46558` / `8109:46620`。
- 実装計測: local production build (`PREVIEW_SEED=1 pnpm build` → `next start :3181`) を
  Playwrightで `getComputedStyle` / `getBoundingClientRect` 実測 (PC 1440x1000 / SP 375x1000)
  - URL: `/ja`
  - **色は `getComputedStyle` を使わない**。Chromiumは `color` を `lab()` で返すため文字列
    パースが誤値になる (C6-1Rレーンの実証済み知見)。対象の色を背景に持つprobe要素を
    差し込み、**1pxスクリーンショット (PNG) を復号して実RGBを読む**方式で確定した。
    節の地色は加えて要素そのものの実ピクセルでも二重確認している。
- 計測日時: 2026-08-09 02:0x JST (origin/feat/c1-ds-foundation `0c68a59` へ rebase 後に再計測・差分なし)
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 (理由付き) / `[DS案件]` DSトークン整合タスク
  (https://app.notion.com/p/3b670c9d064c81668becdbb97c74b510) に集約済みの既知差分 / `[要判断]` Setaka判断待ち

---

## 0. 節構成の対応 (PC)

| # | Figma節 (node) | 実装 | 状態 |
|---|---|---|---|
| 1 | Hero非対称2カラム `8109:46560` | `TopHero` | [OK] |
| 2 | 新着・季節の一報SEASONAL `8110:2503` | `TopSection` + `FeedList` (最新記事3件) | [OK] |
| 3 | 茶 (EC) 実商品4点 `8109:46596` | `CatalogGrid` + `ProductCard` (Shopify 4件) | [OK] |
| 4 | 茶を探す (カテゴリ) `8109:46568` | `ActionTileGrid` + `ActionTile` (Shopifyコレクション6件) | [OK] |
| 5 | 茶葉診断への入口 (お茶カルテ) `8110:2514` | **未実装** | [要判断] 注1 |
| 6 | ジャーナル `8109:46605` | `TopSection` + `FeedList` (特集記事3件) | [OK] |
| 7 | イベント `8110:2516` | `TopSection` + `FeedList` (開催予定3件) | [OK] |
| 8 | roji定期便 `8110:2527` | 既存 `SpecBand` (定期便LPと同文言キー) | [OK] |
| 9 | つくり手が見えるVOICES `8110:2542` | 既存 `SectionHead` + `SectionBody` + `TripleColumn` | [OK] |
| 10 | About / 章切り (明度反転) `8109:46592` | `ChapterStatement` | [OK] |
| 11 | 導線ブロック `8109:46616` | `ServiceGuideBlock` | [OK] |
| 12 | 購入導線 (静か・最下部) `8109:46617` | `QuietLinkRow` | [OK] |

---

## 1. Hero — PC 1440 (Figma 8109:46560)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| 節 | 上下余白 | 96 / 96 | 96px / 96px | [OK] |
| 節 | 外余白 (左右) | 64 | 64px / 64px | [OK] |
| text-col | 左端x / 幅 | 64 / 416 | 64 / 416 | [OK] |
| 写真 | 左端x / 寸法 | 512 / 864x560 | 512 / 864x560 | [OK] |
| 写真 | aspect-ratio | 864:560 | `864 / 560` | [OK] |
| 主見出し | font-size | 52 (en/h1) | 44px | [仕様] 注2 |
| 主見出し | line-height | 65 (1.25) | 52.8px (1.2) | [仕様] 注2 |
| 主見出し | font-weight | 700 (Inter Bold) | 300 | [仕様] 注3 |
| 主見出し | 色 (pixel実測) | #464748 (foreground) | **#464748** | [OK] |
| 副題 | font-size / lh | 16 / 28 (jp/body 1.75) | 16px / 28.8px | [OK] Δ0.8注4 |
| リード | font-size / lh | 14 / 25.2 (jp/body-sm 1.8) | 14px / 25.2px | [OK] |
| 見出し→副題 | 間隔 | 24 (130→154) | 24px | [OK] |
| 副題→リード | 間隔 | 24 (182→206) | 24px | [OK] |
| リード→CTA | 間隔 | 24 (256→280) | 24px | [OK] |
| CTA | 高さ | 49 | 48px (`min-h-12`) | [仕様] 注5 |
| CTA | 左右padding | 32 | 32px | [OK] |
| CTA | 角丸 | 全丸め (radius-full) | `3.35544e+07px` (rounded-full) | [OK] |
| CTA | 文字 | 14 / 25.2 | 14px / 25.2px | [OK] |
| CTA | 罫線色 (pixel実測) | #888675 (border) | #858581 | [DS案件] 注6 |
| 地色 | body背景 (pixel実測) | #ebe9e0 (background) | **#ebe9e0** | [OK] |

## 2. Hero — SP 375 (Figma 8109:46622-46627)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 写真 | 位置 / 寸法 | x0 / 375x300 (全幅・先頭) | x0 / 375x300 | [OK] |
| 写真 | aspect-ratio | 5:4 | `5 / 4` | [OK] |
| 写真 | 角丸 | 0 (全幅) | 0px | [OK] |
| 節 | 上余白 | 0 (TopBar直下) | 0px | [OK] |
| 節 | 下余白 | 32 | 32px | [OK] |
| 節 | 外余白 | 16 | 16px | [OK] |
| text | 左端x / 幅 | 16 / 343 | 16 / 343 | [OK] |
| 写真→見出し | 間隔 | 32 | 32px | [OK] |
| 主見出し | font-size | 28相当 (h35 = 1行) | 32px (base h1) / 2行76.78 | [仕様] 注7 |
| 副題 | font-size / lh | 16 / 28 | 16px / 28.8px | [OK] Δ0.8 |
| リード | font-size / lh | 14 / 25.2 | 14px / 25.2px | [OK] |
| CTA | 高さ / padding | 49 / 32 | 48px / 32px | [仕様] 注5 |
| 横スクロール | document幅 | 375 | 375 | [OK] |

## 3. 一報リスト3節 (SEASONAL / JOURNAL / EVENT) — PC

Figma `8110:2503` / `8109:46605` / `8110:2516` は同一骨格。共有部品 `FeedList` 1つで実装。

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白 | 96 / 96 | 96px / 96px | [OK] |
| キッカー | font-size | 12 (en/overline) | 12px | [OK] |
| キッカー | line-height | 16.8 (1.4) | 21px (1.75) | [DS案件] 注8 |
| キッカー | letter-spacing | 1.5 (12.5%) | 1.8px (.15em) | [DS案件] 注8 |
| キッカー | 色 (pixel実測) | #585854 (muted-foreground) | **#585854** | [OK] |
| キッカー→1行目 | 間隔 | 24 (113→137) | 24px (`mt-6`) | [OK] |
| 行 | ピッチ | 52 (137→189→241) | 52.8 (28.8 + row-gap 24) | [OK] Δ0.8 |
| 行タイトル | font-size / lh | 16 / 28 (jp/body) | 16px / 28.8px | [OK] Δ0.8 |
| 行タイトル | 色 (pixel実測) | #464748 | #5d5e61 | [DS案件] 注9 |
| メタ (日付) | font-size / lh | 12 / 16.8 (en/caption) | 12px / 21px | [DS案件] 注8 |
| メタ | 色 (pixel実測) | #585854 | **#585854** | [OK] |
| タイトル→メタ | 間隔 | 32 | 32px (column-gap) | [OK] |
| 行数 | 各節 | 3 | 3 (計9) | [OK] |

## 4. 一報リスト3節 — SP

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白 | 24 / 24 | 24px / 24px | [OK] |
| キッカー→1行目 | 間隔 | 0 (42→42) | 16px (`mt-4`) | [仕様] 注10 |
| 行 | ピッチ | 44 (42→86→130) | 44 (28.8 + row-gap 16) | [OK] |
| 行 | タップ域 | 44 | 44px (`min-h-11`) | [OK] |
| 行の高さ | 実高 | 44 (日付を本文に畳む) | 53.8 (メタが2行目に回る) | [仕様] 注11 |

## 5. 茶 (EC) — PC / SP (Figma 8109:46596 / 8109:46644)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白PC | 96 / 96 | 96px / 96px | [OK] |
| 節 | 上下余白SP | 64 / 64 | 64px / 64px | [OK] |
| head | キッカー→見出し | 12 (17→29) | 12px (`mt-3`) | [OK] |
| 節見出し | font-size / lh | 32 / 38.4 (jp/h1 1.2) | 32px / 38.4px | [OK] |
| 節見出し | letter-spacing | 2 (.0625em) | 0.64px (.02em) | [DS案件] 注12 |
| 節見出し | 色 (pixel実測) | #464748 | **#464748** | [OK] |
| head→グリッド | 間隔PC | 48 (163→211) | 48px | [OK] |
| head→グリッド | 間隔SP | 32 (102→134) | 24px | [仕様] 注13 |
| グリッド | 列構成PC | 4列304 / gap 32 | `304px 304px 304px 304px` / 32px | [OK] |
| グリッド | 列構成SP | 1列343 | `343px` | [OK] |
| カード枚数 | PC / SP | 4 / 2 | 4 / 2 (`hidden lg:block`) | [OK] |
| カード | 写真aspect | 3:2 | 3/2 (`ImageCard` 既定) | [OK] |

## 6. 茶を探す (カテゴリ) — PC / SP (Figma 8109:46568 / 8109:46629)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白PC / SP | 96 / 48 | 96px / 48px | [OK] |
| head→グリッド | PC / SP | 48 / 24 | 48px / 24px | [OK] |
| グリッド | 列構成PC | 3列416 / gap-x 32 | `416px 416px 416px` / 32px | [OK] |
| グリッド | 行gap PC | 48 (211→596で337+48) | 48px | [OK] |
| グリッド | 列構成SP | 1列343 / 行gap 24 | `343px` / 24px | [OK] |
| 写真 | 寸法PC | 416x300 | 416 x 300 | [OK] |
| 写真 | 寸法SP | 343x247 | 343 x 247.34 | [OK] |
| 写真 | aspect-ratio | 416:300 | `416 / 300` | [OK] |
| 写真→ラベル | 間隔 | 12 (300→312) | 12px | [OK] |
| ラベル | font-size / lh | 14 / 25 | 14px / 25.2px | [OK] |
| タイル数 | PC | 6 | 6 | [OK] |
| タイル文言 | 出どころ | 固定6語 (淹れる/はかる/…) | Shopifyコレクション名 | [仕様] 注14 |

## 7. roji定期便 — PC / SP (Figma 8110:2527 / 8110:47112)

既存 `SpecBand` (Figma 8056:1558 / 8071:462と同一部品) をそのまま再利用。

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白PC / SP | 64 / 32 | 64px / 32px | [OK] |
| 罫線 | 幅 / 位置 | 1312 x 1 (上端) | border-top 1px | [OK] |
| 罫線 | 色 (pixel実測) | #888675 | #858581 | [DS案件] 注6 |
| 罫線→行 | 間隔PC / SP | 32 / 16 | 32px / 16px | [OK] |
| 行 | 列構成PC | 4列304 / gap 32 | `304px x4` / 32px | [OK] |
| 行 | 列構成SP | 2列163.5 / gap 16 | `163.5px 163.5px` / 16px | [OK] |
| term | font-size / lh | 12 / 18 (jp/caption 1.5) | 12px / 21px | [DS案件] 注8 |
| term→value | 間隔PC / SP | 8 / 22 | 8px / 4px | [仕様] 注15 |
| value | font-size / lh | 14 / 25 | 14px / 25.2px | [OK] |
| 文言 | 出どころ | Figma 4項目 | `subscriptionR2.included1-4` を再利用 | [OK] 注16 |

## 8. つくり手が見える (VOICES) — PC / SP (Figma 8110:2542 / 8110:47128)

既存 `SectionHead` + `SectionBody` + `TripleColumn` (Figma 8056:1577と同一部品) を再利用。

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白PC | 96 / 64 | 96px / 64px | [OK] |
| 節 | 上下余白SP | 32 / 32 | 32px / 32px | [OK] |
| キッカー→見出し | PC / SP | 8 (17→25) / 20 (49→69) | 8px / 20px | [OK] |
| 節見出し | font-size | 20 (jp/h3・h27) | 20px | [OK] |
| 節見出し | line-height | 27 (1.35) | 29px (1.45) | [仕様] 注17 |
| 節見出し | 色 (pixel実測) | #464748 | **#464748** | [OK] |
| 見出し→本体 | PC / SP | 32 (148→180) / 20 (96→116) | 32px / 20px | [OK] |
| 3カラム | 列構成PC | 3列416 / gap 32 | `416px x3` / 32px | [OK] |
| 3カラム | SP | 1列343 / 行gap 20 | `343px` / 20px | [OK] |
| 各列 | 上罫線 | 1px | border-top 1px | [OK] |
| 罫線→名前 | 間隔PC / SP | 13 / 9 | 12px / 8px | [OK] Δ1 |
| 名前 | font-size / lh | 16 / 24 (h24) | 16px / 25.6px | [OK] Δ1.6 |
| 引用 | font-size / lh | 14 / 25 | 14px / 25.2px | [OK] |
| 引用 | 色 (pixel実測) | #585854 | **#585854** | [OK] |

## 9. About / 章切り (明度反転) — PC / SP (Figma 8109:46592 / 8109:46640)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 帯 | 地色 (pixel実測・二重確認) | #464748 (primary) | **#464748** | [OK] |
| 帯 | 上下余白PC | 163.5 | 160px (`lg:py-40`) | [仕様] 注18 |
| 帯 | 上下余白SP | 126 | 128px (`py-32`) | [仕様] 注18 |
| 内容 | 折返し幅 | 480 | 480px (`max-w-120`) | [OK] |
| 内容 | 揃え | 中央 (720が中心) | `text-align: center` | [OK] |
| キッカー | font-size | 12 | 12px | [OK] |
| キッカー | 色 (pixel実測) | #d5d3c0 (sand) | **#d5d3c0** | [OK] |
| 見出し | font-size / lh | 32 / 38.4 (h38) | 32px / 38.4px | [OK] |
| 見出し | 色 (pixel実測) | #f9f8f4 (primary-foreground) | #ffffff | [DS案件] 注19 |
| 本文 | font-size / lh | 14 / 25 | 14px / 25.2px | [OK] |
| 本文 | 色 (pixel実測) | #d5d3c0 | **#d5d3c0** | [OK] |

## 10. 導線ブロック — PC / SP (Figma 8109:46616 / 8109:46648)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 帯 | 地色 (pixel実測・二重確認) | #d5d3c0 (sand) | **#d5d3c0** | [OK] |
| 帯 | 上下余白PC / SP | 96 / 32 | 96px / 32px | [OK] |
| headキッカー | font-size / lh | 12 / 18 | 12px / 21px | [DS案件] 注8 |
| head見出し | 高さ | 45 | 38.4px (32px x 1.2) | [仕様] 注20 |
| headリード | font-size / lh | 16 / 24 | 16px / 28.8px | [DS案件] 注4 |
| head→タイル | 間隔PC / SP | 64 (207→271) / — | 64px / 32px | [OK] |
| タイル | 列構成PC | 4列304 / gap 32 | `304px x4` / 32px | [OK] |
| タイル | 列構成SP | 1列343 / 行gap 32 | `343px` / 32px | [OK] |
| タイル | 上罫線 | 1px | border-top 1px | [OK] |
| タイル | 罫線→キッカー | 24 | 24px (`pt-6`) | [OK] |
| タイル見出し | font-size | 24 (h36 = 24 x 1.5) | 24px | [OK] |
| タイル見出し | line-height | 36 | 33.6px (1.4) | [仕様] 注17 |
| タイル見出し | 色 (pixel実測) | #464748 | **#464748** | [OK] |
| キッカー→見出し | 間隔 | 12 (42→54) | 12px | [OK] |
| 見出し→本文 | 間隔 | 12 (90→102) | 12px | [OK] |
| 本文→リンク | 間隔 | 12 (144→156) | 12px | [OK] |
| タイルリンク | タップ域 | 45 | 44px (`min-h-11`) | [OK] Δ1 |
| タイル数 | | 4 | 4 | [OK] |
| About行 | タイル→About | 64 (472→536) | 64px (`lg:mt-16`) | [OK] |
| About行 | 上罫線 | 1px | border-top 1px | [OK] |
| About行 | 罫線→内容 | 34.5 | 24px (`pt-6`) | [仕様] 注21 |

## 11. 購入導線 (静か・最下部) — PC / SP (Figma 8109:46617 / 8109:46649)

| 対象 | 項目 | Figma実測 | 実装 | 判定 |
|---|---|---|---|---|
| 節 | 上下余白PC / SP | 96 / 64 | 96px / 64px | [OK] |
| リンク | 揃え | 中央 (720が中心) | `justify-center` | [OK] |
| リンク | font-size / lh | 16 / 24 | 16px / 28.8px | [DS案件] 注4 |
| リンク | タップ域 | 24 (テキスト高) | 44px (`min-h-11`) | [仕様] 注22 |
| リンク | 色 (pixel実測) | #464748 | #5d5e61 | [DS案件] 注9 |

## 12. 実行時の健全性

| 項目 | 結果 | 判定 |
|---|---|---|
| `/ja` HTTP status | 200 (PC / SP両ビューポート) | [OK] |
| ブラウザコンソール `error` | **PC 0件 / SP 0件** | [OK] |
| `pageerror` (未捕捉例外) | PC 0件 / SP 0件 | [OK] |
| 横スクロール | document幅 = viewport幅 (1440 / 375) | [OK] |
| 導線先の到達性 | `/ja` `/ja/products` `/ja/journal` `/ja/events` `/ja/subscription` `/ja/about` `/ja/collections` `/ja/farmers` すべて200 | [OK] |
| 存在しないルートへのリンク | 0件 (`/karte` `/monthly` `/diagnosis` `/roji` は未実装のためリンクしない) | [OK] |

---

## 13. Vercel Preview での裏取り (実データ)

Preview: https://elxea-web-ov40uy9m3-setaka1103s-projects.vercel.app (2026-08-09 JST・commit 4f88401)

`PREVIEW_SEED` は Vercel に設定していないので、Preview は **本番 Sanity / Shopify の実データ**で
描かれる。同じハーネス (`scripts/c81-measure.mjs`) を Preview に対して実行し、local の
seed 計測と突き合わせた。

| 項目 | 結果 | 判定 |
|---|---|---|
| `/ja` HTTP status | 200 (PC / SP 両ビューポート) | [OK] |
| ブラウザコンソール `error` | **PC 0 件 / SP 0 件** | [OK] |
| `pageerror` (未捕捉例外) | PC 0 件 / SP 0 件 | [OK] |
| 横スクロール | document 幅 = viewport 幅 (1440 / 375) | [OK] |
| 色 (実ピクセル) | 地色 #ebe9e0 / 章切り #464748 / 導線ブロック #d5d3c0 / 見出し #464748 | [OK] local と全一致 |
| グリッド | 商品 PC `304px x4` gap32 / SP 1列 343 で 2 枚表示 | [OK] local と全一致 |
| 節の余白 | PC / SP とも local 計測と全一致 | [OK] |

### 「データが無い節は出さない」の実データ検証

Preview では実データの都合で一部の節が出ない。これは設計どおりで、**空枠が出ていない**ことの
実機確認になった。

| 節 | Preview での挙動 | 理由 |
|---|---|---|
| 新着・季節の一報 | 3 行表示 | 実記事あり |
| 茶 (EC) | 4 点表示 (SP 2 点) | 実商品あり |
| 茶を探す (カテゴリ) | **1 タイル**表示 | 実 Shopify コレクションが 1 件のみ |
| ジャーナル | 3 行表示 | 実特集記事あり |
| イベント | **節ごと非表示** | 本番 Sanity に未来日のイベントが 0 件 |
| roji 定期便 | 表示 (静的文言) | データ非依存 |
| つくり手の声 (VOICES) | **節ごと非表示** | `quote` が入った農家が 0 件 |
| About 章切り / 導線ブロック / 購入導線 | 表示 | データ非依存 |

Figma 密度 (カテゴリ 6 タイル / イベント 3 行 / VOICES 3 列) での寸法検証は、local の
`PREVIEW_SEED=1` ビルドで実施した (本文 §1-§11 の実測値)。Preview は「実データでの
非表示挙動とコンソール健全性」の裏取りに使っている。

### 導線先の到達性 (Preview 実測)

| リンク元 | 遷移先 | status |
|---|---|---|
| Hero CTA / 購入導線 / 導線ブロック TEA | `/ja/products` | 200 |
| 一報リスト・ジャーナル行 / 導線ブロック JOURNAL | `/ja/journal` | 200 |
| イベント行 / 導線ブロック EVENT | `/ja/events` | 200 |
| 導線ブロック ROJI | `/ja/subscription` | 200 |
| 導線ブロック About 行 | `/ja/about` | 200 |
| カテゴリタイル | `/ja/collections` (+ `/collections/[handle]`) | 200 |
| VOICES 名前 | `/ja/farmers` (+ `/farmers/[slug]`) | 200 |

トップから導線を張っていないが実在する画面 (参考・§注23): `/ja/playlists` 200 / `/ja/signs` 200 /
`/ja/tea-menu` 200。R2 確定版に該当節・該当タイルが無いためリンクしていない。

---

## 注

1. **お茶カルテ診断の節は出していない** — Figma `8110:2514`「3つの質問で、あなたの一杯を。
   お茶カルテ診断へ →」は `/karte` / `/diagnosis` を前提にしているが、両ルートは未実装
   (Structure DBでもDev=Not started)。「存在しないルートへリンクを作らない」制約を優先し、
   節ごと出していない。ルート実装後に `QuietLinkRow` を1行足せば復帰できる。**Setaka判断待ち**。
2. **主見出し52 → 44** — ページ主見出しは44px displayトークンに統一する全体裁定
   (`.hero-display` / `.page-title`)。C3-2R / C4-2 / C4-3と同じ扱い。
3. **フォント** — 承認済み仕様差分 (repo CLAUDE.md「承認済み仕様差分の正本一覧」)。
   フォントはコードが正 (Adobe Fonts kit)。FigmaのInter Boldとの差は仕様。
4. **jp/bodyのline-height 1.75 → 実装1.8** — `typography.style.body` のCJK再束縛
   (tokens/overrides/cjk.json)。Figma 24表記の箇所はFigma側が1.5で組まれており、
   共有トークンを1ページ都合で動かさない方針を踏襲。DS案件に集約。
5. **CTA高さ49 → 48** — spacing scale (0.25rem刻み) に束縛するため48。生pxは使わない。
6. **罫線色 #888675 → #858581** — `--color-border` の実値差。DSトークン整合タスク
   https://app.notion.com/p/3b670c9d064c81668becdbb97c74b510 に集約済み。本タスクでは触らない。
7. **SP主見出し** — SPはbase h1 (32px) を全ページで使う (`.hero-display` はmd+ のみ)。
   Figma SPは28px相当1行だが、32pxでは2行になる。SPのスケール統一を優先。
8. **キッカー / captionのline-height・字間** — `elxea/typography/editorial/en/overline` は
   Figma実値12/1.4/12.5% だが、ページが `:lang(ja)` のため `dist/tokens-cjk.css` の
   再束縛 (lh 1.75 / tracking .15em) が効く。全ページ共通の既知差分でDS案件に集約済み。
9. **本文色 #464748 → #5d5e61** — Figmaの `foreground` はgraphite (#464748)、コードの
   `--color-foreground` はcharcoal (#5d5e61)。**見出しは** `@layer base` の
   `h1-h6 { color: brand-graphite }` に委ねて #464748で一致させた (色utilityを当てない)。
   地の文の差はDSトークン整合タスクに集約済み。
10. **SPキッカー→1行目0 → 16** — Figma SPはキッカーと1行目が接している (y 42 / 42)。
    重なりに近く可読性を欠くため16 (spacing 4) を入れた。
11. **SP行の高さ44 → 53.8** — Figma SPは日付をタイトル本文に畳んで1ブロックにしている。
    実装は日付を別要素に保ち (構造化・`<time>` 相当の分離) SPでは2行目に折り返す。
    タップ域44は満たしている。
12. **節見出しの字間2 → 0.64** — `typography.style.h1-tracking` (.02em) を使用。Figmaの
    jp/h1はletterSpacing 2 (.0625em)。字間はDS案件に集約済み。
13. **SP head→グリッド32 → 24** — SPのブロック間は24 (spacing 6) に統一。
14. **カテゴリタイルの文言・写真は実データ** — Figmaの固定6語 (淹れる/はかる/蒸らす/注ぐ/
    味わう/贈る) を焼くと遷移先が無くリンクが死ぬ。商品一覧R2で「チップ文言はproductType
    から動的に組む (固定文言をコードに焼かない)」とした先例と同方針で、Shopifyコレクション
    (名前 + 写真 + handle) から6件を組み `/collections/[handle]` へ通した。
15. **SP term→value 22 → 4** — 既存共有部品 `SpecBand` の値をそのまま使用 (定期便LP /
    商品詳細と同一部品)。1ページ都合で共有部品を動かさない。
16. **定期便の文言は `subscriptionR2.included1-4` を再利用** — Figma 8110:2530-2541と
    定期便LP `8071:462` は同一4項目。messagesを二重管理せず同じキーを参照した。
    仮当て値レーンの表記 (`各 15g（産地違い）`) にそのまま従う。
17. **見出しのline-height** — CJKトークン (h3 1.45 / h2 1.4) が正。Figmaの1.35 / 1.5との
    差はトークン由来で、全ページ共通。
18. **章切りの上下余白163.5 / 126 → 160 / 128** — spacing scale (4px刻み) に丸めた。
    Δ3.5 / Δ2。生pxは使わない。
19. **章切り見出しの色 #f9f8f4 → #ffffff** — `--color-primary-foreground` の実値が
    `oklch(1 0 0)` = 純白。Figmaは #f9f8f4。DSトークン整合タスクに集約。
    セマンティクス上は `text-primary-foreground` が正しいので実装側は変えない。
20. **導線ブロック見出しの高さ45 → 38.4** — Figmaインスタンス側の見出し枠は45
    (32 x 1.4相当)。実装は節見出しのline-heightを1.2に統一する裁定に従う。
21. **About行の罫線→内容34.5 → 24** — Figmaは1行を上下中央寄せした結果の34.5。
    実装は他のタイルと同じ24 (spacing 6) に揃えた。
22. **静かな導線のタップ域24 → 44** — WCAG 2.5.5 / 2.5.8の最小タップ域44を満たす。
    文字サイズ・色・位置はFigmaどおり。
23. **プレイリスト / みんなの気配への導線は張っていない** — R2 確定版 (`8109:46558` /
    `8109:46620`) に該当する節が無く、導線ブロックも 4 タイル固定 (茶 / ジャーナル / イベント /
    roji)。ルート自体は実在し 200 を返すので、導線を足すかは Figma 改訂側の判断。
    勝手にタイルや節を増やすと忠実度が崩れるため足していない。**Setaka 判断待ち**。

---

## 参照元

- Figma PC: https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8109-46558
- Figma SP: https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8109-46620
- Notion Structure DB「トップ」行: https://app.notion.com/33270c9d064c81c48d19de307d9a1156
- DSトークン整合タスク: https://app.notion.com/p/3b670c9d064c81668becdbb97c74b510 (foreground / 罫線色 / 字間 /
  primary-foreground / muted==backgroundを集約)
- Vercel Preview (実データ裏取り): https://elxea-web-ov40uy9m3-setaka1103s-projects.vercel.app/ja
  (2026-08-09 JST / commit 4f88401)
- 計測ハーネス: `scripts/c81-measure.mjs`

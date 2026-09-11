# C4-2忠実度対比表 — ジャーナル:タグ / ジャーナル:カテゴリ

- Figma SoT: file `AWLnI0XF07e8rScuxPYPc7`
  - タグPC `8082:3855` / SP `8082:4048`
  - カテゴリPC `8083:4073` / SP `8083:4217`
- 実装計測: local production build (`next build` → `next start`) をPlaywrightで
  `getComputedStyle` / `getBoundingClientRect` 実測 (viewport 1440x1000)
  - タグ: `/ja/journal/tag/5de53eded6f9` (レシピ)
  - カテゴリ索引: `/ja/journal/category`
- 計測日時: 2026-08-08 06:19-06:21 JST
- 判定: `[OK]` 一致 / `[仕様]` 意図的な差分 / `[要判断]` Setaka判断待ち

---

## 1. ジャーナル:タグ — PC 1440 (Figma 8082:3855)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| PageHead見出し | font-size | 52px (h73 = 52 x 1.4) | 44px | [仕様] 注1 |
| PageHead見出し | line-height | 72.8 (1.4) | 52.8 (1.2) | [仕様] 注1 |
| PageHead | キッカー→見出し | 12 (17→29) | 12 | [OK] |
| PageHead | 見出し→リード | 12 (102→114) | 12 | [OK] |
| ブロック間 | PageHead→Toolbar | 48 (222→270) | 48 | [OK] |
| ブロック間 | Toolbar→Main | 48 (314→362) | 48 | [OK] |
| Chip | 高さ | 44 | 44 | [OK] |
| Chip | 角丸 | 全丸め (pill) | `1.67772e+07px` (rounded-full) | [OK] |
| Main | グリッド↔サイドバーgap | 32 (936→968) | 32 | [OK] |
| ArticleList | カード幅 | 452 | 452 | [OK] |
| ArticleList | column-gap | 32 (484-452) | 32 | [OK] |
| ArticleList | row-gap | 64 (460 pitch - 396) | 64 | [OK] |
| ArticleRail | 幅 | 344 | 344 | [OK] |
| TagMap | 前ブロックとの間隔 | 144 (Content下余白112 + 32) | 144 (margin-top) | [OK] |
| TagMap | 区切り罫 | 1px全幅1312 | 1px (border-top) | [OK] |
| TagMap | 罫→見出し | 64 (33→97) | 64 (padding-top) | [OK] |
| TagMap見出し | font-size | 20px (h27) | 20px | [OK] |
| TagMap見出し | line-height | 27 (1.35) | 29 (CJK h3 1.45) | [仕様] 注2 |
| TagMap | 見出し→列 | 40 (27→67) | 40 | [OK] |
| TagMap | 列構成 | 3列x 416 | `416px 416px 416px` | [OK] |
| TagMap | column-gap | 32 (448-416) | 32 | [OK] |
| TagMap行 | 高さ | 57 (16 + 25 + 16) | 57.2 | [OK] Δ0.2 (注2) |
| TagMap行 | font-size | 14px (w73/5字) | 14px | [OK] |
| MoreRow | 高さ / 角丸 | 48 / pill | C4-1共有部品 (`MoreRow`) を再利用 | [OK] 注3 |

## 2. ジャーナル:カテゴリ (索引) — PC 1440 (Figma 8083:4073)

| 対象 | 項目 | Figma実測 | 実装 (getComputedStyle) | 判定 |
|---|---|---|---|---|
| 主見出し | font-size | 32px (w228/7字, h38) | 44px | [仕様] 注1 |
| 主見出し | line-height | 38 (1.2) | 52.8 (1.2) | [仕様] 注1 |
| TitleCol | 最大幅 | 832 | 832px | [OK] |
| リード | 最大幅 | 640 | 640px | [OK] |
| Head | キッカー→見出し | 12 (17→29) | 12 | [OK] |
| Head | 見出し→リード | 12 (67→79) | 12 | [OK] |
| MetaCol | 行数 / 配置 | 2行 / 右寄せ | 2行 / `text-align: right` | [OK] |
| MetaCol | font-size | 12px (h18) | 12px | [OK] |
| MetaCol | 行間 | 6 (18→24) | 6 | [OK] |
| ブロック間 | Head→NavBar | 48 (421-373相当) | 48 | [OK] |
| Chip | 高さ | 44 | 44 | [OK] |
| CategoryShelf | 上余白 | 64 | 64px (padding-top) | [OK] |
| ShelfHead | 枠の高さ | 44 | 44 (`min-h-11`) | [OK] 注4 |
| ShelfHead見出し | font-size | 16px (w82/5字, h24) | 16px | [OK] |
| ShelfHead見出し | line-height | 24 (1.5) | 25.6 (CJK 1.6) | [仕様] 注2 |
| ShelfHead本数 | font-size | 12px (h18) | 12px | [OK] |
| Shelf | ShelfHead→カード | 40 (108→148) | 40 | [OK] |
| ShelfCards | 列構成 | 3列x 416 | `416px 416px 416px` | [OK] |
| ShelfCards | column-gap | 32 (448-416) | 32 | [OK] |
| Shelf | カード→もっと見る | 40 (544→584) | 40 | [OK] |
| MoreLink | 高さ (タップ域) | 42 | 44 (`h-11`) | [仕様] 注5 |
| MoreLink | font-size | 12px (h18) | 12px | [OK] |

## 3. SP 375 (Figma 8082:4048 / 8083:4217)

Figma SPフレームはPCの簡易版 (タグSPはPageHeadのキッカー・リードを省略、
カテゴリSPはMetaを1行に連結) として描かれている。実装は次のとおり。

| 対象 | Figma SP | 実装 | 判定 |
|---|---|---|---|
| タグPageHead | 見出しのみ (キッカー・リード無し) | C4-1共有 `ListPageHead` (キッカー + 見出し + リード) | [仕様] 注6 |
| Chips | 横スクロール / h44 / gap8 | `overflow-x-auto` / `h-11` / `gap-2` (C3共有) | [OK] |
| ArticleGrid | 2列163.5 / gap-x16 / gap-y32 | `grid-cols-2 gap-x-4 gap-y-8` | [OK] |
| ArticleRail | MoreRowの下に積み上げ / 人気3件 | `order-3` / 4件目以降 `hidden lg:block` (C4-1) | [OK] |
| TagMap | 1列 / 行h57 / 末尾に「すべてのタグ →」 | 1列 / 行57 / 末尾リンクなし (全件表示) | [仕様] 注7 |
| CategoryShelf | カード1枚 / head→カード24 / カード→リンク24 | 2枚目以降 `hidden lg:flex` / `mt-6` | [OK] |
| CategoryStackHead Meta | 1行に連結 | `lg:hidden` の連結1行 + PCは2行 | [OK] |

---

## 注記

1. **注1 (見出し44px)** — Setaka/Boss裁定 (2026-08-08):「ページ主見出しは一覧・
   詳細とも44px display (`.page-title`) で統一」。Figma側のfunctional 52px /
   32px束縛はFigma側を追従修正中。実装はDS最大のdisplayトークン
   (44px / lh 1.2) を正とする。生pxは書かずトークン経由。
2. **注2 (CJK行高差)** — `dist/tokens-cjk.css` が `:lang(ja)` で行高を再束縛する
   ため、Figmaの英字基準line-heightと1-2pxずれる。共有トークンの挙動であり
   1ページ都合で動かさない (C2/C3/C4-1 と同じ既知差分)。
3. **注3 (MoreRow)** — 計測に使ったタグ「レシピ」は記事6件以下のためMoreRowが
   出ない。部品はC4-1で計測済みの `components/catalog/catalog-list.tsx` の
   `MoreRow` をそのまま使用しており、実装差分はない。
4. **注4 (ShelfHead枠)** — FigmaのShelfHeadはh44の枠に行高24の見出しを
   上寄せで置く形。初回実装は枠を持たず見出しcontent高 (25.6) だったため、
   `min-h-11` を当てて枠ごと再現した (Vercel PreviewのHTMLで `min-h-11` 出力を確認)。
5. **注5 (MoreLink高さ)** — Figma 42に対し実装44。44はWCAG 2.5.5/2.5.8系の
   最小タッチ域で、Figma側も同ページのChip / Rail行は44を採る。2pxの増加は
   タップ域の下限を割らないための意図的な切り上げ。
6. **注6 (SP PageHead)** — Figma SPフレームは簡易モックでキッカー・リードが
   省略されているが、PCと同じ情報階層をSPでも保つためC4-1と同一の
   `ListPageHead` を使う。一覧 (journal) / 商品一覧 / お茶メニューのSPも同じ扱い。
7. **注7 (SPタグマップ)** — Figma SPは8件 + 「すべてのタグ →」。タグ一覧ページは
   確定版に存在せずリンク先が無いため、SPでも全件を1列で表示して同等の到達性を
   確保した。タグ一覧ページを新設する判断が出た時点で切り替える。

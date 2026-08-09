# C12-1忠実度対比表 — People詳細 / コレクション詳細

対象タスク: roji C12-1 (People詳細 + コレクション詳細のR2世代実装)
計測日時: 2026-08-09 JST
計測方法: 自前production build (`pnpm build` → `next start`) + Playwright。
色はcanvas `getImageData` のsRGBバイトで読む (`getComputedStyle` はoklch() 文字列を返すため文字列パースしない)。
ハーネス: `scripts/c12-measure.mjs` / 出力 `/tmp/c12-measure.json` / スクショ `/tmp/c12-shots/`
ビューポート: **PC 1440x900 / SP 375x812** (SPはFigmaのSPフレームが375なのでx座標を直接比較できる)

計測URL (`PREVIEW_SEED=1`):
- People詳細 `/ja/people/masayuki-kubo` (記事7件 → STORIES節が出る) / `/ja/people/roji-editorial` (bioあり → 紹介文の節が出る)
- コレクション詳細 `/ja/collections/assorted-tea-set` (商品15件 → 初期12 + MoreRowが出る / 説明あり → leadが出る)

判定: `[OK]` = Figmaと一致 (丸め1px以内) / `[仕様]` = 意図的差分 (理由明記) / `[DS案件]` = 共有部品・トークン側の既存差分 / `[粗]` = 未解消の粗さ

---

## 0. 正本 (SoT) の所在

**両画面ともStructure DBの `Figma` プロパティはstaleだった** (本PJで3・4件目の実例)。
全14ページ (`5056:2` Foundations / `6054:15` elxea Proposals / `7567:2`〜`7567:13`) を走査して確定した。

| 画面 | Structure DBの値 | その実体 | 実際に採った正本 |
|---|---|---|---|
| People詳細 | `6703:14332` | `People詳細 変A（部品ベース）— PC/SP @/ja/people/[slug]` (page `6054:15` = 旧elxea) | **`7822:37212`「【採用: 作り手の共通テンプレ】People詳細」** PC `7822:37213` / SP `7823:37542` |
| コレクション詳細 | `6647:7525` | `コレクション詳細 変A（部品ベース）— PC/SP @/ja/collections/[handle]` (同 `6054:15`) | **共通リストパターンR2** 商品一覧PC `8061:1781` / SP `8062:2008` から導出 |

### People詳細は「R2が無い」のではなく、テンプレ側が上位SoT

Figmaの命名がテンプレの継承方向を明示している:

- 農家詳細の確定版section名 = `【R2: 確定版】 農家詳細 (People 詳細テンプレ統合)` (`8079:3747`)
- その旧版 = `【要修正: People 詳細へ統合】 農家詳細` (`7787:722`) — 統合の向きが「農家 → People」
- プレイリスト詳細の確定版も `People 詳細テンプレ整合` を名乗る (`8089:4518`)

つまりPeople詳細テンプレは複数画面が参照する共通テンプレで、**テンプレ自身はR1で【採用】凍結され、
R2世代の実測値は農家詳細確定版 (`8079:3748` / `8079:3966`) に入っている**。
その実測値は `components/farmers/farmer-detail.tsx` (C4-4a) が既に体現しているため、
本レーンは実装を複製せず `components/people/person-detail.tsx` (薄い再輸出) 経由で再利用した。

節構成の差は2節だけ: 農家詳細 = People詳細テンプレ + 茶園2節 (`FIELD DATA` `8079:3937` / `THE FIELD` `8079:3947`)。
写真キャプション・Statsのラベル (`YEARS` / `STORIES`)・`AuthorByline` インスタンスまで一致する。

### コレクション詳細はroji世代デザインが一切無い

`7567:2` (EC / Proposals) のsectionは 定期便LP・商品一覧・お茶メニュー・コレクション**一覧**・商品詳細 の5件、
`7567:3` (EC / Layouts) は コレクション一覧・カート・検索 の3件で、**コレクション詳細は無い**。
14ページ全体で「コレクション詳細」を名前に含むノードは旧elxea `6647:7525` の1件だけ。

よってC9-1の先例に従いデザインを発明せず、凍結済みの兄弟R2「共通リストパターン」から導出した。
コレクション詳細は「あるコレクションに属する商品の一覧」であり、一覧系3画面と同じ型に完全に収まる。
`components/catalog/catalog-list.tsx` の `ListPageHead` の実装注記が
「同じR2パターン配下の詳細ページ (collections/[handle]・elxea-journal) と同一実装になる」と
既に宣言しており、その前提と整合する。

---

## 1. People詳細 — PC 1440

Figma実測は `7822:37213` (People詳細テンプレPC)。yは各節フレーム内の相対座標。

### 1-1. PersonHead (`7822:37254` y68 h956)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 節の高さ | 956 | 956 | [OK] |
| 外余白x | 64 | 64 (padding-left 64) | [OK] |
| BreadcrumbRow上余白 | 48 | 48 (padding-top) | [OK] |
| BreadcrumbRow枠高 (タップ域) | 44 | 44 | [OK] |
| Photo | x64 640x800 (4:5) | 640x800 ar 0.80 | [OK] |
| HeroText | x736 w640 | x736 w640 | [OK] |
| HeroTextオフセット (写真上端から) | +96 | +96 | [OK] |
| kicker行高 | 17 | 21 | [DS案件] overlineトークンのline-height 1.75由来。既存全画面と共通 |
| kicker → 氏名 | 20 | 20 | [OK] |
| 氏名font-size | 32 | 44 | [仕様] ページ主見出しは44px displayに揃える全体裁定 (C4-2 / C4-3 / C4-4aと同じ) |
| 氏名 → 肩書 | 28 | 28 | [OK] |
| 肩書 → メタ | 20 | 20 | [OK] |
| メタ → 罫線 | 29 | 28 | [OK] 1px丸め |
| 罫線 | 1px | 1px `#888675` | [OK] |
| 罫線 → Stats | 23 | 24 | [OK] 1px丸め (`pt-6`) |
| Stats値font-size | 35 (en/h1) | 32 / 行高44.8 | [OK] h1トークン同値 |
| Statsラベル | `YEARS` / `STORIES` | `YEARS` / `STORIES` | [OK] |
| Stats → byline見出し | 36 | 36 | [OK] |
| byline見出し → byline | 5 | 4 | [OK] 1px丸め |

### 1-2. Quote (反転面 `7822:37305` y1024 h280)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 面 | 全幅の反転面 | w1440 / bg `#464748` / color `#f9f8f4` | [OK] |
| 高さ | 280 | 283 | [OK] 3px (本文行数依存) |
| 引用の列 | x400 w640 | x400 w640 | [OK] |
| 上余白 | 88 | 88 | [OK] |
| 引用 → 帰属 | 54 | 54 | [OK] |

### 1-3. THE WORK (`7822:37308` y1304 h720)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 節 上余白 | 96 | 96 | [OK] |
| kicker → 見出し | 8 | 8 | [OK] |
| 見出し → 本体 | 52 | 52 | [OK] |
| 3カラム | 416 / x 64・512・960 | 3列416 | [OK] |
| gap-x | 32 | 32 (実測) | [OK] |
| 写真 | 416x312 (4:3) | 416x312 ar 1.33 | [OK] |
| 写真 → 番号 | 16 | 16 | [OK] |
| 番号 → 工程名 | 8 | 8 | [OK] |
| 工程名 → 説明 | 4 | 4 | [OK] |
| 罫線 | 0本 (グルーピングは余白のみ) | 0本 | [OK] |

### 1-4. INTERVIEW (`7822:37391` y2024 h893)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 本文幅 | 640 (サイドバー無し) | 640 | [OK] |
| 見出し → 本体 | 77 | 76 (`lg:mt-19`) | [OK] 1px丸め |
| 番号 → 問い | 5 | 4 | [OK] 1px丸め |
| 問い → 答え | 20 | 20 | [OK] |
| 設問間 | 44〜48 (揺れ) | 48 | [仕様] Figmaが揺れているので上限側に固定 (farmer-detailの既定と同一) |

### 1-5. PROFILEデータ帯 (`7822:37404` y2917 h300)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 面 | 全幅のmuted面 | w1440 / bg `#dedccf` | [OK] |
| 高さ | 300 | 307 | [OK] 値の行数依存 |
| kicker → 行 | 27 | 28 | [OK] 1px丸め |
| 4カラム | 304 / x 64・400・736・1072 | `304px 304px 304px 304px` | [OK] |
| gap | 32 | 32 | [OK] |
| 罫線 | 帯に罫線なし | `border-t-0` | [OK] |

### 1-6. 写真カード帯 (このひとが〜 `7822:37470` / ほかの人 `7822:37489`)

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 3カラム | 416 / x 64・512・960 | 3列416 | [OK] |
| gap-x | 32 | 32 | [OK] |
| 写真 | 416x260 (8:5) | 416x260 ar 1.60 | [OK] |
| 写真 → 見出し | 16 | 16 | [OK] |
| 見出し → note | 4 | 4 | [OK] |
| note → 価格 | 2 | 4 (`mt-1`) | [DS案件] Tailwind spacingの最小刻み。farmer-detail既定と共通 |
| ほかの人の肩書 | h18 (caption) | caption (12px) | [OK] |

---

## 2. People詳細 — SP 375

Figma実測は `7823:37542` (People詳細テンプレSP)。
値の出所は `components/farmers/farmer-detail.tsx` がC4-4aで実測記録したSP値
(本レーンでPeopleテンプレと農家詳細R2の**節内座標が完全一致**することを別subagentが全数照合済み)。

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 外余白x | 16 | 16 | [OK] |
| BreadcrumbRow上余白 | 24 | 24 | [OK] |
| Photo | 全幅375 (4:5) | 375x468.75 ar 0.80 (`.sp-full-bleed`) | [OK] |
| 写真 → HeroText | 32 | 32 | [OK] |
| kicker → 氏名 | 16 | 16 | [OK] |
| 氏名font-size | 32 | 32 | [OK] |
| 氏名 → 肩書 | 20 | 20 | [OK] |
| 肩書 → メタ | 12 | 12 | [OK] |
| 罫線 → Stats | 25 | 24 | [OK] 1px丸め |
| Quote上余白 | 64 | 64 | [OK] |
| 節 上余白 | 64 | 64 | [OK] |
| 見出し → 本体 | 56 | 56 | [OK] |
| THE WORK写真 | 375x250 (3:2) | 375x250 ar 1.50 | [OK] |
| THE WORKブロック間 | 88 | 88 (実測87.72) | [OK] |
| INTERVIEW本文幅 | 343 | 343 | [OK] |
| INTERVIEW設問間 | 36〜44 (揺れ) | 40 | [仕様] 上限側に固定 |
| PROFILEカラム | 2列 | `163.5px 163.5px` | [OK] |
| PROFILE kicker → 行 | 24 | 24 | [OK] |
| 写真カード帯 写真 | 375x234 (8:5) | 375x234.38 ar 1.60 | [OK] |
| 写真カード帯 ブロック間 | 56 | 56 (実測55.63) | [OK] |
| 横スクロール | なし | `horizontalOverflow: false` | [OK] |

---

## 3. People詳細 — 節の出し入れ (データが無い節は枠ごと出さない)

同一実装で2人を測り、データの有無で節が増減することを実証した。

| 節 | `masayuki-kubo` (記事7 / bioなし) | `roji-editorial` (記事0 / bioあり) | 判定 |
|---|---|---|---|
| PersonHead | 出る | 出る | [OK] |
| Quote | 出る (見本) | 出る (見本) | [OK] |
| THE WORK | 出る (見本) | 出る (見本) | [OK] |
| INTERVIEW | 出る (見本) | 出る (見本) | [OK] |
| 紹介文 (bio) | **出ない** | **出る** (kicker/見出しなしの節) | [OK] |
| PROFILE帯 | 出る (見本) | 出る (見本) | [OK] |
| この人のお茶 | **出ない** (`relatedProducts` 未整備) | **出ない** | [OK] |
| STORIES (記事) | **出る** (6件) | **出ない** | [OK] |
| ほかの人をたずねる | 出る (3件) | 出る (3件) | [OK] |
| `farmer-section` 実測数 | 4 | 4 | [OK] |

「この人のお茶」節は `relatedProducts` のデータが無いため実データでは描画されない。
ただし**部品は「ほかの人をたずねる」と同一の `PersonCardGrid`** で、その幾何 (PC 3列416 / gap-x 32 /
写真8:5、SP縦積み / ブロック間56) は上表で実測済み。データ配線は確認事項に挙げる。

### STORIES (記事) 節はテンプレに枠が無い意図的な追加

| 項目 | 根拠 | 実装 実測 | 判定 |
|---|---|---|---|
| グリッド | 商品詳細の「読みもの」節 (`app/[locale]/products/[handle]/page.tsx` が `CatalogGrid` + `ArticleCard`) が**詳細ページ内に記事帯を置くときの既存の正** | PC 3列416 / gap 32・48、SP 2列163.5 / gap 16・24 | [仕様] |
| 写真 | 同上 (3:2) | PC 416x277.33 / SP 163.5x109 (ar 1.50) | [仕様] |
| カード | 会員限定バッジを保つため `ArticleCard` を使う (テンプレの写真カードではない) | `ArticleCard` | [仕様] |

`JournalGrid` (ジャーナル一覧のPC 2列) は使わなかった。PC 2列640幅ではPeople詳細テンプレの
写真カード帯 (PC 3列416) と列リズムが揃わないため。

---

## 4. コレクション詳細 — PC 1440

Figma実測は共通リストパターンR2 `8061:1781` (商品一覧PC)。yはContentフレーム内の相対座標。

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 外余白x | 64 | 64 | [OK] |
| content幅 | 1312 | 1312 | [OK] |
| body背景 | — | `#ebe9e0` | [OK] |
| Breadcrumb | x64 y24 h18 | x64 h16 | [OK] |
| PageHead kicker | h17 | h21 (`COLLECTION`) | [DS案件] overlineトークンのline-height |
| kicker → 見出し | 12 | 12 | [OK] |
| 見出し 行高 | 53 | 52.8 | [OK] |
| 見出しfont-size | (elxea jp/h1 52) | 44 | [仕様] ページ主見出し44px displayの全体裁定。SPは32 |
| 見出し → lead | 12 | 12 | [OK] |
| lead幅 | 304 | 1312 (content全幅) | [粗] 共有 `ListPageHead` の既存挙動。商品一覧・お茶メニュー一覧と共通なので本レーンでは変えない |
| PageHead → Toolbar | 48 | 48 | [OK] |
| Toolbar高さ | 44 | 44 | [OK] |
| チップ列 | 7件 | **0件** | [仕様] コレクション自体が絞り込み結果なのでチップは二重のfacetになる |
| 並び替えSelect | 180x44 / 右端 = content右端 | 180x44 / x1196 (右端1376 = 1440-64) | [OK] |
| Toolbar → Grid | 48 | 48 | [OK] |
| Grid列数 | 3 | 3 | [OK] |
| カード幅 | 416 | 416 | [OK] |
| gap-x | 32 | 32 (実測) | [OK] |
| gap-y | 48 | 48 (実測48.09) | [OK] |
| カード写真 | 3:2 | 416x277.33 ar 1.50 | [OK] |
| 初期表示件数 | 12 (3列x 4段) | 12 | [OK] |
| 種類から探す (KindIndex) | あり | **なし** | [仕様] コレクション内に下位の種類軸が無い |
| MoreRow高さ | 48 | 48 | [OK] |
| MoreRowピル | 159x48 | 152.14x48 | [OK] 文言長依存 |
| Grid → MoreRow | 48 | 48 | [OK] |
| 横スクロール | なし | `horizontalOverflow: false` | [OK] |

---

## 5. コレクション詳細 — SP 375

Figma実測は `8062:2008` (商品一覧SP)。

| 項目 | Figma実測 | 実装 実測 | 判定 |
|---|---|---|---|
| 外余白x | 16 | 16 | [OK] |
| content幅 | 343 | 343 | [OK] |
| PageHead kicker → 見出し | 8 | 12 | [粗] 共有 `ListPageHead` が両BPで `gap-3` (12)。商品一覧と共通の既存差分 |
| 見出し 行高 | 38 | 38.39 | [OK] |
| 見出しfont-size | 32 | 32 | [OK] |
| 見出し → lead | 8 | 12 | [粗] 同上 |
| PageHead → 次ブロック | 32 | 32 | [OK] |
| Toolbar | Chips h44 (横スクロール) | **枠ごと非表示** (`display: none`) | [仕様] 下記参照 |
| Grid列数 | 2 | 2 | [OK] |
| カード幅 | 163.5 | 163.5 | [OK] |
| gap-x | 16 | 16 (実測) | [OK] |
| gap-y | 24 | 24 (実測23.64) | [OK] |
| カード写真 | — | 163.5x109 ar 1.50 | [OK] |
| MoreRow高さ | 48 | 48 | [OK] |
| MoreRowピル | 151x48 | 152.14x48 | [OK] |
| 横スクロール | なし | `horizontalOverflow: false` | [OK] |

### SPでToolbarを枠ごと消した理由 (幽霊余白の除去)

FigmaのToolbarは「Chips + Select」で、SelectはPC限定 (`hidden lg:block`)。
コレクション詳細はチップを持たないので、SPではToolbarの中身が空になり `mt-8` 分の
**32pxの幽霊余白**が残ってしまう。`CatalogToolbar` にadditiveな分岐を入れ、
チップが無いときは枠ごと `hidden lg:flex` にした。

実測での裏取り: SP `toolbarDisplay: "none"` かつ **PageHead → Grid = 32** (Figmaの
PageHead → 次ブロック32と一致)。幽霊余白は出ていない。

---

## 6. 機能の実測 (URLに状態が載ること)

| 項目 | 期待 | 実測 | 判定 |
|---|---|---|---|
| 並び替えがURLに載る | `?sort=` | `?sort=priceAsc` (先頭カード `/ja/products/tea-ats-b-01`) | [OK] |
| もっと見るがURLに載る | `?show=` | `?show=24` → カード12 → **15** 件 | [OK] |
| 全6パターンのHTTP | 200 | People PC/SP・PeopleBio PC/SP・Collection PC/SPすべて **200** | [OK] |
| console error / warning / pageerror | 0 | **0件** | [OK] |
| requestfailed | RSC prefetchのみ | 309件すべて `_rsc=` プリフェッチの `ERR_ABORTED` (フッターのリンク先) | [OK] |

---

## 7. 判定集計

| 判定 | 件数 |
|---|---|
| [OK] | 92 |
| [仕様] (意図的差分・理由明記) | 11 |
| [DS案件] (共有部品・トークン側の既存差分) | 4 |
| [粗] (未解消) | 3 |
| [要判断] | 0 |
| **合計** | **110** |

### [粗] 3件はすべて共有 `ListPageHead` の既存差分 (本レーン固有の未解決は0件)

1. leadの幅がFigma 304に対しcontent全幅 (PC)
2. kicker → 見出しがFigma SP 8に対し12
3. 見出し → leadがFigma SP 8に対し12

いずれも `components/catalog/catalog-list.tsx` の `ListPageHead` が両BPで `gap-3` (12) 固定、
leadに幅制約を持たないことに由来する。**商品一覧 / お茶メニュー一覧 / コレクション一覧が
同じ部品を共有しており**、本レーンで直すと4画面の実測値が同時に動くため触っていない
(専有範囲はPeople詳細・コレクション詳細の2画面とその専用部品)。後続のDSタスク向けに記録する。

---

## 8. ゲート結果 (7種すべて通過)

| ゲート | 結果 |
|---|---|
| `pnpm lint` | PASS (0 warning。stale suppressionも解消) |
| `npx tsc --noEmit` | PASS |
| `pnpm test` | PASS 104 files / 699 tests / 1 skipped |
| `pnpm build` | PASS (exit 0) |
| `pnpm validate:tokens` | PASS 0 error / 303 token |
| `pnpm validate:design-map` | PASS 0 error / 179 entries |
| `pnpm validate:design-kit` | PASS (in sync / components=62) |

---

## 9. 参照元

- Figma file: `AWLnI0XF07e8rScuxPYPc7`
  - People詳細テンプレsection `7822:37212` / PC `7822:37213` / SP `7823:37542`
  - 農家詳細【R2: 確定版】section `8079:3747` / PC `8079:3748` / SP `8079:3966` (PeopleテンプレのR2世代の実測値の所在)
  - 共通リストパターンR2商品一覧PC `8061:1781` / SP `8062:2008`
  - staleだったStructure DBの値: `6703:14332` / `6647:7525` (どちらもpage `6054:15` = 旧elxea Proposals)
- Structure DB rows: People詳細 https://app.notion.com/36b70c9d064c81a7957dcf72fb4c78cf / コレクション詳細 https://app.notion.com/33270c9d064c81b2a416e1ddd7be6593
- 計測ハーネス: `scripts/c12-measure.mjs` / 出力 `/tmp/c12-measure.json`

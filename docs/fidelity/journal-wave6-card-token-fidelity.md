# elxea Journal Wave 6 — cardトークンFigma実測vs実装getComputedStyle忠実度対比表

- 対象ブランチ / コミット: `feat/journal-polish-s1` / `e9cc7de`
- Figma file: `AWLnI0XF07e8rScuxPYPc7`
- 作成: 2026-08-11 JST / 作成者: elxea-developer

## 測定方法（Wave 3表との違い）

Wave 3の対比表は「ソース上の値の一致」までで、ランタイム検証が未完だった（同表「次工程（必須）」）。
本表はその宿題を果たし、**実ブラウザの `getComputedStyle` 実測値**で対比する。

- **Figma側**: `mcp__figma__get_variable_defs` が返す変数実測値。推測値なし。
- **実装側**: **production build**（`pnpm build` → `pnpm start -p 3111`）をPlaywrightで開き、
  `getComputedStyle` が返した値。dev serverはHMR WebSocket不通でハイドレーションが完了せず
  モーダルが開かなかったため、production buildを使用した。
- Chromeは `oklch()` 由来の色をCIE `lab()` 形式でシリアライズするため、
  実測 `lab()` をD50 → sRGB変換してhexに戻して照合した（変換は自前実装・外部依存なし）。
- コントラスト比はWCAG 2.x相対輝度式で算出。丸めない。

## 1. トークン実測値の対比（`:root` のCSSカスタムプロパティ）

| # | トークン | Figma実測 | 実装getComputedStyle | hex復元 | delta |
|---|---|---|---|---|---|
| 1 | `card` | **#f4f3ed** | `lab(95.7643% -.432074 3.01552)` | **#f4f3ed** | **0** |
| 2 | `card-foreground` | (変数未定義・`foreground` 継承) | `lab(39.8832% .072524 -1.89292)` | #5d5e61 | 注1 |
| 3 | `secondary` | #d5d3c0 | `lab(84.2979% -1.73408 9.8045)` | #d5d3c0 | 0 |
| 4 | `background` | #ebe9e0 | `lab(92.3054% -.457197 4.56204)` | #ebe9e0 | 0 |
| 5 | `popover` | #f9f8f4 | `lab(92.3054% -.457197 4.56204)` | #ebe9e0 | 注2 |
| 6 | `muted` | #dedccf | `lab(92.3054% -.457197 4.56204)` | #ebe9e0 | 注3 |
| 7 | `border` | #888675 | `lab(55.3911% -.589073 2.19213)` | #858581 | 注4 |
| 8 | `input` | #adaca0 | `lab(55.3911% -.589073 2.19213)` | #858581 | 注4 |
| 9 | `foreground` | #464748 | `lab(39.8832% .072524 -1.89292)` | #5d5e61 | 注1 |

- 注1: Figmaの `foreground` はgraphite #464748、実装の `--color-foreground` はcharcoal #5d5e61。
  Wave 6の差分ではなく既存のトークン定義差。card面上で5.83:1とAAを通過するため据え置いた。
- 注2: Figma `popover` #f9f8f4に対し実装cream #ebe9e0。Wave 3表 #18と同一の既知差分。
- 注3: Figma `muted` #dedccfに対し実装cream #ebe9e0。**`background` と同値になっており
  `hover:bg-muted` がコントラスト1.000で不可視**。Wave 3表 #29の本体。W7の対象。
- 注4: Figma `border` #888675 / `input` #adaca0に対し実装は両方 #858581。既存のトークン定義差。

**Wave 6が動かしたのは #1のみ**。#1はdelta 0（完全一致）を達成した。

## 2. 実要素の面色 実測（B1 / B3）

| # | 対象 | セレクタ | Figma実測 | 実装実測 (hex復元) | delta |
|---|---|---|---|---|---|
| 10 | モーダル本体面 | `[data-slot="journal-modal-body"]` の親 | popover #f9f8f4 | #ebe9e0 | 注2 |
| 11 | モーダルフッター面 | `[data-slot="journal-modal-body"] + div` | card **#f4f3ed** | **#f4f3ed** | **0** |
| 12 | フッターpill静止 | 同上内 先頭 `button` | 透過（フッター面） | `rgba(0,0,0,0)` | 0 |
| 13 | フッターpill押下中 | 同上 + `mouse.down()` | secondary #d5d3c0 | **#d5d3c0** | **0** |
| 14 | ブックマーク既定面 | `button[data-state="logged-out"]` | card **#f4f3ed** | **#f4f3ed** | **0** |
| 15 | ブックマーク保存済み面 | 同位置にactiveクラスprobe | secondary #d5d3c0 | **#d5d3c0** | **0** |
| 16 | ブックマーク保存済み罫 | 同上 | foreground | #464748 | 0 |
| 17 | AudioBlock track面 | `audio-block.tsx:169` | background #ebe9e0 | 測定不能（注5） | — |

- 注5: 現行Sanityデータセットの記事10本すべてでAudioBlockが描画されない
  （`data-slot="audio-block"` の出現0件）ためruntime実測は不能。静的解析のみ。

## 3. Wave 6が解消した破綻（コントラスト実測）

| # | 破綻 | before | after | 閾値 | 判定 |
|---|---|---|---|---|---|
| 18 | B1モーダルフッター面vs pill押下面 | 1.000 | **1.358** | 1.3 | [OK] |
| 19 | B3ブックマーク既定面vs保存済み面 | 1.000 | **1.358** | 1.3 | [OK] |
| 20 | B2 SoundCloudリンク（card非該当） | — | 変化なし | — | [SKIP] |

B2は診断が誤り。当該リンクは `bg-card` ではなく `bg-background` のセクション内にあり、
真因は注3（`muted` == `background` でhover不可視）。W7で扱う。

## 4. card面上の前景コントラスト（退行チェック）

| # | 前景 | before (card #d5d3c0) | after (card #f4f3ed) | 基準 | 判定 |
|---|---|---|---|---|---|
| 21 | card-foreground #5d5e61 | 4.294 | **5.832** | AA 4.5 | [OK] 新規通過 |
| 22 | muted-foreground #585854 | 4.732 | **6.428** | AA 4.5 | [OK] |
| 23 | border/input/ring #858581 | 2.453 | **3.332** | UI 3.0 | [OK] 新規通過 |
| 24 | destructive #b9525c | 3.144 | **4.270** | AA 4.5 | [WARN] 改善するが未達 |
| 25 | primary #464748 | 6.167 | **8.376** | AA 4.5 | [OK] |

退行はゼロ。#24はWave 6以前から未達で、改善はしたが解消はしていない。

## 5. 面分離の副作用（罫線なしcardの3箇所）

card面と親面 (#ebe9e0) の差は1.241 → **1.094** に縮み、cardは「地より濃い面」から
「地より淡い面」へ反転する。罫線を持たない下記3箇所は面分離が弱まる。

| # | 箇所 | 罫線 | afterのコントラスト |
|---|---|---|---|
| 26 | `journal-modal.tsx:146` フッター | なし | 1.094（Figmaは1.046でさらに薄い） |
| 27 | `empty-state.tsx:43` | なし | 1.094（Figma同値） |
| 28 | `track-row.tsx:59` 再生中の行 | なし | 1.094（Figma同値） |

いずれもFigma準拠の帰結であり、Figma側の面分離はこれより弱いか同等。
残る12箇所（login x2 / password / membership / cart / audio-player /
audio-block interview / bookmark-button / ui/card / ui/alert）は `border` を持つため
罫線で面分離が担保される（#23で3.332:1を確保）。

## 集計

- 対比項目: **28**
- Wave 6が動かした項目: **1**（#1 card）→ delta **0**
- 解消した破綻: **2**（B1 / B3）
- 未解消・別課題として送り: **1**（B2 = `muted` == `background`）
- 既存トークン定義差（Wave 6起因ではない）: **5**（注1-注4）
- 退行: **0**

## 未解決（W7候補）

1. **`muted` をFigma正 #dedccfへ是正** — 現状 `background` と同値で `hover:bg-muted` が
   全面的に不可視（B2の真因 / `reading-row` のhoverも同様）。
2. **`pnpm validate:design-kit` の再生成** — 着手前から51箇所ずれで失敗しており、
   本コミットで52件目（card値）が加わる。無関係なshadcnコンポーネント一覧50件を
   巻き込むため単独コミットで処理すること。
3. **`popover` / `border` / `input` / `foreground` のFigma差** — 注1・注2・注4。

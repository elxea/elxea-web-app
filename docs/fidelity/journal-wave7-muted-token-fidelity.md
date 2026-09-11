# elxea Journal Wave 7 — mutedトークン是正Figma実測vs実装ランタイム実測

- 対象ブランチ: `feat/journal-polish-s1`
- Figma file: `AWLnI0XF07e8rScuxPYPc7`
- 作成: 2026-08-11 JST / 作成者: elxea-developer

## 何をしたか

Wave 6でB2 (SoundCloudリンクのhoverが見えない) の真因として特定した
**`--color-muted` と `--color-background` の同値問題** を、Figma正の値に是正した。

| | 旧値 | 新値 |
|---|---|---|
| `color.semantic.muted` | `oklch(0.933 0.012 96.4)` = **#ebe9e0** (cream) | `oklch(0.893 0.018 99.0)` = **#dedccf** |

新値は `tokens/elxea-custom.json` の `color.light.muted` と完全一致する
(そちらは元からFigma正だったが、ビルドsourceは `tokens/base.json` のみのため実効値になっていなかった)。

## 1. Figma側の実測 (推測値なし)

`mcp__figma__get_variable_defs` をWave 7で自分で再実行して確認した。

| node | 取得した `muted` |
|---|---|
| `8171:286` (Button・Pill Module) | **#dedccf** |

- `8172:280` (Modal Module) は `muted` 変数を公開していないため、`muted` を実際に使う
  `8171:286` を測定対象にした。同nodeは `secondary` #d5d3c0 / `background` #ebe9e0 /
  `muted-foreground` #585854も同時に返し、W5/W6の既存確定値と一致した (測定系の健全性確認)。

## 2. 実装ランタイム実測 (production build + Playwright `getComputedStyle`)

`pnpm build` → `pnpm start -p 3111` のproduction buildをPlaywrightで開き、
`getComputedStyle` の返り値を実測した。Chromeは `oklch()` をCIE `lab()` で
シリアライズするため、`lab()` をD50 → sRGB変換してhexに戻して照合した (変換は自前実装・外部依存なし)。

### 2-1. トークン解決値

| 実測対象 | Figma実測 | 実装実測 (hex復元) | delta |
|---|---|---|---|
| `bg-muted` | **#dedccf** | **#dedccf** | **0** |
| `bg-background` | #ebe9e0 | #ebe9e0 | 0 |
| `bg-card` | #f4f3ed | #f4f3ed | 0 |
| `bg-secondary` | #d5d3c0 | #d5d3c0 | 0 |
| `bg-muted` 上の `text-muted-foreground` | #585854 | #585854 | 0 |
| skeleton (`animate-pulse rounded-sm bg-muted`) | #dedccf | #dedccf | 0 |

### 2-2. A/B対照実測 — 「旧値では不可視だった」ことの証明

**同一DOM・同一セッション**で `--color-muted` を旧値/新値に差し替え、実hoverを発火させて実測した。

対象: `/ja/subscription` のheroCta `a[href='#plan']`
(`text-foreground transition-colors hover:bg-muted` / **cream背景の上** = B2と同一構図)。

| arm | 親の面 | hover時の面 | コントラスト | 可視 |
|---|---|---|---|---|
| BEFORE (旧cream) | #ebe9e0 | **#ebe9e0** | **1.0000:1** | **false** |
| AFTER (Figma正) | #ebe9e0 | **#dedccf** | **1.1325:1** | **true** |

対象: `/ja/subscription` のDateRibbon (`[data-slot="date-ribbon"]` / 静止 `bg-muted` のpill)

| arm | 親の面 | pillの面 | コントラスト | 可視 |
|---|---|---|---|---|
| BEFORE (旧cream) | #ebe9e0 | **#ebe9e0** | **1.0000:1** | **false** |
| AFTER (Figma正) | #ebe9e0 | **#dedccf** | **1.1325:1** | **true** |

DateRibbonは「Figma 8071:125の1312 × 49の帯」として実装されたpillだが、
**旧値では帯の面が背景と完全同色で、帯として一切描画されていなかった**。
これはB2と同一の根本原因による別の破綻であり、W7で同時に解消した。

### 2-3. 実要素の面色実測 (新値)

| 対象 | 親の面 | 静止 | hover | active |
|---|---|---|---|---|
| subscription heroCta | #ebe9e0 | transparent | **#dedccf** (1.1325:1) | #dedccf |
| subscription DateRibbon | #ebe9e0 | **#dedccf** (1.1325:1) | — | — |
| subscription ImagePlaceholder (6件) | #ebe9e0 | **#dedccf** (1.1325:1) | — | — |
| membership Button (`bg-muted hover:bg-muted/80 active:bg-muted/70`) | #f4f3ed | **#dedccf** (1.2391:1) | muted α0.8 | muted α0.7 |

## 3. 退行チェック (コントラスト計算・丸めなし)

### 3-1. muted面上の文字

| 前景 | BEFORE | AFTER | delta | 判定 |
|---|---|---|---|---|
| `muted-foreground` #585854 | 5.8745:1 | **5.1871:1** | -0.6874 | **AA Normal PASS** |
| `foreground` #5d5e61 | 5.3299:1 | **4.7063:1** | -0.6237 | **AA Normal PASS** |
| `graphite` #464748 | 7.6551:1 | **6.7593:1** | -0.8957 | **AA Normal PASS** |
| `destructive` #b9525c | 3.9022:1 | 3.4455:1 | -0.4566 | AA Largeのみ (既存差分・下記注) |

muted面が濃くなった分だけ文字コントラストは下がるが、**実際に使われる前景
(`muted-foreground` / `foreground`) はいずれもAA Normal 4.5:1を維持**する。

- 注: `destructive` は `bookmark-button.tsx:285` の `bg-card text-destructive hover:bg-muted`
  でのみmuted面に載る。**旧値でも3.90:1でAA Normal未達**でありW7が作った破綻ではない
  (destructiveトークン側の既存課題)。W7のスコープ外として据え置く。

### 3-2. 面vs面

| 対比 | BEFORE | AFTER | 評価 |
|---|---|---|---|
| muted vs background | 1.0000:1 | **1.1325:1** | 不可視 → 可視 (W7の目的) |
| muted vs card | 1.0941:1 | **1.2391:1** | bookmark hoverが可視化 |
| muted vs secondary | 1.2413:1 | 1.0961:1 | hoverとactiveが接近 (下記) |

`hover:bg-muted active:bg-secondary` は6箇所で使われる。mutedとsecondaryの
直接差は縮んだが、**静止面から見た状態の段階は単調増加になり改善している**:

| 状態 | BEFORE (vs cream) | AFTER (vs cream) |
|---|---|---|
| 静止 (cream) | — | — |
| hover (muted) | **1.0000:1 = 不可視** | **1.1325:1** |
| active (secondary) | 1.2413:1 | 1.2413:1 |

旧値では「静止 → hover」が完全に飛んで「静止 → active」しか知覚できなかった。
新値では3段階が順に濃くなる。

### 3-3. アルファ合成 (`bg-muted/50` `/80` `/70`)

| 用途 | 下地 | BEFORE実効色 | AFTER実効色 | AFTER vs下地 |
|---|---|---|---|---|
| `table.tsx` `hover:bg-muted/50` | card #f4f3ed | #f0eee7 | #e9e8de | 1.1071:1 |
| `table.tsx` `hover:bg-muted/50` | cream #ebe9e0 | **#ebe9e0 (不可視)** | #e4e3d8 | 1.0606:1 |
| `tea-spec-card.tsx` `hover:bg-muted/50` | card #f4f3ed | #f0eee7 | #e9e8de | 1.1071:1 |
| `membership` `hover:bg-muted/80` | cream #ebe9e0 | **#ebe9e0 (不可視)** | #e1dfd2 | 1.1005:1 |

- 観察 (W7スコープ外・要判断): `membership/page.tsx:124` は静止 `bg-muted` に対し
  `hover:bg-muted/80` を当てるため、**hoverで面が薄くなる**(#dedccf → #e1dfd2、
  静止との比1.0291:1)。押せる感じが弱まる向きの当て方であり、Figmaの
  hover定義に照らして別途見直す価値がある。W7は値の是正のみで当て方は変えていない。

## 4. 退行なしの確認範囲

`bg-muted` は52ファイル・88箇所で使われる。うち状態指定付き (`hover:` / `disabled:` /
`active:` / `data-[state=selected]:`) は17箇所で、すべて上記いずれかのパターンに該当する。
**旧値で「見えていたものが見えなくなる」変更は存在しない** —
旧値はbackgroundと同値だったため、変更方向は一貫して「不可視 → 可視」または
「薄い → やや濃い」であり、可視性が下がる組み合わせは生じない。

## 参照元

- Figma: `https://www.figma.com/design/AWLnI0XF07e8rScuxPYPc7/?node-id=8171-286` (2026-08-11取得)
- Wave 6対比表: `docs/fidelity/journal-wave6-card-token-fidelity.md`
- Wave 3対比表: `docs/fidelity/journal-wave3-fidelity.md` (#29が本件の初出)

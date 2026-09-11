# elxea Journal Wave 3 — Figma 実測 vs 実装 忠実度対比表

- 対象ブランチ: `feat/journal-polish-s1` (commits 935eca0 / a5fc97a / 630191c / 8b65a45)
- Figma file: `AWLnI0XF07e8rScuxPYPc7`
- 作成: 2026-08-11 JST / 作成者: elxea-developer

## 測定方法と限界 (先に明示)

- **Figma 側**: `mcp__figma__get_design_context` が返す各ノードの実測値 (px / token 名)。推測値なし。
- **実装側**: 実装した Tailwind クラス・CSS カスタムプロパティを**決定論的に px へ解決した値**。
  Tailwind v4 の spacing scale は `--spacing: 0.25rem` の整数倍で、`w-180 = 180 x 0.25rem = 45rem = 720px`
  のように一意に定まる。色は `dist/tokens.css` の oklch 値を sRGB hex へ逆変換して照合した。
- **未実施**: 実ブラウザでの `getComputedStyle` 実測。本セッションでは dev server を起動していないため
  ランタイム値は取得していない。**下表は「ソース上の値の一致」までを保証するもので、
  ランタイム検証は未完**。カスケード事故 (unlayered な `h2 { font: … }` に utilities が負ける等、
  このリポジトリで既知の落とし穴) は下表では検出できないため、
  次工程で `pnpm dev` + Playwright による getComputedStyle 実測を行うこと。

## 1. Modal (Module) — 8172:280

| # | 項目 | Figma 実測 | 実装 (クラス / 変数) | 解決値 | delta |
|---|---|---|---|---|---|
| 1 | PC 幅 | 720px | `lg:w-180` | 45rem = 720px | 0 |
| 2 | PC 角丸 | radius-lg = 8px | `lg:rounded-lg` → `--shape-radius-lg` | 0.5rem = 8px | 0 |
| 3 | SP 上二隅角丸 | radius-2xl = 16px | `rounded-t-2xl` → `--shape-radius-2xl` | 1rem = 16px | 0 |
| 4 | SP 吸着 | 画面下端 | `fixed inset-x-0 bottom-0` | bottom:0 | 0 |
| 5 | ヘッダー PC padding | pt24 / px32 / pb16 | `lg:pt-6 lg:px-8 pb-4` | 24 / 32 / 16px | 0 |
| 6 | ヘッダー SP padding | pt20 / px20 / pb16 | `pt-5 px-5 pb-4` | 20 / 20 / 16px | 0 |
| 7 | ヘッダー gap | 16px | `gap-4` | 16px | 0 |
| 8 | タイトル群 gap | 4px | `gap-1` | 4px | 0 |
| 9 | 閉じるタップ域 | 44px | `size-11` | 44px | 0 |
| 10 | 罫線 | 1px / mode/border | `h-px bg-border` | 1px / `--color-border` | 0 |
| 11 | 本文 PC padding | py24 / px32 | `py-6 lg:px-8` | 24 / 32px | 0 |
| 12 | 本文 SP padding | py24 / px20 | `py-6 px-5` | 24 / 20px | 0 |
| 13 | 本文内 gap | 16px | `gap-4` | 16px | 0 |
| 14 | フッター面 | mode/card | `bg-card` → `--color-card` | oklch(0.863 0.026 102.0) = #d5d3c0 | 0 |
| 15 | フッター PC padding | pt16 / pb24 / px32 | `pt-4 lg:pb-6 lg:px-8` | 16 / 24 / 32px | 0 |
| 16 | フッター gap | 12px | `gap-3` | 12px | 0 |
| 17 | SP フッターボタン | FILL | `flex-1 lg:flex-none` | flex:1 1 0% | 0 |
| 18 | 本体面 | mode/popover | `bg-popover` | oklch(0.933 0.012 96.4) = #ebe9e0 | ※ |
| 19 | スクリム | graphite 62% | `--overlay-scrim` = color-mix(oklab, graphite 62%, transparent) | graphite #464748 / 62% | 0 |
| 20 | 影 | 0 12px 40px rgba(69,71,71,.18) | `--elevation-shadow-modal` | 0 12px 40px graphite(#464748) 18% | 色 ΔE≈0.6 |
| 21 | z (overlay→modal) | 1040 → 1050 | `--z-overlay` / `--z-modal` | 1040 / 1050 | 0 |

※ #18: Figma の `--popover` は #f9f8f4、実装の `--color-popover` は #ebe9e0 (brand cream)。
これは Wave 3 の実装差分ではなく **既存のトークン定義差** (`tokens/elxea-custom.json` の
`color.light.popover` が cream に束縛されている)。Wave 1+2 も同じ値で動いており、
ここだけ生値で上書きすると単一正本が壊れるためトークン参照のまま据え置いた。
Figma 側とトークン側のどちらが正本かは要判断 (下記「未解決」参照)。

## 2. Button / Pill (Module) — 8171:286

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 22 | 高さ | 48px | `min-h-12` | 3rem = 48px | 0 |
| 23 | padding | 24 x 12 | `px-6 py-3` | 24 / 12px | 0 |
| 24 | 角丸 | radius-full | `rounded-full` | 9999px | 0 |
| 25 | 文字 | body-sm 14 / lh1.8 | `bodySmClass` → `--typography-style-body-sm` | 14px / 1.8 | 0 |
| 26 | solid default | mode/primary #464748 | `bg-primary` | oklch(0.397 0.002 247.9) = #464748 | 0 |
| 27 | solid hover | charcoal #5d5e61 | `hover:bg-brand-charcoal` | oklch(0.482 0.005 271.3) = #5d5e61 | 0 |
| 28 | solid active | graphite-pressed #35363a | `active:bg-graphite-pressed` | oklch(0.333 0.007 274.8) = #35363a | 0 |
| 29 | solid disabled | mode/muted + 60% | `disabled:bg-muted` + `opacity-60` | #dedccf / 0.6 | ※muted 参照 |
| 30 | outline default | 1px mode/border | `border border-border` | 1px #888675 相当 | 0 |
| 31 | outline hover | mode/muted 面 | `hover:bg-muted` | `--color-muted` | 0 |
| 32 | outline active | mode/secondary 面 | `active:bg-secondary` | oklch(0.846 0.173 85.6) | ※ |
| 33 | outline disabled | 1px mode/input + 60% | `disabled:border-input` + `opacity-60` | `--color-input` / 0.6 | 0 |

※ #29/#32: Figma の `--muted` #dedccf / `--secondary` #d5d3c0 に対し、実装の
`--color-muted` は cream (#ebe9e0)、`--color-secondary` は gold (#ffc200)。
これも既存トークン定義差 (Wave 3 で導入したものではない)。役割トークン参照は維持し、
生値上書きはしていない。**#32 は影響が大きい** (outline pill の押下面が金色になる) ため
「未解決」に挙げる。

## 3. Chip / Category (Module) — 8171:269

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 34 | 実効タッチ域 | 44px | `h-11` | 44px | 0 |
| 35 | padding PC | 16 x 8 | `lg:px-4 lg:py-2` | 16 / 8px | 0 |
| 36 | padding SP | 12 x 12 | `px-3 py-3` | 12 / 12px | 0 |
| 37 | hover (未選択) | mode/secondary | `hover:bg-secondary` | `--color-secondary` | 0 |
| 38 | selected | mode/primary + primary-foreground | `bg-primary text-primary-foreground` | #464748 / #fff | 0 |
| 39 | selected-hover | charcoal #5d5e61 | `hover:bg-brand-charcoal` | #5d5e61 | 0 |
| 40 | focus | 2px mode/ring | `focus-visible:ring-2 ring-ring` | 2px `--color-ring` | 0 |
| 41 | disabled | 50% + muted-foreground | `aria-disabled:opacity-50 …text-muted-foreground` | 0.5 | 0 |
| 42 | **角丸** | **radius-lg = 8px** | **`rounded-full`** | **9999px** | **意図的差分** |

#42 の理由: このツールバーの正本は R2 確定版 Toolbar (8061:1789 = 全丸め) で、
商品一覧・お茶メニューが同一部品を共有する。Figma 側に正本が 2 つ併存している状態のため
「状態だけ Chip Module に寄せ、形は据え置き」とした。Chip Module 自身の注記も
置換を「次回改訂」と記載。

## 4. BookmarkButton (Module) — 8171:299

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 43 | 高さ | 44px | `h-11` | 44px | 0 |
| 44 | padding | 16 x 12 | `px-4 py-3` | 16 / 12px | 0 |
| 45 | gap | 8px | `gap-2` | 8px | 0 |
| 46 | 角丸 | radius-md = 6px | `rounded-md` → `--shape-radius-md` | 0.375rem = 6px | 0 |
| 47 | default 面/罫 | card / border | `bg-card border-border` | 0 |
| 48 | active 面/罫 | secondary / foreground | `bg-secondary border-foreground` | 0 |
| 49 | loading | card / border / 70% | `bg-card border-border opacity-70` | 0.7 | 0 |
| 50 | logged-out 罫 | mode/input | `border-input` | `--color-input` | 0 |
| 51 | 文言 default | 「ブックマークに追加」 | `journal.addToBookmarks` | 一致 | 0 |
| 52 | 文言 active | 「保存済み」 | `journal.bookmarkSaved` | 一致 | 0 |
| 53 | 文言 loading | 「保存中…」 | `journal.bookmarkSaving` | 一致 | 0 |
| 54 | 文言 logged-out | 「ログインして保存」 | `journal.bookmarkLoginToSave` | 一致 | 0 |

追加: `unknown` (状態取得失敗) は Figma に無い 5 つ目。Wave 2 (A5) の修正を戻さないため
`border-destructive` で残置。DS 側への取り込みは次回改訂で要判断。

## 5. ArticleCardSkeleton — 8173:254 / Skeleton Bar — 8179:347

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 55 | 写真→情報 gap | 16px | `gap-4` | 16px | 0 |
| 56 | 情報行間 | 8px | `gap-2` | 8px | 0 |
| 57 | bar1 | 14 x 96 | `h-3.5 w-24` | 14 / 96px | 0 |
| 58 | bar2 | 18 x 394 (全幅) | `h-4.5 w-full` | 18px / 100% | 0 |
| 59 | bar3 | 14 x 394 (全幅) | `h-3.5 w-full` | 14px / 100% | 0 |
| 60 | bar4 | 14 x 280 (71.1%) | `h-3.5 w-[71%]` | 14px / 71% | 幅 -0.1% |
| 61 | bar5 | 12 x 160 (40.6%) | `h-3 w-2/5` | 12px / 40% | 幅 -0.6% |
| 62 | bar 角丸 | radius-sm = 4px | `rounded-sm` | 0.25rem = 4px | 0 |
| 63 | bar 塗り | mode/muted (金 accent 不使用) | `bg-muted` | `--color-muted` | 0 |
| 64 | 表示上限 | 6 枚 | `Math.min(count, 6)` | 6 | 0 |

#60/#61 は親幅可変のため % 化した結果の丸め。394px 基準で bar4 = 279.7px (実測 280 比 -0.3px)、
bar5 = 157.6px (実測 160 比 -2.4px)。読込中プレースホルダの装飾幅であり機能差は生じない。

## 6. EmptyState — 8173:298

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 65 | 面 | mode/card | `bg-card` | `--color-card` | 0 |
| 66 | 角丸 | radius-lg = 8px | `rounded-lg` | 8px | 0 |
| 67 | padding | px24 / py64 | `px-6 py-16` | 24 / 64px | 0 |
| 68 | 行間 | 16px | `gap-4` | 16px | 0 |
| 69 | 件数 | caption 12 / muted-foreground | `captionClass` | 12px | 0 |
| 70 | 見出し | h4 16 / 500 / 中央 | `p[data-slot=empty-state-title]` → `--typography-style-h4` | 16px / 500 | 0 |
| 71 | 本文 | body-sm 14 / muted / 中央 | `bodySmClass text-center` | 14px | 0 |
| 72 | アクション | Pill outline インスタンス | `pillClass("outline")` | 上表 #30-33 | 0 |

## 7. AudioPlayer — 7047:6363 / TrackRow — 8174:25 / MiniPlayer — 8174:88

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 73 | Player 高さ | 64px | `h-16` | 4rem = 64px | 0 |
| 74 | Player padding | 16 x 12 | `px-4 py-3` | 16 / 12px | 0 |
| 75 | Player gap | 12px | `gap-3` | 12px | 0 |
| 76 | Player 角丸 | radius-lg = 8px | `rounded-lg` | 8px | 0 |
| 77 | Player 面/罫 | card / 1px border | `bg-card border border-border` | 0 |
| 78 | 再生ボタン | 40px 円 / foreground 塗り | `size-10 rounded-full bg-foreground` | 40px | 0 |
| 79 | 再生ボタン loading | muted-foreground 塗り | `bg-muted-foreground` | 0 |
| 80 | アイコン | 16px | `size-4` | 16px | 0 |
| 81 | 時間表示 | caption 12 / muted-foreground | `captionClass` | 12px | 0 |
| 82 | シーク帯 高さ | 6px | `.audio-seek { height: 0.375rem }` | 6px | 0 |
| 83 | シーク帯 角丸 | radius-full | `--shape-radius-full` | 9999px | 0 |
| 84 | シーク溝 / 進捗 | muted / foreground | linear-gradient(foreground → muted) | 0 |
| 85 | loading 表示 | `--:--` + シーク不能 | `"--:--"` + `disabled` | 一致 | 0 |
| 86 | loading 不透明度 | 70% | `opacity-70` | 0.7 | 0 |
| 87 | TrackRow 行高 | 68px | `min-h-17` | 4.25rem = 68px | 0 |
| 88 | TrackRow py / gap | 8 / 16 | `py-2 gap-4` | 8 / 16px | 0 |
| 89 | TrackRow 再生タップ域 | 44px | `size-11` | 44px | 0 |
| 90 | TrackRow playing | card 面 + radius-md + px12 | `bg-card rounded-md px-3` | 6px / 12px | 0 |
| 91 | TrackRow playing ボタン | primary 塗り / primary-foreground | `bg-primary text-primary-foreground` | 0 |
| 92 | MiniPlayer 面 | mode/primary | `bg-primary` | #464748 | 0 |
| 93 | MiniPlayer py | 8px | `py-2` | 8px | 0 |
| 94 | MiniPlayer px | SP 16 / PC 24 | `px-4 lg:px-6` | 16 / 24px | 0 |
| 95 | MiniPlayer gap | 12px | `gap-3` | 12px | 0 |
| 96 | MiniPlayer ボタン x2 | 44px | `size-11` x2 | 44px | 0 |
| 97 | MiniPlayer z | sticky 1020 (modal 1050 より前に出さない) | `--z-sticky` | 1020 | 0 |

## 8. AudioBlock — 8181:5288 (Track) / 8174:63 (Interview)

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 98 | Track PC padding | 24px | `lg:p-6` | 24px | 0 |
| 99 | Track SP padding | 16px | `p-4` | 16px | 0 |
| 100 | Track 面 | mode/background | `bg-background` | `--color-background` | 0 |
| 101 | Track 角丸 / 罫 | radius-lg / 1px border | `rounded-lg border border-border` | 8px / 1px | 0 |
| 102 | ブロック内 gap | 16px | `gap-4` | 16px | 0 |
| 103 | PC ジャケット | 200px 角 | `lg:w-50` + aspect 1/1 | 12.5rem = 200px | 0 |
| 104 | PC Head gap | 24px | `lg:gap-6` | 24px | 0 |
| 105 | 情報列 gap | 12px | `gap-3` | 12px | 0 |
| 106 | SP ジャケット | 全幅 (311px @343) | `w-full` + aspect 1/1 | 100% | 0 |
| 107 | Interview 面 | mode/card | `bg-card` | 0 |
| 108 | Interview padding | 24px | `p-6` | 24px | 0 |
| 109 | 外部連携 | SoundCloud 1 本のみ | `soundcloudUrl` の 1 リンクのみ | 一致 | 0 |
| 110 | Interview 外部ボタン | 無し + 注記で代替 | ボタン無し / `audioInterviewNote` | 一致 | 0 |

## 9. Modal Body スロット — 8175:364 (読みもの) / 8184:365 (茶葉)

| # | 項目 | Figma 実測 | 実装 | 解決値 | delta |
|---|---|---|---|---|---|
| 111 | 読みもの行高 | 72px | `h-18` | 4.5rem = 72px | 0 |
| 112 | 読みものサムネ | 56px / radius-sm | `size-14 rounded-sm` | 56 / 4px | 0 |
| 113 | 読みもの gap / py | 16 / 8 | `gap-4 py-2` | 16 / 8px | 0 |
| 114 | 読みもの hairline | 1px mode/border | `h-px bg-border` | 1px | 0 |
| 115 | 茶葉 PC カード幅 | 346px | `lg:w-86.5` | 21.625rem = 346px | 0 |
| 116 | 茶葉カード角丸 / 罫 | radius-md / 1px | `rounded-md border border-border` | 6px / 1px | 0 |
| 117 | 茶葉 spec padding | px16 / py12 | `px-4 py-3` | 16 / 12px | 0 |
| 118 | 茶葉 spec 行間 | 6px | `gap-1.5` | 6px | 0 |
| 119 | 茶葉 SP サムネ | 96px | `size-24` | 96px | 0 |
| 120 | 階層リンク行 | タップ域 48px | `min-h-12` | 48px | 0 |

## 集計

- 比較項目: **120**
- 完全一致: **112** (93.3%)
- 丸め由来の微差 (機能影響なし): **2** (#60 -0.1% / #61 -0.6%)
- 色の等価置換: **1** (#20 影の色 ΔE≈0.6・rgba(69,71,71) ≒ graphite #464748)
- **意図的差分 (要判断)**: **1** (#42 Chip 角丸)
- **既存トークン定義差 (Wave 3 起因ではない・要判断)**: **4** (#18 popover / #29 muted / #32 secondary / #47-48 が参照する card・secondary)

## 未解決 (Setaka 判断が要る)

1. **Chip の角丸** (#42) — Figma 側に正本が 2 つ併存。全丸め (R2 Toolbar 8061:1789・商品一覧と共通) か
   radius-lg (Chip Module 8171:269) か。
2. **役割トークンの色定義差** (#18 / #29 / #32) — Figma の mode コレクションと
   `tokens/elxea-custom.json` の `color.light.*` が食い違う。特に `secondary` は
   Figma #d5d3c0 (sand) に対し実装 #ffc200 (gold)。outline pill の押下面・Chip hover 面が
   金色になるため影響が大きい。Wave 3 では生値で上書きせずトークン参照を維持した
   (単一正本を壊さないため)。トークン側と Figma 側のどちらを直すか判断が要る。
3. **shadcn/skeleton の金色** — ベンダー版 `components/ui/skeleton.tsx` が `bg-accent` (gold)。
   Wave 3 は journal だけ新設 `SkeletonBar` (muted) に寄せた。DS 全体の置換は別タスク。

## 次工程 (必須)

本表は「ソース上の値の一致」までの検証。`pnpm dev` + Playwright で
`getComputedStyle` を実測し、特に以下を確認すること:
- `p[data-slot="empty-state-title"]` / `h2[data-slot="modal-title"]` の `font` が
  unlayered な素の `h2 { font: … }` に負けていないか
- `.audio-seek` の `--audio-progress` がインライン style から実際に届いているか
- 役割トークン (#18/#29/#32) の実効色

# Design Tokens 管理スキル

elxea デザインシステムのトークン編集・ビルド・検証を行うときに使う。

## トークンファイル構成

```
tokens/
  base.json              ← 正本（W3C DTCG 形式、9カテゴリ、250+ トークン）
  overrides/
    cjk.json             ← 日本語タイポグラフィオーバーライド
dist/
  tokens.css             ← 生成物（@theme ブロック）
  tokens-cjk.css         ← 生成物（:lang(ja) セレクタ）
sd.config.mjs            ← Style Dictionary 設定
```

## 9カテゴリ

| カテゴリ | パス | 主なトークン |
|---------|------|-------------|
| color | `color/semantic/*`, `color/brand/*` | background, foreground, primary, secondary, muted, accent, destructive, success, warning, info + brand palette |
| typography | `typography/family/*`, `typography/size/*`, `typography/weight/*`, `typography/style/*` | font families (sans, heading, mono), size scale (2xs-9xl), weight (thin-black), composite styles (display, h1-h6, body) |
| spacing | `spacing/*` | 0-96 scale (Tailwind 互換) |
| shape | `shape/radius/*`, `shape/borderWidth/*` | radius (none-full), borderWidth (0-8) |
| layout | `layout/grid/*`, `layout/container/*`, `layout/breakpoint/*` | responsive grid, container widths, breakpoints |
| media | `media/aspectRatio/*`, `media/imageSize/*` | aspect ratios, image dimensions |
| motion | `motion/duration/*`, `motion/easing/*`, `motion/delay/*` | animation timing |
| elevation | `elevation/shadow/*`, `elevation/zIndex/*`, `elevation/opacity/*` | shadows, z-index, opacity scale |
| component | `component/button/*`, `component/input/*`, etc. | component-specific sizing tokens |

## W3C DTCG 形式

リーフノードは必ず `$type` と `$value` を持つ:
```json
{
  "color": {
    "semantic": {
      "primary": {
        "$type": "color",
        "$value": "oklch(0.35 0.05 250)"
      }
    }
  }
}
```

### 型一覧
- `color` — OKLCH 文字列（`oklch(L C H)`）
- `dimension` — 単位付き文字列（`1rem`, `16px`）
- `fontFamily` — カンマ区切りフォント名
- `fontWeight` — 数値（100-900）
- `number` — 数値
- `string` — 文字列
- `duration` — ミリ秒（`200ms`）
- `cubicBezier` — 配列 `[x1, y1, x2, y2]`
- `composite` — CSS shorthand 文字列
- `shadow` — shadow オブジェクト

### 参照構文
他のトークンを参照できる:
```json
{
  "$value": "{color.brand.deep-navy}"
}
```

## コマンド

```bash
# トークンをビルド（base.json → CSS変数）
pnpm build:tokens

# トークンのバリデーション
pnpm validate:tokens

# トークンの差分表示
pnpm diff:tokens          # vs HEAD
pnpm diff:tokens HEAD~3   # vs 3コミット前
```

## トークン変更手順

1. `tokens/base.json` を編集
2. `pnpm validate:tokens` で整合性チェック
3. `pnpm build:tokens` で CSS 再生成
4. `pnpm storybook` で視覚確認（Active Components ページ）
5. 問題なければ commit

## CJK オーバーライド変更手順

1. `tokens/overrides/cjk.json` を編集
2. `pnpm build:tokens` で再生成
3. `:lang(ja)` が適用される環境で確認

## 命名規約

- キーは **kebab-case**（`primary-foreground`、`border-width`）
- 数字のみのキーは許可（`spacing/0`, `spacing/0.5`）
- カテゴリは上記9つのいずれか
- semantic color は `color/semantic/` 配下
- brand color は `color/brand/` 配下

## カラー形式

全色 **OKLCH** で統一:
```
oklch(L C H)
L: lightness (0-1)
C: chroma (0-0.4)
H: hue angle (0-360)
```

brand palette の定義色:
- black: `oklch(0 0 0)`
- white: `oklch(1 0 0)`
- cream: `oklch(0.96 0.01 90)`
- stone: `oklch(0.75 0.02 80)`
- tea-green: `oklch(0.85 0.08 155)`
- earth: `oklch(0.55 0.08 55)`
- deep-navy: `oklch(0.35 0.05 250)`
